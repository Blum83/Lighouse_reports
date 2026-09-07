import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { launch } from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import lighthouse from 'lighthouse';

// One-off runner for CV235549 (Ohra) — Optimizely force via ?cvqa_version=/?cvqa=true is
// UNVERIFIED and does not deterministically pin a variant (confirmed 2026-08-07: neither
// param changed which content rendered). Per instruction from the ticket owner, the variant
// actually served is read off the page after priming cookie consent, not selected in advance.
//
// Before every Lighthouse pass this primes cookie consent by clicking
// #accept-recommended-btn-handler via CDP — Optimizely does not bucket/activate the
// experiment pre-consent (same pattern as Convert/Cookiebot), and a fresh headless Chrome
// visitor otherwise never sees the experiment at all.

const RUNS = 10;

const url = process.argv[2];
const device = (process.argv[3] || 'mobile').toLowerCase();

if (!url) {
  console.error('Usage: node run-cv235549.js <url> [mobile|desktop]');
  process.exit(1);
}
if (!['mobile', 'desktop'].includes(device)) {
  console.error(`Invalid device: "${device}". Use "mobile" or "desktop".`);
  process.exit(1);
}

const DESKTOP_CONFIG = {
  formFactor: 'desktop',
  screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
};

function formatMs(ms) { return ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`; }
function formatCls(v) { return v == null ? '—' : v.toFixed(3); }
function avg_val(results, fn) { const vals = results.map(fn).filter(v => v != null); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; }

async function primeConsentAndDetectVariant(chromePort, url) {
  const client = await CDP({ port: chromePort });
  const { Page, Runtime } = client;
  try {
    await Page.enable();
    await Page.navigate({ url });
    await Page.loadEventFired();
    await new Promise(r => setTimeout(r, 1500));

    await Runtime.evaluate({
      expression: `(() => { const btn = document.querySelector('#accept-recommended-btn-handler'); if (btn) { btn.click(); return true; } return false; })()`,
    });
    await new Promise(r => setTimeout(r, 1500));

    const variantProbe = await Runtime.evaluate({
      expression: `(() => { const t = document.body.innerText; const usps = [...document.querySelectorAll('li, p, span')].map(e => e.textContent.trim()).filter(Boolean); const hasNewUsp = usps.some(u => u.includes('Meest gekozen')); const hasIpsos = t.includes('Ipsos Tracker'); const hasOldUspBullet = usps.some(u => /^Nu 1 jaar lang 10% korting$/i.test(u)); return JSON.stringify({ hasNewUsp, hasIpsos, hasOldUspBullet }); })()`,
      returnByValue: true,
    });
    const probe = JSON.parse(variantProbe.result.value);
    const variant = probe.hasNewUsp && probe.hasIpsos ? 'V1' : (probe.hasOldUspBullet ? 'Control' : 'unknown');
    return variant;
  } finally {
    await client.close();
  }
}

async function runLighthouse(url, chromePort, device) {
  const settings = device === 'desktop' ? DESKTOP_CONFIG : {};
  const result = await lighthouse(url, { port: chromePort, onlyCategories: ['performance'], output: 'json', ...settings });
  const lhr = result.lhr;
  const audits = lhr.audits;
  return {
    score: Math.round(lhr.categories.performance.score * 100),
    fcp: audits['first-contentful-paint']?.numericValue ?? null,
    lcp: audits['largest-contentful-paint']?.numericValue ?? null,
    tbt: audits['total-blocking-time']?.numericValue ?? null,
    cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    si: audits['speed-index']?.numericValue ?? null,
    tti: audits['interactive']?.numericValue ?? null,
  };
}

function buildHtml(url, results, device, variant) {
  const avg = { score: avg_val(results, r => r.score), fcp: avg_val(results, r => r.fcp), lcp: avg_val(results, r => r.lcp), tbt: avg_val(results, r => r.tbt), cls: avg_val(results, r => r.cls), si: avg_val(results, r => r.si), tti: avg_val(results, r => r.tti) };
  const rows = results.map((r, i) => `<tr><td>${i + 1}</td><td style="font-weight:700">${r.score}</td><td>${formatMs(r.fcp)}</td><td>${formatMs(r.lcp)}</td><td>${formatMs(r.tbt)}</td><td>${formatCls(r.cls)}</td><td>${formatMs(r.si)}</td><td>${formatMs(r.tti)}</td></tr>`).join('');
  const avgScore = Math.round(avg.score);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Lighthouse — CV235549 [${variant}] [${device}]</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#f5f5f5;color:#333;padding:32px}h1{font-size:1.4rem;margin-bottom:4px}.meta{font-size:.85rem;color:#666;margin-bottom:24px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.12)}thead{background:#1a73e8;color:#fff}thead th{padding:12px 16px;text-align:center;font-size:.85rem}tbody td{padding:10px 16px;text-align:center;font-size:.9rem;border-bottom:1px solid #eee}tr.avg{background:#e8f0fe;font-weight:700}</style></head>
<body><h1>Lighthouse — CV235549 [${variant}]</h1><p class="meta">${url} · ${device === 'mobile' ? '📱 Mobile' : '🖥 Desktop'} · ${new Date().toLocaleString('ru-RU')} · ${RUNS} runs · consent primed via #accept-recommended-btn-handler</p>
<table><thead><tr><th>Run</th><th>Score</th><th>FCP</th><th>LCP</th><th>TBT</th><th>CLS</th><th>Speed Index</th><th>TTI</th></tr></thead><tbody>${rows}<tr class="avg"><td>AVG</td><td>${avgScore}</td><td>${formatMs(avg.fcp)}</td><td>${formatMs(avg.lcp)}</td><td>${formatMs(avg.tbt)}</td><td>${formatCls(avg.cls)}</td><td>${formatMs(avg.si)}</td><td>${formatMs(avg.tti)}</td></tr></tbody></table></body></html>`;
}

(async () => {
  console.log(`\nCV235549 Lighthouse Runner (consent-primed)`);
  console.log(`URL   : ${url}`);
  console.log(`Device: ${device}\n`);

  const chrome = await launch({ chromeFlags: ['--headless', '--disable-gpu'] });
  const results = [];
  let variant = 'unknown';

  try {
    variant = await primeConsentAndDetectVariant(chrome.port, url);
    console.log(`Detected variant after consent priming: ${variant}\n`);

    for (let i = 1; i <= RUNS; i++) {
      const r = await runLighthouse(url, chrome.port, device);
      results.push(r);
      console.log(`[${i}/${RUNS}] Score: ${String(r.score).padStart(3)} | FCP: ${formatMs(r.fcp).padStart(7)} | LCP: ${formatMs(r.lcp).padStart(7)} | TBT: ${formatMs(r.tbt).padStart(7)} | CLS: ${formatCls(r.cls)}`);
    }
  } finally {
    await chrome.kill();
  }

  const domain = new URL(url).hostname.replace(/^www\./, '');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${domain}_${device}_${variant}_${ts}.html`;
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath, buildHtml(url, results, device, variant), 'utf-8');

  console.log('\n─────────────────────────────────');
  console.log(`Variant       : ${variant}`);
  console.log(`Average Score : ${Math.round(avg_val(results, r => r.score))}`);
  console.log(`Average FCP   : ${formatMs(avg_val(results, r => r.fcp))}`);
  console.log(`Average LCP   : ${formatMs(avg_val(results, r => r.lcp))}`);
  console.log('─────────────────────────────────');
  console.log(`\nReport saved: reports/${filename}`);
})();
