# Lighthouse Performance Runner

A local tool that runs 10 Lighthouse performance audits for a given URL and generates an HTML report with per-run results and an Average row.

## Requirements

- Node.js 18+
- Google Chrome installed

## Setup

```bash
npm install
```

## Usage

```bash
node run.js <url> [mobile|desktop]
```

### Examples

```bash
# Mobile (default)
node run.js https://example.com

# Desktop
node run.js https://example.com desktop

# Mobile explicit
node run.js https://example.com mobile
```

## How it works

1. Launches Chrome in headless mode
2. Runs Lighthouse 10 times
3. Prints progress for each run in the console
4. Saves an HTML report to the `reports/` folder
5. Automatically opens the report in the browser

## Console output

```
Lighthouse Performance Runner
URL   : https://example.com
Device: desktop
Runs  : 10

[1/10] Score:  91 | FCP:  0.80s | LCP:  1.20s | TBT:   40ms | CLS: 0.002
[2/10] Score:  89 | FCP:  0.85s | LCP:  1.30s | TBT:   55ms | CLS: 0.004
...

─────────────────────────────────
Average Score : 90
Average FCP   : 0.82s
Average LCP   : 1.25s
─────────────────────────────────

Report saved: reports/example.com_desktop_2026-02-27_14-30.html
```

## HTML report

A table with metrics for each run plus an Average row at the bottom:

| Run | Score | FCP | LCP | TBT | CLS | Speed Index | TTI |
|-----|-------|-----|-----|-----|-----|-------------|-----|
| 1 | 91 | ... | ... | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... | ... |
| **Avg** | **90** | ... | ... | ... | ... | ... | ... |

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

## Project structure

```
Lighouse_reports/
├── run.js          — main script
├── package.json    — dependencies
├── README.md
└── reports/        — HTML reports (auto-created, git-ignored)
    └── example.com_mobile_2026-02-27_14-30.html
```
