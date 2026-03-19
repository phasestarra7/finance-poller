const widgetsBoard = document.getElementById("widgetsBoard");
const loadingTemplate = document.getElementById("loadingTemplate");
const minimizeButton = document.getElementById("minimizeButton");
const closeButton = document.getElementById("closeButton");

const ALERT_FIELDS = [
  { key: "priceAbove", label: "가격 이상" },
  { key: "priceBelow", label: "가격 이하" },
  { key: "changePercentAbove", label: "전일 % 이상" },
  { key: "changePercentBelow", label: "전일 % 이하" },
];

const renderState = {
  snapshot: null,
  addDraftOpen: false,
  addDraftSymbol: "",
  thresholdDrafts: new Map(),
  seenFlashTokens: new Map(),
};

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function iconBell() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9.8 18h4.4"></path>
      <path d="M6 16.4c1.1-1.2 1.7-2.7 1.7-4.3v-1.4c0-2.6 1.6-4.8 4.3-5.1 3.1-.4 5.7 2 5.7 5.1v1.4c0 1.6.6 3.1 1.7 4.3"></path>
      <path d="M5 16.4h14"></path>
    </svg>
  `;
}

function iconTrash() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4.5 6.5h15"></path>
      <path d="M9 6.5V4.8c0-.7.6-1.3 1.3-1.3h3.4c.7 0 1.3.6 1.3 1.3v1.7"></path>
      <path d="M7.2 6.5l.9 12.1c.1 1 .9 1.8 1.9 1.8h4c1 0 1.8-.8 1.9-1.8L16.8 6.5"></path>
      <path d="M10 10.2v6.4"></path>
      <path d="M14 10.2v6.4"></path>
    </svg>
  `;
}

function iconCheck() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5"></path>
    </svg>
  `;
}

function getFocusedFieldMeta() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLInputElement)) {
    return null;
  }

  const fieldKey = activeElement.dataset.fieldKey;
  const widgetId = activeElement.dataset.widgetId;
  if (!fieldKey || !widgetId) {
    return null;
  }

  return {
    fieldKey,
    widgetId,
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd,
  };
}

function restoreFocusedField(meta) {
  if (!meta) {
    return;
  }

  const selector = `input[data-widget-id="${meta.widgetId}"][data-field-key="${meta.fieldKey}"]`;
  const nextInput = widgetsBoard.querySelector(selector);
  if (!(nextInput instanceof HTMLInputElement) || nextInput.disabled) {
    return;
  }

  nextInput.focus({ preventScroll: true });
  if (meta.selectionStart != null && meta.selectionEnd != null) {
    nextInput.setSelectionRange(meta.selectionStart, meta.selectionEnd);
  }
}

function getDraftThresholds(widgetId) {
  return renderState.thresholdDrafts.get(widgetId) || null;
}

function setDraftThreshold(widgetId, fieldKey, rawValue) {
  const currentDrafts = getDraftThresholds(widgetId) || {};
  currentDrafts[fieldKey] = rawValue;
  renderState.thresholdDrafts.set(widgetId, currentDrafts);
}

function clearDraftThresholdsForMissingWidgets(widgetIds) {
  for (const widgetId of renderState.thresholdDrafts.keys()) {
    if (!widgetIds.has(widgetId)) {
      renderState.thresholdDrafts.delete(widgetId);
      renderState.seenFlashTokens.delete(widgetId);
    }
  }
}

function formatTimestamp(isoValue) {
  if (!isoValue) {
    return "Waiting";
  }

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "Waiting";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatPrice(value) {
  if (value == null) {
    return "N/A";
  }

  return priceFormatter.format(value);
}

function formatSignedNumber(value) {
  if (value == null) {
    return "N/A";
  }

  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${priceFormatter.format(value)}`;
}

