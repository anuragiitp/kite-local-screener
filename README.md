# Kite Local Screener

Chrome extension + React screener injected into Kite at `https://kite.zerodha.com/local-screener`.

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
