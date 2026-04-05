const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require("electron");
const path = require("path");
const Store = require("electron-store");

// Persistent settings store (user preferences survive restarts)
let store;
try {
  store = new Store({ name: "plutarch-overlay" });
} catch {
  // Fallback in-memory store if electron-store is unavailable
  const mem = new Map();
  store = { get: (k, d) => mem.get(k) ?? d, set: (k, v) => mem.set(k, v) };
}

// Default Plutarch dApp URL — can be overridden in settings
const DEFAULT_DAPP_URL = "http://localhost:5174";

let overlayWindow = null;
let tray = null;
let isDev = process.argv.includes("--dev");

function getDappUrl() {
  const base = store.get("dappUrl", DEFAULT_DAPP_URL);
  const ssuId = store.get("ssuId", "");
  const tribeId = store.get("tribeId", "");
  const params = new URLSearchParams({ ssuId, tribeId });
  return `${base}/overlay?${params.toString()}`;
}

function createOverlayWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 320;
  const winH = 480;

  // Restore saved position or default to top-right corner
  const savedX = store.get("windowX", screenW - winW - 16);
  const savedY = store.get("windowY", 16);

  overlayWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: savedX,
    y: savedY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the Plutarch dApp overlay route
  overlayWindow.loadURL(getDappUrl());

  if (isDev) {
    overlayWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Persist window position when moved
  overlayWindow.on("moved", () => {
    const [x, y] = overlayWindow.getPosition();
    store.set("windowX", x);
    store.set("windowY", y);
  });

  // Persist window size when resized
  overlayWindow.on("resized", () => {
    const [w, h] = overlayWindow.getSize();
    store.set("windowW", w);
    store.set("windowH", h);
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function createTray() {
  // Use a simple blank tray icon (replace with real asset in production)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Plutarch Overlay");

  const menu = Menu.buildFromTemplate([
    {
      label: "Show Overlay",
      click: () => {
        if (overlayWindow) {
          overlayWindow.show();
          overlayWindow.focus();
        } else {
          createOverlayWindow();
        }
      },
    },
    {
      label: "Settings",
      click: () => openSettings(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);

  tray.on("double-click", () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
      } else {
        overlayWindow.show();
      }
    }
  });
}

/** Opens a small settings window for dApp URL / SSU configuration. */
function openSettings() {
  const settingsWin = new BrowserWindow({
    width: 480,
    height: 360,
    title: "Plutarch Overlay Settings",
    resizable: false,
    frame: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const currentDappUrl = store.get("dappUrl", DEFAULT_DAPP_URL);
  const currentSsuId = store.get("ssuId", "");
  const currentTribeId = store.get("tribeId", "");
  const currentOpacity = store.get("opacity", "0.9");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Plutarch Overlay Settings</title>
<style>
  body { font-family: monospace; font-size: 13px; background: #0b0b0b; color: #fafae5; padding: 20px; }
  label { display: block; margin-bottom: 4px; color: rgba(250,250,229,0.65); font-size: 11px; letter-spacing: 0.05em; }
  input { width: 100%; padding: 6px 8px; background: #1a1a1a; border: 1px solid rgba(250,250,229,0.2); color: #fafae5; border-radius: 4px; font-family: monospace; font-size: 13px; margin-bottom: 14px; box-sizing: border-box; }
  button { background: #ff6600; color: #000; border: none; padding: 8px 18px; border-radius: 4px; font-family: monospace; font-size: 13px; cursor: pointer; margin-right: 8px; }
  button.secondary { background: #1a1a1a; color: #fafae5; border: 1px solid rgba(250,250,229,0.2); }
  h2 { color: #ff6600; font-size: 14px; margin-bottom: 20px; letter-spacing: 0.1em; }
  .info { font-size: 11px; color: rgba(250,250,229,0.4); margin-top: -10px; margin-bottom: 14px; }
</style>
</head>
<body>
<h2>PLUTARCH OVERLAY SETTINGS</h2>
<label>Plutarch dApp URL</label>
<input id="dappUrl" value="${currentDappUrl}" placeholder="http://localhost:5174" />
<p class="info">The URL where your Plutarch dApp is running (local or tunnelled).</p>

<label>SSU ID (assembly ID)</label>
<input id="ssuId" value="${currentSsuId}" placeholder="0x..." />

<label>Tribe ID</label>
<input id="tribeId" value="${currentTribeId}" placeholder="123" />

<label>Window Opacity (0.3 – 1.0)</label>
<input id="opacity" type="number" min="0.3" max="1" step="0.05" value="${currentOpacity}" />

<div style="margin-top: 8px;">
  <button onclick="save()">Save & Reload</button>
  <button class="secondary" onclick="window.close()">Cancel</button>
</div>

<script>
function save() {
  window.electronAPI.saveSettings({
    dappUrl: document.getElementById('dappUrl').value.trim(),
    ssuId: document.getElementById('ssuId').value.trim(),
    tribeId: document.getElementById('tribeId').value.trim(),
    opacity: document.getElementById('opacity').value,
  });
  window.close();
}
</script>
</body>
</html>`;

  settingsWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// IPC: renderer → main communication
ipcMain.handle("get-settings", () => ({
  dappUrl: store.get("dappUrl", DEFAULT_DAPP_URL),
  ssuId: store.get("ssuId", ""),
  tribeId: store.get("tribeId", ""),
  opacity: store.get("opacity", "0.9"),
}));

ipcMain.handle("save-settings", (_event, settings) => {
  if (settings.dappUrl) store.set("dappUrl", settings.dappUrl);
  if (settings.ssuId !== undefined) store.set("ssuId", settings.ssuId);
  if (settings.tribeId !== undefined) store.set("tribeId", settings.tribeId);
  if (settings.opacity !== undefined) store.set("opacity", settings.opacity);
  // Reload overlay with new settings
  if (overlayWindow) {
    overlayWindow.loadURL(getDappUrl());
  }
});

ipcMain.handle("toggle-click-through", (_event, enabled) => {
  if (overlayWindow) {
    overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
  }
});

ipcMain.handle("set-opacity", (_event, value) => {
  if (overlayWindow) {
    overlayWindow.setOpacity(Math.max(0.1, Math.min(1.0, Number(value))));
  }
});

app.whenReady().then(() => {
  // On macOS, prevent dock icon from appearing for the overlay
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  createOverlayWindow();
  createTray();
});

app.on("window-all-closed", () => {
  // Keep the app running in the tray even after the window is closed
  if (process.platform !== "darwin") {
    // Do nothing — app lives in system tray
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createOverlayWindow();
  }
});
