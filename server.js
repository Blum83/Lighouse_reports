import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const PORT = 3000;
const DEFAULT_RUNS = 1;
const MAX_RUNS = 50;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let isRunning = false;

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

async function runLighthouse(url, chromePort, device) {
  const settings = device === 'desktop' ? DESKTOP_CONFIG : {};
  const result = await lighthouse(url, {
    port: chromePort,
    onlyCategories: ['performance'],
    output: 'json',
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
  };
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Serve UI
  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
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
    const results = [];
    let chrome;

    try {
      chrome = await launch({ chromeFlags: ['--headless', '--disable-gpu'] });

      for (let i = 1; i <= runs; i++) {
        sendEvent(res, 'progress', { run: i, total: runs, status: 'running' });
        const r = await runLighthouse(targetUrl, chrome.port, device);
        results.push(r);
        sendEvent(res, 'progress', { run: i, total: runs, status: 'done', result: r });
      }

      const avg = {
        score: Math.round(avg_val(results, r => r.score)),
        fcpFmt: formatMs(avg_val(results, r => r.fcp)),
        lcpFmt: formatMs(avg_val(results, r => r.lcp)),
        tbtFmt: formatMs(avg_val(results, r => r.tbt)),
        clsFmt: formatCls(avg_val(results, r => r.cls)),
        siFmt: formatMs(avg_val(results, r => r.si)),
        ttiFmt: formatMs(avg_val(results, r => r.tti)),
      };

      sendEvent(res, 'done', { results, avg });
    } catch (err) {
      sendEvent(res, 'error', { message: err.message });
    } finally {
      if (chrome) await chrome.kill();
      isRunning = false;
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