function formatSignedPercent(value) {
  if (value == null) {
    return "N/A";
  }

  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${compactNumberFormatter.format(value)}%`;
}

function getPriceArrow(direction, hasValue) {
  if (!hasValue) {
    return "•";
  }

  if (direction === "up") {
    return "▲";
  }

  if (direction === "down") {
    return "▼";
  }

  return "•";
}

function getToneClass(direction, hasValue) {
  if (!hasValue || direction === "neutral" || direction === "flat") {
    return "text-neutral";
  }

  return direction === "up" ? "text-up" : "text-down";
}

function buildDayChangeText(widget) {
  if (widget.quote.dayChangeAbs == null || widget.quote.dayChangePercent == null) {
    return "N/A";
  }

  return `(${formatSignedNumber(widget.quote.dayChangeAbs)} | ${formatSignedPercent(widget.quote.dayChangePercent)})`;
}

function getThresholdDisplayValue(widget, fieldKey) {
  const draftThresholds = getDraftThresholds(widget.id);
  if (draftThresholds && Object.prototype.hasOwnProperty.call(draftThresholds, fieldKey)) {
    return draftThresholds[fieldKey];
  }

  const value = widget.thresholds[fieldKey];
  return value == null ? "" : String(value);
}

function renderAlertCell(widget, field) {
  const matched = widget.conditionMatches[field.key];
  const disabled = widget.alertEnabled ? "disabled" : "";
  const value = escapeHtml(getThresholdDisplayValue(widget, field.key));

  return `
    <div class="alert-cell ${matched ? "alert-cell--matched" : ""}">
      <div class="alert-cell__label">${escapeHtml(field.label)}</div>
      <input
        class="alert-cell__input"
        data-widget-id="${widget.id}"
        data-field-key="${field.key}"
        inputmode="decimal"
        type="text"
        spellcheck="false"
        value="${value}"
        ${disabled}
      />
    </div>
  `;
}

function renderWidget(widget) {
  const hasPrice = widget.quote.displayPrice != null && widget.quote.dataState === "ok";
  const priceToneClass = getToneClass(widget.quote.priceDirection, hasPrice);
  const dayToneClass = getToneClass(widget.quote.dayDirection, widget.quote.dayChangeAbs != null);
  const bellClasses = widget.alertEnabled ? "icon-button icon-button--bell" : "icon-button icon-button--bell is-off";
  const statusText =
    widget.quote.dataState === "error"
      ? widget.quote.errorMessage || "N/A"
      : `Updated ${escapeHtml(formatTimestamp(widget.quote.updatedAt))}`;

  return `
    <article class="widget-card" data-widget-id="${widget.id}" data-flash-token="${widget.quote.flashToken}">
      <section class="widget-left">
        <div class="widget-header">
          <div>
            <div class="widget-symbol">${escapeHtml(widget.symbol)}</div>
            <div class="widget-meta">${escapeHtml(widget.quote.displayName || widget.symbol)}</div>
          </div>
        </div>

        <div class="price-caption">
          <div class="widget-price-block ${priceToneClass}">
            <div class="price-arrow">${getPriceArrow(widget.quote.priceDirection, hasPrice)}</div>
            <div class="price-value ${hasPrice ? "" : "price-value--na"}">${escapeHtml(formatPrice(widget.quote.displayPrice))}</div>
          </div>
          <div class="day-change ${dayToneClass}">${escapeHtml(buildDayChangeText(widget))}</div>
        </div>

        <div class="widget-footer">
          <span>${escapeHtml(statusText)}</span>
          <span>${widget.quote.currency ? escapeHtml(widget.quote.currency) : ""}</span>
        </div>
      </section>

      <section class="widget-right">
        <div class="alert-panel ${widget.alertEnabled ? "alert-panel--armed" : ""}">
          <div class="alert-panel__controls">
            <button
              class="${bellClasses}"
              data-action="toggle-alert"
              data-widget-id="${widget.id}"
              title="${widget.alertEnabled ? "알림 끄기" : "알림 켜기"}"
              type="button"
            >
              ${iconBell()}
            </button>
            <button
              class="icon-button icon-button--trash"
              data-action="delete-widget"
              data-widget-id="${widget.id}"
              title="위젯 삭제"
              type="button"
            >
              ${iconTrash()}
            </button>
          </div>

          <div class="alert-grid">
            ${ALERT_FIELDS.map((field) => renderAlertCell(widget, field)).join("")}
            ${widget.alertEnabled ? '<div class="alert-lock" aria-hidden="true"></div>' : ""}
          </div>
        </div>
      </section>
    </article>
  `;
}

function renderAddCard() {
  if (!renderState.snapshot) {
    return "";
  }

  if (renderState.snapshot.widgets.length >= renderState.snapshot.maxWidgets) {
    return "";
  }

  if (!renderState.addDraftOpen) {
    return `
      <button class="add-card" data-action="open-add-card" type="button">
        <span class="add-card__plus">+</span>
      </button>
    `;
  }

  return `
    <div class="add-card add-card--draft">
      <div class="add-card__form">
        <div class="add-card__label">Ticker</div>
        <input
          class="add-card__input"
          id="addTickerInput"
          data-role="add-ticker-input"
          autocomplete="off"
          spellcheck="false"
          value="${escapeHtml(renderState.addDraftSymbol)}"
          placeholder="KRW=X"
        />
        <button class="confirm-button" data-action="confirm-add-widget" title="위젯 추가" type="button">
          ${iconCheck()}
        </button>
      </div>
    </div>
  `;
}

function renderBoard() {
  if (!renderState.snapshot) {
    widgetsBoard.replaceChildren(loadingTemplate.content.cloneNode(true));
    return;
  }

  const scrollTop = widgetsBoard.scrollTop;
  const focusedField = getFocusedFieldMeta();

  const widgetIds = new Set(renderState.snapshot.widgets.map((widget) => widget.id));
  clearDraftThresholdsForMissingWidgets(widgetIds);

  widgetsBoard.innerHTML = `
    ${renderState.snapshot.widgets.map((widget) => renderWidget(widget)).join("")}
    ${renderAddCard()}
  `;

  widgetsBoard.scrollTop = scrollTop;
  restoreFocusedField(focusedField);
  maybeAnimateFlashes();
  maybeFocusAddInput();
}

function maybeAnimateFlashes() {
  widgetsBoard.querySelectorAll(".widget-card").forEach((card) => {
    const widgetId = card.getAttribute("data-widget-id");
    const widget = renderState.snapshot.widgets.find((candidate) => candidate.id === widgetId);

    if (!widget || !widget.quote.flashDirection) {
      return;
    }

    const nextToken = widget.quote.flashToken;
    const previousToken = renderState.seenFlashTokens.get(widget.id);
    if (previousToken === nextToken) {
      return;
    }

    renderState.seenFlashTokens.set(widget.id, nextToken);
    if (widget.quote.flashDirection === "up") {
      card.classList.add("widget-card--flash-up");
    } else if (widget.quote.flashDirection === "down") {
      card.classList.add("widget-card--flash-down");
    } else {
      card.classList.add("widget-card--flash-flat");
    }

    window.setTimeout(() => {
      card.classList.remove("widget-card--flash-up", "widget-card--flash-down", "widget-card--flash-flat");
    }, 950);
  });
}

function maybeFocusAddInput() {
  if (!renderState.addDraftOpen) {
    return;
  }

  const addInput = document.getElementById("addTickerInput");
  if (!(addInput instanceof HTMLInputElement)) {
    return;
  }

  addInput.focus();
  addInput.setSelectionRange(addInput.value.length, addInput.value.length);
}

function syncSnapshot(nextSnapshot) {
  renderState.snapshot = nextSnapshot;
  renderBoard();
}

async function commitThreshold(widgetId, fieldKey, rawValue) {
  const nextValue = rawValue === "" ? null : Number(rawValue);
  const sanitizedValue = nextValue == null || Number.isNaN(nextValue) ? null : nextValue;

  await window.financePoller.updateWidget(widgetId, {
    thresholds: {
      [fieldKey]: sanitizedValue,
    },
  });
}

async function addWidgetFromDraft() {
  const symbol = renderState.addDraftSymbol.trim();
  if (!symbol) {
    return;
  }

  try {
    await window.financePoller.addWidget(symbol);
    renderState.addDraftOpen = false;
    renderState.addDraftSymbol = "";
    renderBoard();
  } catch (error) {
    console.error(error);
  }
}

function cancelAddCard() {
  renderState.addDraftOpen = false;
  renderState.addDraftSymbol = "";
  renderBoard();
}

widgetsBoard.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;
  const widgetId = target.dataset.widgetId;

  if (action === "open-add-card") {
    renderState.addDraftOpen = true;
    renderBoard();
    return;
  }

  if (action === "confirm-add-widget") {
    await addWidgetFromDraft();
    return;
  }

  if (action === "toggle-alert" && widgetId) {
    const widget = renderState.snapshot.widgets.find((candidate) => candidate.id === widgetId);
    if (!widget) {
      return;
    }

    await window.financePoller.updateWidget(widgetId, {
      alertEnabled: !widget.alertEnabled,
    });
    return;
  }

  if (action === "delete-widget" && widgetId) {
    await window.financePoller.deleteWidget(widgetId);
  }
});

widgetsBoard.addEventListener("input", (event) => {
  const target = event.target;

  if (target instanceof HTMLInputElement && target.dataset.role === "add-ticker-input") {
    renderState.addDraftSymbol = target.value.toUpperCase();
    return;
  }

  if (!(target instanceof HTMLInputElement) || !target.dataset.widgetId || !target.dataset.fieldKey) {
    return;
  }

  setDraftThreshold(target.dataset.widgetId, target.dataset.fieldKey, target.value);
});

widgetsBoard.addEventListener(
  "blur",
  async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.widgetId || !target.dataset.fieldKey) {
      return;
    }

    await commitThreshold(target.dataset.widgetId, target.dataset.fieldKey, target.value);
  },
  true
);

widgetsBoard.addEventListener("keydown", async (event) => {
  const target = event.target;

  if (target instanceof HTMLInputElement && target.dataset.role === "add-ticker-input") {
    if (event.key === "Enter") {
      event.preventDefault();
      await addWidgetFromDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelAddCard();
    }
    return;
  }

  if (!(target instanceof HTMLInputElement) || !target.dataset.widgetId || !target.dataset.fieldKey) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    target.blur();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    const widget = renderState.snapshot.widgets.find((candidate) => candidate.id === target.dataset.widgetId);
    if (!widget) {
      return;
    }

    renderState.thresholdDrafts.delete(widget.id);
    target.value = widget.thresholds[target.dataset.fieldKey] == null ? "" : String(widget.thresholds[target.dataset.fieldKey]);
    target.blur();
  }
});

minimizeButton.addEventListener("click", () => {
  window.financePoller.hideWindow();
});

closeButton.addEventListener("click", () => {
  window.financePoller.quitApp();
});

window.financePoller.onStateChanged((nextSnapshot) => {
  syncSnapshot(nextSnapshot);
});

window.financePoller
  .getState()
  .then((snapshot) => {
    syncSnapshot(snapshot);
  })
  .catch((error) => {
    console.error(error);
  });
