// renderer.js — UI logic

const $url    = document.getElementById('url');
const $runs   = document.getElementById('runs');
const $cookie = document.getElementById('cookieSelector');
const $btn    = document.getElementById('btn');
const $prog   = document.getElementById('prog');
const $fill   = document.getElementById('fill');
const $pStatus = document.getElementById('progressStatus');
const $pCount  = document.getElementById('progressCount');
const $wrap   = document.getElementById('tableWrap');
const $tbody  = document.getElementById('tbody');
const $tfoot  = document.getElementById('tfoot');
const $note   = document.getElementById('note');
const $csvBtn = document.getElementById('csvBtn');
const $rUrl   = document.getElementById('reportUrl');
const $rMeta  = document.getElementById('reportMetaText');

$csvBtn.addEventListener('click', downloadCSV);

// ── Screenshot modal ──────────────────────────────────────────────────────────

const $modal   = document.getElementById('modal');
const $modalImg = document.getElementById('modalImg');

function openModal(src) { $modalImg.src = src; $modal.hidden = false; }
function closeModal()   { $modal.hidden = true; $modalImg.src = ''; }

document.getElementById('modalBackdrop').addEventListener('click', closeModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

document.addEventListener('click', e => {
  if (e.target.classList.contains('screenshot-thumb')) openModal(e.target.src);
});

// ── Device toggle ─────────────────────────────────────────────────────────────

let device = 'mobile';
document.getElementById('btnMobile').addEventListener('click',  () => setDevice('mobile'));
document.getElementById('btnDesktop').addEventListener('click', () => setDevice('desktop'));

function setDevice(d) {
  device = d;
  document.getElementById('btnMobile').classList.toggle('active',  d === 'mobile');
  document.getElementById('btnDesktop').classList.toggle('active', d === 'desktop');
}

// ── Formatting ────────────────────────────────────────────────────────────────

function scoreColor(s) {
  if (s == null) return '';
  return s >= 90 ? 'green' : s >= 50 ? 'orange' : 'red';
}

function fmtMs(v) {
  if (v == null) return '\u2014';
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v}ms`;
}

function addRow(data, isAvg = false) {
  const row = document.createElement('tr');

  if (data.error) {
    row.className = 'err';
    row.innerHTML = `<td>${data.run}</td><td colspan="8">${data.error}</td>`;
  } else {
    const scoreBadge = data.score != null
      ? `<span class="badge ${scoreColor(data.score)}">${data.score}</span>`
      : '\u2014';
    const thumb = data.screenshot
      ? `<img src="${data.screenshot}" class="screenshot-thumb" alt="">`
      : '\u2014';

    row.innerHTML = [
      isAvg ? '<td><strong>Avg</strong></td>' : `<td>${data.run}</td>`,
      `<td>${scoreBadge}</td>`,
      `<td>${fmtMs(data.fcp)}</td>`,
      `<td>${fmtMs(data.lcp)}</td>`,
      `<td>${fmtMs(data.tbt)}</td>`,
      `<td>${data.cls != null ? data.cls.toFixed(3) : '\u2014'}</td>`,
      `<td>${fmtMs(data.si)}</td>`,
      `<td>${fmtMs(data.tti)}</td>`,
      `<td>${thumb}</td>`,
    ].join('');
  }

  (isAvg ? $tfoot : $tbody).appendChild(row);
}

// ── Averages ──────────────────────────────────────────────────────────────────

function calcAvg(data) {
  const keys = ['score', 'fcp', 'lcp', 'tbt', 'cls', 'si', 'tti'];
  const out = {};
  for (const k of keys) {
    const vals = data.map(r => r[k]).filter(v => v != null && !isNaN(v));
    if (!vals.length) { out[k] = null; continue; }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    out[k] = k === 'cls' ? Math.round(mean * 1000) / 1000 : Math.round(mean);
  }
  return out;
}

// ── CSV export ────────────────────────────────────────────────────────────────

function downloadCSV() {
  if (!results.length) return;
  const domain = (() => { try { return new URL($url.value).hostname; } catch { return 'report'; } })();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const header = ['Run', 'Score', 'FCP_ms', 'LCP_ms', 'TBT_ms', 'CLS', 'SI_ms', 'TTI_ms'];
  const rows = results.map(r => [
    r.run, r.score ?? '', r.fcp ?? '', r.lcp ?? '', r.tbt ?? '',
    r.cls != null ? r.cls.toFixed(3) : '', r.si ?? '', r.tti ?? '',
  ]);
  const avg = calcAvg(results);
  rows.push([
    'Avg', avg.score ?? '', avg.fcp ?? '', avg.lcp ?? '', avg.tbt ?? '',
    avg.cls != null ? avg.cls.toFixed(3) : '', avg.si ?? '', avg.tti ?? '',
  ]);

  const csv = [header, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${domain}_${device}_${ts}.csv`;
  a.click();
}

