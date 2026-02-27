import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const RUNS = 10;

const url = process.argv[2];
const device = (process.argv[3] || 'mobile').toLowerCase();

if (!url) {
  console.error('Usage: node run.js <url> [mobile|desktop]');
  console.error('Example: node run.js https://example.com desktop');
  process.exit(1);
}

try {
  new URL(url);
} catch {
  console.error(`Invalid URL: ${url}`);
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

function scoreColor(score) {
  if (score >= 90) return '#0cce6b';
  if (score >= 50) return '#ffa400';
  return '#ff4e42';
}

function formatMs(ms) {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function formatCls(val) {
  if (val == null) return '—';
  return val.toFixed(3);
}

function buildHtml(url, results, device) {
  const avg = {
    score: avg_val(results, r => r.score),
    fcp: avg_val(results, r => r.fcp),
    lcp: avg_val(results, r => r.lcp),
    tbt: avg_val(results, r => r.tbt),
    cls: avg_val(results, r => r.cls),
    si: avg_val(results, r => r.si),
    tti: avg_val(results, r => r.tti),
  };

  const rows = results.map((r, i) => `
    <tr>
      <td class="run">${i + 1}</td>
      <td class="score" style="color:${scoreColor(r.score)}">${r.score}</td>
      <td>${formatMs(r.fcp)}</td>
      <td>${formatMs(r.lcp)}</td>
      <td>${formatMs(r.tbt)}</td>
      <td>${formatCls(r.cls)}</td>
      <td>${formatMs(r.si)}</td>
      <td>${formatMs(r.tti)}</td>
    </tr>`).join('');

  const avgScore = Math.round(avg.score);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Lighthouse Report — ${url} [${device}]</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; padding: 32px; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .meta { font-size: 0.85rem; color: #666; margin-bottom: 24px; }
    .url { color: #1a73e8; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
    thead { background: #1a73e8; color: #fff; }
    thead th { padding: 12px 16px; text-align: center; font-weight: 600; font-size: 0.85rem; letter-spacing: .03em; }
    tbody tr:hover { background: #f0f7ff; }
    tbody td { padding: 10px 16px; text-align: center; font-size: 0.9rem; border-bottom: 1px solid #eee; }
    td.run { color: #888; font-size: 0.8rem; }
    td.score { font-weight: 700; font-size: 1rem; }
    tr.avg-row { background: #e8f0fe; font-weight: 700; }
    tr.avg-row td { border-bottom: none; font-size: 0.95rem; }
    tr.avg-row .avg-label { font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
    .legend { margin-top: 16px; font-size: 0.78rem; color: #666; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; }
  </style>
</head>
<body>
  <h1>Lighthouse Performance Report</h1>
  <p class="meta">
    <span class="url">${url}</span> &nbsp;·&nbsp;
    <strong>${device === 'mobile' ? '📱 Mobile' : '🖥 Desktop'}</strong> &nbsp;·&nbsp;
    ${new Date().toLocaleString('ru-RU')} &nbsp;·&nbsp;
    ${RUNS} runs
  </p>
  <table>
    <thead>
      <tr>
        <th>Run</th>
        <th>Score</th>
        <th>FCP</th>
        <th>LCP</th>
        <th>TBT</th>
        <th>CLS</th>
        <th>Speed Index</th>
        <th>TTI</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="avg-row">
        <td class="avg-label">Avg</td>
        <td class="score" style="color:${scoreColor(avgScore)}">${avgScore}</td>
        <td>${formatMs(avg.fcp)}</td>
        <td>${formatMs(avg.lcp)}</td>
        <td>${formatMs(avg.tbt)}</td>
        <td>${formatCls(avg.cls)}</td>
        <td>${formatMs(avg.si)}</td>
        <td>${formatMs(avg.tti)}</td>
      </tr>
    </tbody>
  </table>
  <p class="legend">
    <span class="dot" style="background:#0cce6b"></span>Good (90–100) &nbsp;
    <span class="dot" style="background:#ffa400"></span>Needs Improvement (50–89) &nbsp;
    <span class="dot" style="background:#ff4e42"></span>Poor (0–49)
  </p>
</body>
</html>`;
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

(async () => {
  console.log(`\nLighthouse Performance Runner`);
  console.log(`URL   : ${url}`);
  console.log(`Device: ${device}`);
  console.log(`Runs  : ${RUNS}\n`);

  const chrome = await launch({ chromeFlags: ['--headless', '--disable-gpu'] });
  const results = [];

  try {
    for (let i = 1; i <= RUNS; i++) {
      process.stdout.write(`[${i}/${RUNS}] Running...`);
      const r = await runLighthouse(url, chrome.port, device);
      results.push(r);
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      console.log(
        `[${i}/${RUNS}] Score: ${String(r.score).padStart(3)} | ` +
        `FCP: ${formatMs(r.fcp).padStart(7)} | ` +
        `LCP: ${formatMs(r.lcp).padStart(7)} | ` +
        `TBT: ${formatMs(r.tbt).padStart(7)} | ` +
        `CLS: ${formatCls(r.cls)}`
      );
    }
  } finally {
    await chrome.kill();
  }

  const domain = new URL(url).hostname.replace(/^www\./, '');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${domain}_${device}_${ts}.html`;
  const reportsDir = path.join(process.cwd(), 'reports');

  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath, buildHtml(url, results, device), 'utf-8');

  const avg = {
    score: Math.round(avg_val(results, r => r.score)),
    fcp: avg_val(results, r => r.fcp),
    lcp: avg_val(results, r => r.lcp),
  };

  console.log('\n─────────────────────────────────');
  console.log(`Average Score : ${avg.score}`);
  console.log(`Average FCP   : ${formatMs(avg.fcp)}`);
  console.log(`Average LCP   : ${formatMs(avg.lcp)}`);
  console.log(`─────────────────────────────────`);
  console.log(`\nReport saved: reports/${filename}`);

  try {
    execSync(`start "" "${filepath}"`, { stdio: 'ignore', shell: true });
  } catch {
    // ignore — user can open manually
  }
})();
