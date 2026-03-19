const path = require("node:path");
const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage } = require("electron");

const { YahooQuoteProvider } = require("./quote-provider");
const { AppStore, normalizeSymbol } = require("./store");

const APP_ID = "com.phasestarr.financepoller";
const MAX_WIDGETS = 12;
const POLL_INTERVAL_MS = 15_000;
const DEFAULT_BOUNDS = {
  width: 320,
  height: 240,
};
const FLASH_DURATION_MS = 1200;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let store = null;
let quoteProvider = null;
let pollTimer = null;
let pollInFlight = false;
const runtimeWidgets = new Map();
let hasAppliedInitialWindowSize = false;

function resolveAssetPath(...segments) {
  return path.join(app.getAppPath(), ...segments);
}

function loadAppIcon() {
  const iconPath = resolveAssetPath("build", "icon.png");
  const icon = nativeImage.createFromPath(iconPath);

  if (!icon.isEmpty()) {
    return icon;
  }

  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="10" y="9" width="44" height="46" rx="12" fill="#080808" stroke="#f5f5f5" stroke-width="4"/>
      <path d="M22 32h20M32 22v20" stroke="#f5f5f5" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString("base64")}`
  );
}

function getRuntime(widgetId) {
  if (!runtimeWidgets.has(widgetId)) {
    runtimeWidgets.set(widgetId, {
      flashToken: 0,
      flashDirection: null,
      flashExpiresAt: null,
      priceDirection: "neutral",
      dayDirection: "neutral",
      lastDisplayPrice: null,
      dataState: "idle",
      errorMessage: null,
      quote: null,
    });
  }

  return runtimeWidgets.get(widgetId);
}

function cleanupRuntimeWidgets(widgetIds) {
  const validWidgetIds = new Set(widgetIds);

  for (const widgetId of runtimeWidgets.keys()) {
    if (!validWidgetIds.has(widgetId)) {
      runtimeWidgets.delete(widgetId);
    }
  }
}

function setAutoLaunch() {
  if (!app.isPackaged) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: ["--hidden"],
  });
}

function createWindow() {
  const persistedBounds = store.getState().windowBounds || {};
  const shouldStartHidden = process.argv.includes("--hidden");
  hasAppliedInitialWindowSize = false;

  mainWindow = new BrowserWindow({
    x: persistedBounds.x,
    y: persistedBounds.y,
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
    minWidth: 300,
    minHeight: 220,
    frame: false,
    useContentSize: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: "#050505",
    icon: resolveAssetPath("build", "icon.png"),
    skipTaskbar: shouldStartHidden,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.setContentSize(DEFAULT_BOUNDS.width, DEFAULT_BOUNDS.height);
    hasAppliedInitialWindowSize = true;

    if (!shouldStartHidden) {
      mainWindow.show();
    }
  });

  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const [x, y] = mainWindow.getPosition();
    store.setWindowBounds({
      x,
      y,
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height,
    });
  };

  mainWindow.on("move", persistBounds);
  mainWindow.on("resize", persistBounds);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    return;
  }

  if (!hasAppliedInitialWindowSize) {
    mainWindow.setContentSize(DEFAULT_BOUNDS.width, DEFAULT_BOUNDS.height);
    hasAppliedInitialWindowSize = true;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function hideWindowToTray() {
  if (!mainWindow) {
    return;
  }

  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

function createTray() {
  const icon = loadAppIcon().resize({
    width: 18,
    height: 18,
  });
  tray = new Tray(icon);
  tray.setToolTip("Finance Poller");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open",
        click: () => showWindow(),
      },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );

  tray.on("click", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isVisible()) {
      hideWindowToTray();
    } else {
      showWindow();
    }
  });
}

function pickDisplayPrice(quote) {
  if (!quote) {
    return null;
  }

  if ((quote.marketState === "PRE" || quote.marketState === "PREPRE") && quote.preMarketPrice != null) {
    return Number(quote.preMarketPrice);
  }

  if ((quote.marketState === "POST" || quote.marketState === "POSTPOST") && quote.postMarketPrice != null) {
    return Number(quote.postMarketPrice);
  }

  if (quote.regularMarketPrice != null) {
    return Number(quote.regularMarketPrice);
  }

  if (quote.postMarketPrice != null) {
    return Number(quote.postMarketPrice);
  }

  if (quote.preMarketPrice != null) {
    return Number(quote.preMarketPrice);
  }

  return null;
}

function toIsoDateValue(rawTimestamp) {
  if (rawTimestamp == null) {
    return new Date().toISOString();
  }

  if (rawTimestamp instanceof Date && Number.isFinite(rawTimestamp.getTime())) {
    return rawTimestamp.toISOString();
  }

  if (typeof rawTimestamp === "string") {
    const parsedDate = new Date(rawTimestamp);
    if (Number.isFinite(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  const numericTimestamp = Number(rawTimestamp);
  if (!Number.isFinite(numericTimestamp)) {
    return new Date().toISOString();
  }

  const timestamp = numericTimestamp < 1_000_000_000_000 ? numericTimestamp * 1000 : numericTimestamp;
  return new Date(timestamp).toISOString();
}

function normalizeQuote(rawQuote) {
  if (!rawQuote) {
    return null;
  }

  const displayPrice = pickDisplayPrice(rawQuote);
  const previousClose =
    rawQuote.regularMarketPreviousClose == null ? null : Number(rawQuote.regularMarketPreviousClose);
  const dayChangeAbs =
    displayPrice != null && previousClose != null ? displayPrice - previousClose : null;
  const dayChangePercent =
    dayChangeAbs != null && previousClose ? (dayChangeAbs / previousClose) * 100 : null;

  return {
    symbol: String(rawQuote.symbol || "").toUpperCase(),
    displayName: rawQuote.shortName || rawQuote.longName || String(rawQuote.symbol || "").toUpperCase(),
    currency: rawQuote.currency || null,
    marketState: rawQuote.marketState || null,
    displayPrice,
    previousClose,
    dayChangeAbs,
    dayChangePercent,
    updatedAt: toIsoDateValue(rawQuote.regularMarketTime),
  };
}

function evaluateConditions(widget, normalizedQuote) {
  const displayPrice = normalizedQuote && normalizedQuote.displayPrice;
  const dayChangePercent = normalizedQuote && normalizedQuote.dayChangePercent;
  const thresholds = widget.thresholds;

  return {
    priceAbove:
      thresholds.priceAbove != null && displayPrice != null ? displayPrice >= thresholds.priceAbove : false,
    priceBelow:
      thresholds.priceBelow != null && displayPrice != null ? displayPrice <= thresholds.priceBelow : false,
    changePercentAbove:
      thresholds.changePercentAbove != null && dayChangePercent != null
        ? dayChangePercent >= thresholds.changePercentAbove
        : false,
    changePercentBelow:
      thresholds.changePercentBelow != null && dayChangePercent != null
        ? dayChangePercent <= thresholds.changePercentBelow
        : false,
  };
}

function createNotificationBody(widget, normalizedQuote, matches) {
  const messageParts = [];
  const price = normalizedQuote && normalizedQuote.displayPrice;
  const dayPercent = normalizedQuote && normalizedQuote.dayChangePercent;

  if (matches.priceAbove) {
    messageParts.push(`Price >= ${widget.thresholds.priceAbove}`);
  }
  if (matches.priceBelow) {
    messageParts.push(`Price <= ${widget.thresholds.priceBelow}`);
  }
  if (matches.changePercentAbove) {
    messageParts.push(`Day % >= ${widget.thresholds.changePercentAbove}`);
  }
  if (matches.changePercentBelow) {
    messageParts.push(`Day % <= ${widget.thresholds.changePercentBelow}`);
  }

  const summaryParts = [];
  if (price != null) {
    summaryParts.push(`Now ${price}`);
  }
  if (dayPercent != null) {
    const sign = dayPercent > 0 ? "+" : "";
    summaryParts.push(`Day ${sign}${dayPercent.toFixed(2)}%`);
  }

  return [summaryParts.join(" | "), messageParts.join(" | ")].filter(Boolean).join("\n");
}

function sendNotifications(widget, normalizedQuote, matches) {
  if (!widget.alertEnabled) {
    return;
  }

  if (!Object.values(matches).some(Boolean)) {
    return;
  }

  const notification = new Notification({
    title: `${widget.symbol} alert`,
    body: createNotificationBody(widget, normalizedQuote, matches),
    silent: false,
  });

  notification.on("click", () => {
    showWindow();
  });

  notification.show();
}

function buildUiState() {
  const widgets = store.getWidgets().map((widget) => {
    const runtime = getRuntime(widget.id);
    const flashDirection =
      runtime.flashExpiresAt && runtime.flashExpiresAt > Date.now() ? runtime.flashDirection : null;
    const conditionMatches = evaluateConditions(widget, runtime.quote);

    return {
      ...widget,
      conditionMatches,
      quote: {
        displayName: runtime.quote ? runtime.quote.displayName : widget.symbol,
        currency: runtime.quote ? runtime.quote.currency : null,
        marketState: runtime.quote ? runtime.quote.marketState : null,
        displayPrice: runtime.quote ? runtime.quote.displayPrice : null,
        previousClose: runtime.quote ? runtime.quote.previousClose : null,
        dayChangeAbs: runtime.quote ? runtime.quote.dayChangeAbs : null,
        dayChangePercent: runtime.quote ? runtime.quote.dayChangePercent : null,
        updatedAt: runtime.quote ? runtime.quote.updatedAt : null,
        priceDirection: runtime.priceDirection,
        dayDirection: runtime.dayDirection,
        flashDirection,
        flashToken: runtime.flashToken,
        dataState: runtime.dataState,
        errorMessage: runtime.errorMessage,
      },
    };
  });

  return {
    maxWidgets: MAX_WIDGETS,
    pollIntervalMs: POLL_INTERVAL_MS,
    widgets,
  };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:changed", buildUiState());
  }
}

async function pollQuotes() {
  if (pollInFlight) {
    return;
  }

  const widgets = store.getWidgets();
  cleanupRuntimeWidgets(widgets.map((widget) => widget.id));

  if (!widgets.length) {
    broadcastState();
    return;
  }

  const symbols = widgets.map((widget) => widget.symbol);

  pollInFlight = true;
  try {
    const quoteMap = await quoteProvider.getQuotes(symbols);

    for (const widget of widgets) {
      const runtime = getRuntime(widget.id);
      const rawQuote = quoteMap[widget.symbol];
      const normalizedQuote = normalizeQuote(rawQuote);
      const previousPrice = runtime.lastDisplayPrice;
      const previousUpdatedAt = runtime.quote ? runtime.quote.updatedAt : null;
      const hasFreshUpdate = previousUpdatedAt != null && previousUpdatedAt !== normalizedQuote?.updatedAt;

      if (!normalizedQuote || normalizedQuote.displayPrice == null) {
        runtime.dataState = "error";
        runtime.errorMessage = rawQuote ? "N/A" : "No data";
        runtime.quote = null;
        runtime.priceDirection = "neutral";
        runtime.dayDirection = "neutral";
        runtime.flashDirection = null;
        runtime.flashExpiresAt = null;
        continue;
      }

      runtime.dataState = "ok";
      runtime.errorMessage = null;
      runtime.quote = normalizedQuote;
      runtime.dayDirection =
        normalizedQuote.dayChangeAbs == null
          ? "neutral"
          : normalizedQuote.dayChangeAbs > 0
            ? "up"
            : normalizedQuote.dayChangeAbs < 0
              ? "down"
              : "flat";

      if (previousPrice == null) {
        runtime.priceDirection = "neutral";
      } else if (normalizedQuote.displayPrice > previousPrice) {
        runtime.priceDirection = "up";
        if (hasFreshUpdate) {
          runtime.flashDirection = "up";
          runtime.flashToken += 1;
          runtime.flashExpiresAt = Date.now() + FLASH_DURATION_MS;
        }
      } else if (normalizedQuote.displayPrice < previousPrice) {
        runtime.priceDirection = "down";
        if (hasFreshUpdate) {
          runtime.flashDirection = "down";
          runtime.flashToken += 1;
          runtime.flashExpiresAt = Date.now() + FLASH_DURATION_MS;
        }
      } else {
        runtime.priceDirection = "flat";
        if (hasFreshUpdate) {
          runtime.flashDirection = "flat";
          runtime.flashToken += 1;
          runtime.flashExpiresAt = Date.now() + FLASH_DURATION_MS;
        }
      }

      if (!hasFreshUpdate) {
        runtime.flashDirection = null;
        runtime.flashExpiresAt = null;
      }

      runtime.lastDisplayPrice = normalizedQuote.displayPrice;

      const matches = evaluateConditions(widget, normalizedQuote);
      sendNotifications(widget, normalizedQuote, matches);
    }
  } catch (_error) {
    for (const widget of widgets) {
      const runtime = getRuntime(widget.id);
      runtime.dataState = "error";
      runtime.errorMessage = "N/A";
      runtime.quote = null;
      runtime.priceDirection = "neutral";
      runtime.dayDirection = "neutral";
      runtime.flashDirection = null;
      runtime.flashExpiresAt = null;
    }
  } finally {
    pollInFlight = false;
    broadcastState();
  }
}

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(() => {
    void pollQuotes();
  }, POLL_INTERVAL_MS);

  void pollQuotes();
}

function registerIpc() {
  ipcMain.handle("app:get-state", async () => buildUiState());

  ipcMain.on("window:hide", () => {
    hideWindowToTray();
  });

  ipcMain.on("window:quit", () => {
    isQuitting = true;
    app.quit();
  });

  ipcMain.handle("widgets:add", async (_event, payload) => {
    if (store.getWidgets().length >= MAX_WIDGETS) {
      throw new Error("Maximum widget count reached.");
    }

    const symbol = normalizeSymbol(payload && payload.symbol);
    if (!symbol) {
      throw new Error("A ticker symbol is required.");
    }

    const widget = store.addWidget(symbol);
    getRuntime(widget.id);
    broadcastState();
    void pollQuotes();

    return widget;
  });

  ipcMain.handle("widgets:update", async (_event, payload) => {
    if (!payload || !payload.widgetId || !payload.patch) {
      throw new Error("A widget update payload is required.");
    }

    const widget = store.updateWidget(payload.widgetId, payload.patch);
    broadcastState();

    if (Object.prototype.hasOwnProperty.call(payload.patch, "symbol")) {
      void pollQuotes();
    }

    return widget;
  });

  ipcMain.handle("widgets:delete", async (_event, payload) => {
    if (!payload || !payload.widgetId) {
      throw new Error("A widget id is required.");
    }

    store.deleteWidget(payload.widgetId);
    runtimeWidgets.delete(payload.widgetId);
    broadcastState();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      showWindow();
    }
  });
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  store = new AppStore(app);
  quoteProvider = new YahooQuoteProvider();

  setAutoLaunch();
  createWindow();
  createTray();
  registerIpc();
  startPolling();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", (event) => {
  if (!isQuitting) {
    event.preventDefault();
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
  } else {
    showWindow();
  }
});
