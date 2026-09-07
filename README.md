# Lighthouse Runner

A desktop app (Electron) for running Lighthouse performance audits against a URL, multiple times in a row, with averaged results. Built for personal use.

## Requirements

- Node.js 18+
- Google Chrome installed

## Setup

```bash
npm install
```

## Usage

### Desktop app (recommended)

```bash
npm start
```

Enter a URL, choose Mobile or Desktop, pick a run count (3/5/10/15/20), optionally set a cookie-consent CSS selector, and click **Run**.

Results stream in row by row as each run completes, with a screenshot thumbnail per row (click to view full-size) and an averages row at the bottom. Export results to CSV.

### CLI (legacy)

```bash
node run.js <url> [mobile|desktop]
```

Saves an HTML report to `reports/` and opens it in the browser. `server.js` + `public/` provide an older browser-based UI for the same flow.

## How it works

1. Launches headless Chrome
2. If a cookie-consent selector is set, primes consent via CDP before each run (see [main.js](main.js))
3. Runs Lighthouse the chosen number of times for the given URL
4. Streams progress in the UI ("Running X / Y…" → "Done!")
5. Shows a table with per-run results and an averages row

Score color scale: 🟢 90–100 · 🟠 50–89 · 🔴 0–49

## Metrics

| Metric | Description |
|--------|-------------|
| Score | Overall Performance score (0–100) |
| FCP | First Contentful Paint |
| LCP | Largest Contentful Paint |
| TBT | Total Blocking Time |
| CLS | Cumulative Layout Shift |
| Speed Index | Speed Index |
| TTI | Time to Interactive |
| Screenshot | Final screenshot from the run |

## Build

```bash
npm run build:win   # Windows installer (nsis)
npm run build:mac   # macOS dmg — must run on macOS
```

## Project structure

```
Lighouse_reports/
├── main.js          — Electron main process (Lighthouse + CDP cookie consent)
├── renderer.js       — UI logic
├── preload.cjs        — IPC bridge (contextBridge)
├── index.html         — app UI
├── styles.css
├── run-cv235549.js    — one-off runner (see file header for context)
├── run.js / server.js / public/ — legacy CLI + browser UI
├── package.json       — dependencies + electron-builder config
└── reports/            — CLI HTML reports (auto-created, git-ignored)
```
