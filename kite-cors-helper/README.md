# Kite Local Screener Extension

Chrome extension that loads the local screener app only at:

```text
https://kite.zerodha.com/local-screener
```

Outside that path, nothing is injected.

## Install

1. Build the app into this extension (from the `kite-screener` repo):

```bash
cd ../kite-screener
npm run build:extension
```

2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this folder (`kite-cors-helper`)

## Use

1. Login to Kite normally
2. Open `https://kite.zerodha.com/local-screener`

Or click the extension popup button.

## Rebuild after UI changes

```bash
npm run build:extension
```

Then reload the extension in Chrome.

## How it works

```text
/local-screener URL
        ↓
extension injects local app JS/CSS
        ↓
app runs on kite.zerodha.com
        ↓
fetch('/screener/instruments', credentials: 'include')
        ↓
Kite cookies/session are used automatically
```
