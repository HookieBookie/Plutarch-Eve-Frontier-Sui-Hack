const { contextBridge, ipcRenderer } = require("electron");

/**
 * Expose a safe, typed API to the renderer process (the Plutarch overlay page).
 * All IPC calls go through this bridge — the renderer never has access to Node.js APIs directly.
 */
contextBridge.exposeInMainWorld("electronAPI", {
  /** Retrieve current overlay settings from the main process store. */
  getSettings: () => ipcRenderer.invoke("get-settings"),

  /** Persist settings and reload the overlay window. */
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  /**
   * Enable or disable click-through mode.
   * When enabled, mouse events pass through the overlay to the game.
   */
  setClickThrough: (enabled) => ipcRenderer.invoke("toggle-click-through", enabled),

  /** Adjust window opacity (0.1 – 1.0). */
  setOpacity: (value) => ipcRenderer.invoke("set-opacity", value),

  /** True when running inside the Electron overlay app (not a browser). */
  isElectron: true,
});
