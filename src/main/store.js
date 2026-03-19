const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_THRESHOLDS = Object.freeze({
  priceAbove: null,
  priceBelow: null,
  changePercentAbove: null,
  changePercentBelow: null,
});

const DEFAULT_STATE = Object.freeze({
  windowBounds: null,
  widgets: [],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function coerceNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeThresholds(rawThresholds) {
  return {
    priceAbove: coerceNullableNumber(rawThresholds && rawThresholds.priceAbove),
    priceBelow: coerceNullableNumber(rawThresholds && rawThresholds.priceBelow),
    changePercentAbove: coerceNullableNumber(rawThresholds && rawThresholds.changePercentAbove),
    changePercentBelow: coerceNullableNumber(rawThresholds && rawThresholds.changePercentBelow),
  };
}

function sanitizeWidget(rawWidget) {
  if (!rawWidget || typeof rawWidget !== "object") {
    return null;
  }

  const symbol = normalizeSymbol(rawWidget.symbol);
  if (!symbol) {
    return null;
  }

  return {
    id: String(rawWidget.id || crypto.randomUUID()),
    symbol,
    alertEnabled: Boolean(rawWidget.alertEnabled),
    thresholds: normalizeThresholds(rawWidget.thresholds),
  };
}

function sanitizeWindowBounds(rawBounds) {
  if (!rawBounds || typeof rawBounds !== "object") {
    return null;
  }

  const x = Number(rawBounds.x);
  const y = Number(rawBounds.y);
  const width = Number(rawBounds.width);
  const height = Number(rawBounds.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return { x, y, width, height };
}

function sanitizeState(rawState) {
  const widgets = Array.isArray(rawState && rawState.widgets)
    ? rawState.widgets.map(sanitizeWidget).filter(Boolean)
    : [];

  return {
    windowBounds: sanitizeWindowBounds(rawState && rawState.windowBounds),
    widgets,
  };
}

class AppStore {
  constructor(app) {
    this.filePath = path.join(app.getPath("userData"), "state.json");
    this.state = this.loadState();
  }

  loadState() {
    try {
      const fileContents = fs.readFileSync(this.filePath, "utf8");
      return sanitizeState(JSON.parse(fileContents));
    } catch (_error) {
      return clone(DEFAULT_STATE);
    }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  getState() {
    return clone(this.state);
  }

  getWidgets() {
    return clone(this.state.widgets);
  }

  setWindowBounds(bounds) {
    this.state.windowBounds = sanitizeWindowBounds(bounds);
    this.saveState();
  }

  addWidget(symbol) {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) {
      throw new Error("A ticker symbol is required.");
    }

    const widget = {
      id: crypto.randomUUID(),
      symbol: normalizedSymbol,
      alertEnabled: false,
      thresholds: clone(DEFAULT_THRESHOLDS),
    };

    this.state.widgets.push(widget);
    this.saveState();
    return clone(widget);
  }

  updateWidget(widgetId, patch) {
    const widget = this.state.widgets.find((candidate) => candidate.id === widgetId);
    if (!widget) {
      throw new Error("Widget not found.");
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, "symbol")) {
      const nextSymbol = normalizeSymbol(patch.symbol);
      if (!nextSymbol) {
        throw new Error("A ticker symbol is required.");
      }
      widget.symbol = nextSymbol;
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, "alertEnabled")) {
      widget.alertEnabled = Boolean(patch.alertEnabled);
    }

    if (patch && patch.thresholds) {
      widget.thresholds = normalizeThresholds({
        ...widget.thresholds,
        ...patch.thresholds,
      });
    }

    this.saveState();
    return clone(widget);
  }

  deleteWidget(widgetId) {
    const nextWidgets = this.state.widgets.filter((candidate) => candidate.id !== widgetId);
    const wasDeleted = nextWidgets.length !== this.state.widgets.length;
    this.state.widgets = nextWidgets;

    if (wasDeleted) {
      this.saveState();
    }

    return wasDeleted;
  }
}

module.exports = {
  AppStore,
  DEFAULT_THRESHOLDS,
  normalizeThresholds,
  normalizeSymbol,
};
