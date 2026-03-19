const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("financePoller", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  hideWindow: () => ipcRenderer.send("window:hide"),
  quitApp: () => ipcRenderer.send("window:quit"),
  addWidget: (symbol) => ipcRenderer.invoke("widgets:add", { symbol }),
  updateWidget: (widgetId, patch) =>
    ipcRenderer.invoke("widgets:update", {
      widgetId,
      patch,
    }),
  deleteWidget: (widgetId) => ipcRenderer.invoke("widgets:delete", { widgetId }),
  onStateChanged: (listener) => {
    const wrappedListener = (_event, nextState) => listener(nextState);
    ipcRenderer.on("state:changed", wrappedListener);

    return () => {
      ipcRenderer.removeListener("state:changed", wrappedListener);
    };
  },
});
