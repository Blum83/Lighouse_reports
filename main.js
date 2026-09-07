// main.js — Electron main process
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain } = require('electron');
const CDP = require('chrome-remote-interface');

import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DESKTOP_CONFIG = {
  formFactor: 'desktop',
  screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
};

let chrome = null;
let stopRequested = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 780,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Lighthouse Runner',
    autoHideMenuBar: true,
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  if (chrome) { try { await chrome.kill(); } catch {} chrome = null; }
  app.quit();
});

// ── Cookie consent via CDP (exact replica of working server.js approach) ──────

/**
 * Connects to the first available tab in Chrome, navigates to the URL,
 * waits for the cookie banner, clicks the selector, then closes only the
 * CDP connection (the tab stays open — its cookies remain in Chrome's memory).
 * Returns true if the button was found and clicked.
 */
async function acceptCookiesViaCDP(port, url, selector, onStatus) {
  const client = await CDP({ port });
  try {
    const { Page, Runtime, Network } = client;
    await Page.enable();
    await Network.enable();

    const loadPromise = new Promise(resolve => Page.loadEventFired(resolve));
    await Page.navigate({ url });
    await Promise.race([loadPromise, new Promise(r => setTimeout(r, 15000))]);

    // Poll for the cookie button — CMP scripts (OneTrust etc.) are deferred and
    // a fixed delay isn't reliable across sites. Up to 15s, checking every 250ms.
    const sel = JSON.stringify(selector);
    const deadline = Date.now() + 15000;
    let clicked = false;
    while (Date.now() < deadline) {
      const { result } = await Runtime.evaluate({
        expression: `(() => {
          const el = document.querySelector(${sel});
          if (!el) return 'missing';
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return 'hidden';
          el.click();
          return 'clicked';
        })()`,
      });
      if (result.value === 'clicked') { clicked = true; break; }
      await new Promise(r => setTimeout(r, 250));
    }

    if (!clicked) {
      onStatus?.('Cookie button not found within 15s — running without consent');
      return false;
    }

    // Verify the banner actually went away (some clicks are no-ops if the
    // OneTrust handler hasn't bound yet). Poll up to 5s.
    const verifyDeadline = Date.now() + 5000;
    while (Date.now() < verifyDeadline) {
      const { result } = await Runtime.evaluate({
        expression: `(() => {
          const el = document.querySelector(${sel});
          if (!el) return true;
          const r = el.getBoundingClientRect();
          return r.width === 0 || r.height === 0;
        })()`,
      });
      if (result.value === true) break;
      await new Promise(r => setTimeout(r, 250));
    }

    // Wait a bit more for post-click work (API calls, variant assignment, cookie writes)
    await new Promise(r => setTimeout(r, 1500));

    // Clear HTTP cache so Lighthouse starts cold — cookies/localStorage untouched
    await Network.clearBrowserCache();

    return true;
  } finally {
    // Close the WebSocket connection but NOT the tab — cookies stay in Chrome
    await client.close();
  }
}

/** Clears only HTTP cache between runs (cookies stay). */
async function clearBrowserCache(port) {
  const client = await CDP({ port });
  try {
    await client.Network.enable();
    await client.Network.clearBrowserCache();
  } finally {
    await client.close();
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────

ipcMain.on('start-tests', async (event, { url, runs, device, cookieSelector }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  stopRequested = false;
  const useCookies = !!cookieSelector?.trim();
  let cookiesAccepted = false;

  try {
    chrome = await launch({ chromeFlags: ['--headless=new', '--disable-gpu'] });

    // Cookie consent — uses the first existing Chrome tab, leaves it open
    if (useCookies && !stopRequested) {
      if (!win.isDestroyed()) win.webContents.send('status', 'Loading page and accepting cookies\u2026');
      cookiesAccepted = await acceptCookiesViaCDP(chrome.port, url, cookieSelector, msg => {
        if (!win.isDestroyed()) win.webContents.send('status', msg);
      });
      if (!cookiesAccepted && !win.isDestroyed()) {
        win.webContents.send('status', 'Warning: cookie consent failed \u2014 banner may appear in audits');
      }
    }

    if (stopRequested) {
      if (!win.isDestroyed()) win.webContents.send('done');
      return;
    }

    for (let i = 1; i <= runs; i++) {
      if (stopRequested) break;

      // Clear cache between runs (but not before run 1 — acceptCookiesViaCDP did it)
      if (useCookies && cookiesAccepted && i > 1) {
        await clearBrowserCache(chrome.port);
      }

      if (!win.isDestroyed()) win.webContents.send('progress', { run: i, total: runs });

      try {
        const flags = {
          port: chrome.port,
          onlyCategories: ['performance'],
          output: 'json',
          // Preserve consent cookies — Lighthouse won't call clearBrowserCookies()
          disableStorageReset: cookiesAccepted,
          ...(device === 'desktop' ? DESKTOP_CONFIG : {}),
        };

        const result = await lighthouse(url, flags);
        const lhr = result.lhr;
        const a = lhr.audits;

        const metrics = {
          score:      Math.round(lhr.categories.performance.score * 100),
          fcp:        Math.round(a['first-contentful-paint']?.numericValue ?? 0),
          lcp:        Math.round(a['largest-contentful-paint']?.numericValue ?? 0),
          tbt:        Math.round(a['total-blocking-time']?.numericValue ?? 0),
          cls:        a['cumulative-layout-shift']?.numericValue ?? 0,
          si:         Math.round(a['speed-index']?.numericValue ?? 0),
          tti:        Math.round(a['interactive']?.numericValue ?? 0),
          screenshot: a['final-screenshot']?.details?.data ?? null,
        };

        if (!win.isDestroyed()) win.webContents.send('run-done', { run: i, result: metrics });
      } catch (e) {
        if (stopRequested) break;
        if (!win.isDestroyed()) win.webContents.send('run-error', { run: i, error: e.message });
      }
    }

    if (!win.isDestroyed()) win.webContents.send('done');
  } catch (e) {
    if (!win.isDestroyed()) {
      win.webContents.send('run-error', { run: 0, error: e.message });
      win.webContents.send('done');
    }
  } finally {
    if (chrome) { try { await chrome.kill(); } catch {} chrome = null; }
  }
});

ipcMain.on('stop-tests', async () => {
  stopRequested = true;
  if (chrome) { try { await chrome.kill(); } catch {} chrome = null; }
});
