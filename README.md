# Lighthouse Performance Runner

Локальный инструмент для запуска 10 проверок Lighthouse по заданному URL.
Результат — HTML-отчёт с таблицей всех прогонов и строкой Average.

## Требования

- Node.js 18+
- Google Chrome (установлен на компьютере)

## Установка

```bash
npm install
```

## Запуск

```bash
node run.js <url> [mobile|desktop]
```

### Примеры

```bash
# Mobile (по умолчанию)
node run.js https://example.com

# Desktop
node run.js https://example.com desktop

# Mobile явно
node run.js https://example.com mobile
```

## Что происходит

1. Открывается Chrome в фоновом режиме
2. Запускается 10 прогонов Lighthouse
3. В консоли отображается прогресс каждого прогона
4. Сохраняется HTML-отчёт в папку `reports/`
5. Отчёт автоматически открывается в браузере

## Вывод в консоли

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

## HTML-отчёт

Таблица с метриками по каждому прогону + строка Average:

| Run | Score | FCP | LCP | TBT | CLS | Speed Index | TTI |
|-----|-------|-----|-----|-----|-----|-------------|-----|
| 1   | 91    | ... | ... | ... | ... | ...         | ... |
| ... | ...   | ... | ... | ... | ... | ...         | ... |
| **Avg** | **90** | ... | ... | ... | ... | ... | ... |

Цветовая шкала Score: 🟢 90–100 · 🟠 50–89 · 🔴 0–49

## Метрики

| Метрика | Описание |
|---------|----------|
| Score | Общий Performance score (0–100) |
| FCP | First Contentful Paint |
| LCP | Largest Contentful Paint |
| TBT | Total Blocking Time |
| CLS | Cumulative Layout Shift |
| Speed Index | Speed Index |
| TTI | Time to Interactive |

## Структура проекта

```
Lighouse_reports/
├── run.js          — главный скрипт
├── package.json    — зависимости
├── README.md
└── reports/        — HTML-отчёты (создаётся автоматически)
    └── example.com_mobile_2026-02-27_14-30.html
```
