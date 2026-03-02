# Lighthouse Performance Runner

A local tool that runs 10 Lighthouse performance audits for a given URL and shows per-run results with an Average row. Supports both a web UI and a CLI.

## Requirements

- Node.js 18+
- Google Chrome installed

## Setup

```bash
npm install
```

## Usage

### Web UI (recommended)

```bash
node server.js
```

Opens `http://localhost:3000` automatically. Enter a URL, pick Mobile or Desktop, click **Run**.
Results appear row by row as each audit completes. Once done, export the table in HTML, CSV, or XLSX.

### CLI

```bash
node run.js <url> [mobile|desktop]
```

```bash
# Mobile (default)
node run.js https://example.com

# Desktop
node run.js https://example.com desktop
```

The CLI saves an HTML report to the `reports/` folder and opens it in the browser automatically.

## How it works

1. Launches Chrome in headless mode
2. Runs Lighthouse 1 / 3 / 5 / 10 / 15 / 20 / 50 times for the given URL
3. Streams progress in real time (UI) or prints to console (CLI)
4. Shows a table with per-run results and an Average row at the bottom

Score color scale: 🟢 90–100 · 🟠 50–89 · 🔴 0–49

## Export (Web UI)

After all 10 runs complete, three export buttons appear below the table:

| Format | Description |
|--------|-------------|
| HTML | Standalone HTML file, opens in any browser |
| CSV | Comma-separated values, compatible with Excel and Google Sheets |
| XLSX | Native Excel file with column widths pre-set |

Files are named automatically: `example.com_desktop_2026-03-02_14-30.xlsx`

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

## Project structure

```
Lighouse_reports/
├── server.js       — web UI server (http://localhost:3000)
├── run.js          — CLI script
├── public/
│   └── index.html  — web interface
├── package.json    — dependencies
├── README.md
└── reports/        — CLI HTML reports (auto-created, git-ignored)
```