// ── Test flow ─────────────────────────────────────────────────────────────────

let running = false;
let results = [];
let totalRuns = 0;

$btn.addEventListener('click', () => {
  if (running) {
    window.api.stopTests();
    stop(true);
    return;
  }

  const url = $url.value.trim();
  if (!url.startsWith('http')) { $url.focus(); return; }

  startTests(url, +$runs.value);
});

function startTests(url, runs) {
  running = true;
  results = [];
  totalRuns = runs;

  $btn.textContent = 'Stop';
  $btn.classList.add('stop');
  $url.disabled = true;
  $runs.disabled = true;
  $csvBtn.hidden = true;

  $tbody.innerHTML = '';
  $tfoot.innerHTML = '';
  $wrap.hidden = true;
  $note.hidden = true;
  $prog.hidden = false;
  $fill.style.width = '0%';
  $pStatus.textContent = 'Starting\u2026';
  $pCount.textContent = `0 / ${runs}`;

  // Report header
  $rUrl.textContent = url;
  $rUrl.href = url;
  const icon  = device === 'mobile' ? '\uD83D\uDCF1' : '\uD83D\uDDA5\uFE0F';
  const label = device === 'mobile' ? 'Mobile' : 'Desktop';
  $rMeta.textContent = ` \u00B7 ${icon} ${label} \u00B7 ${new Date().toLocaleString()}`;

  window.api.removeListeners();

  window.api.onStatus(msg => {
    $pStatus.textContent = msg;
  });

  window.api.onProgress(({ run, total }) => {
    $fill.style.width = `${((run - 1) / total) * 100}%`;
    $pStatus.textContent = `Running ${run} / ${total}\u2026`;
    $pCount.textContent = `${run - 1} / ${total}`;
  });

  window.api.onRunDone(({ run, result }) => {
    $fill.style.width = `${(run / totalRuns) * 100}%`;
    $pStatus.textContent = `Run ${run} done`;
    $pCount.textContent = `${run} / ${totalRuns}`;
    results.push({ run, ...result });
    addRow({ run, ...result });
    $wrap.hidden = false;
  });

  window.api.onRunError(({ run, error }) => {
    addRow({ run, error });
    $wrap.hidden = false;
  });

  window.api.onDone(() => {
    if (results.length) addRow(calcAvg(results), true);
    $fill.style.width = '100%';
    $pStatus.textContent = 'Done!';
    $pCount.textContent = `${results.length} / ${totalRuns}`;
    $note.hidden = false;
    $csvBtn.hidden = false;
    stop(false);
  });

  window.api.startTests({ url, runs, device, cookieSelector: $cookie.value.trim() });
}

function stop(clear) {
  running = false;
  $btn.textContent = 'Run';
  $btn.classList.remove('stop');
  $url.disabled = false;
  $runs.disabled = false;

  if (clear) {
    $wrap.hidden = true;
    $prog.hidden = true;
    $tbody.innerHTML = '';
    $tfoot.innerHTML = '';
  }
}
