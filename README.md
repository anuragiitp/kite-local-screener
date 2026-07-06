# Kite Local Screener

Chrome extension + React screener injected into Kite at `https://kite.zerodha.com/local-screener`.

![Screener with chart, fundamentals, and order ticket](docs/screenshots/screener-chart-detail.png)

Watchlists, screeners, live charts, fundamentals, market depth, and order placement — inside your existing Kite session.

## Screenshots

### Dashboard
Indices, top gainers/losers, sector heatmap, and sector screener in one view.

![Dashboard](docs/screenshots/dashboard.png)

### Top gainers screener
Screener results with chart, fundamentals, price trend, and trade panel.

![Top gainers screener](docs/screenshots/screener-top-gainers.png)

### Stock detail
Chart, fundamentals, depth, and order ticket for a selected symbol.

![Stock detail](docs/screenshots/screener-chart-detail.png)

## Layout

- `kite-screener/` — React app source
- `kite-cors-helper/` — Chrome extension (build output in `app/`)

## Build

```bash
cd kite-screener
npm install
npm run build:extension
```

Reload the extension from `chrome://extensions` (load unpacked → `kite-cors-helper`).

## Use

1. Log in to Kite in Chrome
2. Open `https://kite.zerodha.com/local-screener`

Uses your existing Kite session — no API keys or cookie paste required.
