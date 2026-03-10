import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import CDP from 'chrome-remote-interface';

const PORT = process.env.PORT || 3000;
const DEFAULT_RUNS = 1;
const MAX_RUNS = 50;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let isRunning = false;
let shouldStop = false;
let currentChrome = null;

const DESKTOP_CONFIG = {
  formFactor: 'desktop',
  screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
};

function formatMs(ms) {
  if (ms == null) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function formatCls(val) {
  if (val == null) return null;
  return val.toFixed(3);
}

function avg_val(results, fn) {
  const vals = results.map(fn).filter(v => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Click cookie consent button via CDP, then clear HTTP cache so Lighthouse starts cold.
// Returns true if the button was found and clicked.
async function acceptCookiesViaCDP(port, url, selector) {
  const client = await CDP({ port });
  try {
    const { Page, Runtime, Network } = client;
    await Page.enable();
    await Network.enable();

    const loadPromise = new Promise(resolve => Page.loadEventFired(resolve));
    await Page.navigate({ url });
    await Promise.race([loadPromise, new Promise(r => setTimeout(r, 15000))]);

    // Wait for the cookie banner to render
    await new Promise(r => setTimeout(r, 2500));

    const { result } = await Runtime.evaluate({
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) { el.click(); return true; }
        return false;
      })()`,
    });

    const clicked = result.value === true;

    // Wait for any post-click actions (redirects, API calls, variant assignment)
    await new Promise(r => setTimeout(r, 1500));

    // Clear HTTP cache so the upcoming Lighthouse run starts cold
    await Network.clearBrowserCache();

    return clicked;
  } finally {
    await client.close();
  }
}

// Clear only the HTTP cache (cookies/localStorage untouched) between runs
async function clearBrowserCache(port) {
  const client = await CDP({ port });
  try {
    await client.Network.enable();
    await client.Network.clearBrowserCache();
  } finally {
    await client.close();
  }
}

async function runLighthouse(url, chromePort, device, preserveCookies) {
  const settings = device === 'desktop' ? DESKTOP_CONFIG : {};
  const result = await lighthouse(url, {
    port: chromePort,
    onlyCategories: ['performance'],
    output: 'json',
    disableStorageReset: preserveCookies, // keep cookies when consent was pre-accepted
    ...settings,
  });
  const lhr = result.lhr;
  const audits = lhr.audits;
  const raw = {
    score: Math.round(lhr.categories.performance.score * 100),
    fcp: audits['first-contentful-paint']?.numericValue ?? null,
    lcp: audits['largest-contentful-paint']?.numericValue ?? null,
    tbt: audits['total-blocking-time']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    si: audits['speed-index']?.numericValue ?? null,
    tti: audits['interactive']?.numericValue ?? null,
  };
  return {
    ...raw,
    fcpFmt: formatMs(raw.fcp),
    lcpFmt: formatMs(raw.lcp),
    tbtFmt: formatMs(raw.tbt),
    clsFmt: formatCls(raw.cls),
    siFmt: formatMs(raw.si),
    ttiFmt: formatMs(raw.tti),
    screenshot: lhr.audits['final-screenshot']?.details?.data ?? null,
  };
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Serve favicon
  if (reqUrl.pathname === '/favicon.svg') {
    const svg = fs.readFileSync(path.join(__dirname, 'public', 'favicon.svg'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(svg);
    return;
  }

  // Serve UI
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Stop endpoint
  if (reqUrl.pathname === '/stop') {
    shouldStop = true;
    if (currentChrome) {
      try { await currentChrome.kill(); } catch {}
      currentChrome = null;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // SSE run endpoint
  if (reqUrl.pathname === '/run') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    if (isRunning) {
      sendEvent(res, 'error', { message: 'Test already running. Please wait.' });
      res.end();
      return;
    }

    const targetUrl = reqUrl.searchParams.get('url');
    const device = (reqUrl.searchParams.get('device') || 'mobile').toLowerCase();
    const runs = Math.min(MAX_RUNS, Math.max(1, parseInt(reqUrl.searchParams.get('runs'), 10) || DEFAULT_RUNS));
    const cookieSelector = reqUrl.searchParams.get('cookieSelector')?.trim() || '';

    if (!targetUrl) {
      sendEvent(res, 'error', { message: 'URL is required.' });
      res.end();
      return;
    }

    try {
      new URL(targetUrl);
    } catch {
      sendEvent(res, 'error', { message: `Invalid URL: ${targetUrl}` });
      res.end();
      return;
    }

    if (!['mobile', 'desktop'].includes(device)) {
      sendEvent(res, 'error', { message: `Invalid device: ${device}` });
      res.end();
      return;
    }

    isRunning = true;
    shouldStop = false;
    const results = [];
    let chrome;

    const buildAvg = (arr) => ({
      score: Math.round(avg_val(arr, r => r.score)),
      fcpFmt: formatMs(avg_val(arr, r => r.fcp)),
      lcpFmt: formatMs(avg_val(arr, r => r.lcp)),
      tbtFmt: formatMs(avg_val(arr, r => r.tbt)),
      clsFmt: formatCls(avg_val(arr, r => r.cls)),
      siFmt: formatMs(avg_val(arr, r => r.si)),
      ttiFmt: formatMs(avg_val(arr, r => r.tti)),
    });

    try {
      chrome = await launch({
        chromePath: process.env.CHROME_PATH,
        chromeFlags: ['--headless', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      currentChrome = chrome;

      if (cookieSelector) {
        sendEvent(res, 'setup', { message: 'Navigating to page and accepting cookie consent...' });
        const clicked = await acceptCookiesViaCDP(chrome.port, targetUrl, cookieSelector);
        sendEvent(res, 'setup', {
          message: clicked
            ? 'Cookie consent accepted. Starting audits...'
            : `Cookie button not found for selector "${cookieSelector}". Proceeding anyway.`,
          clicked,
        });
      }

      for (let i = 1; i <= runs; i++) {
        if (shouldStop) break;

        if (cookieSelector && i > 1) {
          await clearBrowserCache(chrome.port);
        }

        sendEvent(res, 'progress', { run: i, total: runs, status: 'running' });
        try {
          const r = await runLighthouse(targetUrl, chrome.port, device, !!cookieSelector);
          results.push(r);
          sendEvent(res, 'progress', { run: i, total: runs, status: 'done', result: r });
        } catch (err) {
          if (shouldStop) break; // Chrome was killed intentionally
          throw err;
        }
      }

      if (shouldStop) {
        sendEvent(res, 'stopped', { completed: results.length, avg: results.length ? buildAvg(results) : null });
      } else {
        sendEvent(res, 'done', { results, avg: buildAvg(results) });
      }
    } catch (err) {
      if (!shouldStop) sendEvent(res, 'error', { message: err.message });
    } finally {
      currentChrome = null;
      if (chrome) try { await chrome.kill(); } catch {}
      isRunning = false;
      shouldStop = false;
      res.end();
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nLighthouse Runner UI`);
  console.log(`→ http://localhost:${PORT}\n`);
  try {
    execSync(`start http://localhost:${PORT}`, { stdio: 'ignore', shell: true });
  } catch {
    // ignore
  }
});
