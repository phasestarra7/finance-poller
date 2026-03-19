# Finance Poller

Finance Poller is a Windows tray-resident background app built with Electron. It polls Yahoo Finance quotes every 15 seconds through `yahoo-finance2` and shows multiple tickers as compact widgets with live price and daily change data.

## Overview

- Polls Yahoo Finance every 15 seconds
- Runs in the system tray
- Supports up to 12 ticker widgets
- Sends alerts for price and daily change thresholds
- Persists window position and widget settings locally
- Starts hidden on login when running as a packaged app

## Features

### Quote display

The app normalizes Yahoo Finance quote data and chooses the displayed price based on market state:

- `preMarketPrice` for `PRE` and `PREPRE`
- `postMarketPrice` for `POST` and `POSTPOST`
- `regularMarketPrice` otherwise

It also shows absolute and percentage change versus the previous regular-market close.

### Alert conditions

Each widget can define these threshold rules:

- `priceAbove`
- `priceBelow`
- `changePercentAbove`
- `changePercentBelow`

When alerts are enabled, the threshold inputs are locked for that widget. A desktop notification is sent on polling cycles where one or more enabled conditions match.

### Tray behavior

- The `_` button hides the window to the tray instead of quitting
- Clicking the tray icon toggles the window
- The tray menu provides `Open` and `Quit`
- Packaged builds register auto-launch with the `--hidden` argument

## Tech stack

- Electron 40
- `yahoo-finance2` 3.13.2
- `electron-builder` 26
- Plain HTML, CSS, and JavaScript in the renderer

## Getting started

### Requirements

- Node.js
- npm

### Run in development

```bash
npm install
npm start
```

### Check source files

This project includes a syntax-only check script:

```bash
npm run check
```

### Build for Windows

Create an unpacked Windows build:

```bash
npm run pack:win
```

Create an NSIS installer:

```bash
npm run dist:win
```

Build artifacts are written to `dist/`. `build/after-pack.js` adjusts Windows executable metadata and icon resources after packaging.

## Usage

1. Launch the app and click the `+` card to add a ticker.
2. Examples: `AAPL`, `MSFT`, `005930.KS`, `KRW=X`
3. Enter alert thresholds in the right side of each widget.
4. Click the bell button to arm alerts.
5. Widgets briefly flash when a fresh quote update changes the displayed price.
6. Hide the window with `_` to keep the app running in the tray.

## State storage

Application state is saved to `state.json` under Electron's `userData` directory.

Stored data includes:

- Window position
- Registered widgets
- Alert enabled state
- Per-widget threshold values

## Project structure

```text
build/
  after-pack.js        # Windows packaging post-process
  icon.ico
  icon.png
src/
  main/
    main.js            # tray, window, polling, IPC, notifications
    preload.js         # renderer <-> main bridge
    quote-provider.js  # yahoo-finance2 wrapper
    store.js           # state.json persistence
  renderer/
    index.html         # frameless UI shell
    app.js             # widget rendering and events
    styles.css         # app styling
```

## Notes

- The app enforces single-instance behavior. Launching it again focuses the existing window.
- The widget limit is 12.
- If polling fails or quote data is unavailable, the widget shows `N/A`.
- Window position is restored, but the initial content size is reset to `320x240`.
