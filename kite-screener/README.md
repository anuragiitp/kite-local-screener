# Kite Screener

React screener dashboard injected into Kite by the Chrome extension at:

```text
https://kite.zerodha.com/local-screener
```

## Build

```bash
npm install
npm run build:extension
```

This writes the production bundle into `../kite-cors-helper/app`.

Then reload the extension from `chrome://extensions`.

## Daily use

1. Login to Kite in Chrome
2. Open `https://kite.zerodha.com/local-screener`

No auth paste, no cookie paste, and no CORS setup are required. The app uses your existing Kite session.

## Project layout

- `src/screener/presets.js` - screener definitions
- `src/screener/queryBuilder.js` - global filter + preset query merge
- `src/screener/kiteApi.js` - same-origin Kite API calls
- `../kite-cors-helper` - Chrome extension that injects this app

## Notes

- This uses Kite's private web screener endpoint, not official Kite Connect.
- Some fundamentals field names may need adjustment after checking live responses.
