# Plutarch Overlay — Electron Companion App

A transparent, always-on-top companion window that displays your Plutarch mission subscriptions and alerts while you play Eve Frontier.

---

## Features

- **Always-on-top overlay** — floats above the Eve Frontier game window
- **Real-time mission tracking** — streams live mission progress via Server-Sent Events from the Plutarch dApp
- **Smart alerts** — notifies you when goals are near completion or ready to finalise
- **Click-through mode** — lets mouse clicks pass through the overlay to the game
- **Adjustable opacity** — tune visibility to your preference
- **System tray** — lives in the system tray when minimised, never gets in the way
- **Drag to reposition** — place the overlay anywhere on your screen

---

## Quick Start

### Prerequisites

- Node.js 20+
- A running Plutarch dApp instance (`pnpm dev` from the repo root)

### Install & Run

```bash
cd overlay
npm install
npm start
```

The overlay will open and connect to `http://localhost:5174/overlay` by default.

### Building a Distributable

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Built installers appear in `overlay/dist/`.

---

## Configuration

Right-click the system tray icon → **Settings** to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| **dApp URL** | `http://localhost:5174` | URL of your running Plutarch dApp |
| **SSU ID** | *(empty)* | Your Smart Storage Unit assembly ID (`0x…`) |
| **Tribe ID** | *(empty)* | Your tribe ID (numeric) |
| **Opacity** | `0.9` | Window transparency (0.3 – 1.0) |

You can also use [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (`pnpm tunnel` from the repo root) to expose the dApp over HTTPS, then set the tunnel URL as the dApp URL — this lets you run the overlay on a different machine from your game client.

---

## Mission Subscriptions

Before the overlay can show missions, subscribe to them in the main Plutarch dApp:

1. Open the dApp in your browser
2. Go to **Home** → click **⊞ Overlay** to open the subscription manager  
   *(or browse to the Home page and look for the Overlay section)*
3. Tick the missions you want to track
4. The Electron overlay will pick up your subscriptions in real time

---

## Architecture

```
┌─────────────────────┐      SSE (real-time)      ┌──────────────────────┐
│  Electron Main Proc │ ◄─── /api/overlay-stream ──│ Plutarch dApp        │
│  (always-on-top)    │                            │ (Vite + SQLite API)  │
│                     │      /overlay React page   │                      │
│  BrowserWindow      │ ──── loads SPA route ─────►│ OverlayPage.tsx      │
│  (transparent)      │                            │ MissionCard.tsx      │
└─────────────────────┘                            │ AlertBanner.tsx      │
                                                   └──────────────────────┘
```

The Electron app is a thin shell — all UI logic lives in the Plutarch dApp's `/overlay` React route. This means overlay UI updates automatically when you update the dApp.

---

## ToS Note

This overlay is a **companion application** — it does not inject code into or modify the Eve Frontier game client in any way. It communicates exclusively with the Plutarch dApp backend (your own server). The Eve Frontier developers have expressed intent to open-source the Carbon engine, and companion tools of this kind are within the Terms of Service.
