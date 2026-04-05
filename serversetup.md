# Server Setup — Plutarch EVE Frontier dApp

How to start the Vite dev server and expose it via a Cloudflare Quick
Tunnel so the EVE Frontier world server can reach your endpoints.

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js ≥ 18 | <https://nodejs.org> |
| pnpm | `npm i -g pnpm` |
| cloudflared | `winget install Cloudflare.cloudflared` (or <https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/>) |

---

## Step 1 — Kill anything on port 5174

If a previous Vite instance is still running, the new one will try to use
a different port. We need port **5174** specifically.

```powershell
$pids = Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
    $pids | ForEach-Object { Stop-Process -Id $_ -Force }
    Write-Host "Killed process(es) on port 5174: $($pids -join ', ')"
} else {
    Write-Host "Port 5174 is free"
}
```

Bash equivalent:

```bash
lsof -ti :5174 | xargs -r kill -9
```

---

## Step 2 — Start the Vite dev server

> **CRITICAL (Windows):** When a VS Code background terminal session is
> used, the shell's working directory **always resets to the workspace
> root**, regardless of any earlier `cd`. This means `npx vite` can start
> from the wrong folder and serve 404 for everything.
>
> The fix is to use `cmd.exe /c "cd /d <path> && npx vite"` so the
> directory change and the server launch happen in a **single atomic
> command**.

### Recommended command (Windows)

```powershell
Start-Process cmd.exe -ArgumentList '/c', 'cd /d c:\Users\jamie\Documents\GitHub\Plutarch-Eve-Frontier-Sui-Hack && npx vite --port 5174' -WindowStyle Hidden
```

### Recommended command (macOS / Linux)

```bash
cd /path/to/Plutarch-Eve-Frontier-Sui-Hack && npx vite --port 5174 &
```

### Using pnpm script

If running interactively (foreground terminal):

```bash
pnpm dev          # Stillness (default)
pnpm dev:utopia   # Utopia
```

Wait ~5 seconds for the server to start.

### Step 2b — Verify the server started from the correct directory

```powershell
if (Get-NetTCPConnection -LocalPort 5174 -EA 0) {
    $r = Invoke-WebRequest -Uri "http://localhost:5174/" -UseBasicParsing -TimeoutSec 5
    Write-Host "Status: $($r.StatusCode)  Body: $($r.Content.Length) bytes"
} else {
    Write-Host "ERROR: Nothing listening on 5174"
}
```

- **Status 200** with body > 500 bytes = correct. Proceed to Step 3.
- **Status 404** or body is empty = **wrong working directory**. Kill port
  5174 (Step 1) and redo Step 2.
- **Nothing listening** = server failed to start. Check for errors.

### Common pitfall — port already in use

If Vite prints a message like `Port 5174 is in use, trying 5175…`, you
**did not complete Step 1 properly**. Go back and kill the process on 5174.
Do **not** accept the alternative port.

### Common pitfall — wrong working directory (404 on everything)

If the server is listening on 5174 but returns **404 for every URL**
(including `/` and `/index.html`), Vite started from the wrong directory.
This is the most common mistake. The symptoms:
- `http://localhost:5174/` → 404 with empty body
- `http://localhost:5174/api/ssu-list` → 404
- Chrome shows: `Unsafe attempt to load URL http://localhost:5174/`

**Fix:** Kill the process on 5174 and restart using the `cmd.exe` method
above. Do not use `cd` followed by `npx vite` in a background shell.

### Config reference

The port and `allowedHosts` are set in `vite.config.mts`:

```ts
server: {
  port: 5174,
  allowedHosts: true,   // required for tunnel domains
},
```

`allowedHosts: true` is already configured — do **not** remove it or the
tunnel will return "Invalid Host" errors.

---

## Step 3 — Kill stale cloudflared processes

**Why:** Old `cloudflared` processes from previous sessions often linger in
the background. They hold metrics ports and can conflict with a new tunnel,
causing it to silently fail or serve a dead hostname. **Always kill all
existing cloudflared processes before starting a new tunnel.**

```powershell
Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
Write-Host "All cloudflared processes killed"
```

Verify none remain:

```powershell
Get-Process cloudflared -ErrorAction SilentlyContinue
```

This should return nothing.

---

## Step 4 — Start the Cloudflare quick tunnel (background)

### Using pnpm script

```bash
pnpm tunnel
```

### Or manually

```
cloudflared tunnel --url http://localhost:5174
```

> **Agent note:** Use `isBackground: true` when calling `run_in_terminal`.

### How to get the public URL

The tunnel URL is **not always visible** in the terminal output (it can be
buried in stderr or truncated). The reliable method is:

#### 1. Find the metrics port

The metrics port is **not fixed** — cloudflared picks an available port
each time. Find it by checking which port the cloudflared process is
listening on:

```powershell
Start-Sleep -Seconds 8   # give tunnel time to establish
$cfPids = Get-Process cloudflared -EA 0 | Select-Object -Exp Id
$ports = Get-NetTCPConnection -OwningProcess $cfPids -State Listen -EA 0 |
         Select-Object -Exp LocalPort -Unique | Sort-Object
Write-Host "Metrics port(s): $($ports -join ', ')"
```

#### 2. Query the quicktunnel endpoint

```powershell
(Invoke-WebRequest -Uri "http://127.0.0.1:<METRICS_PORT>/quicktunnel" -UseBasicParsing -TimeoutSec 5).Content
```

Replace `<METRICS_PORT>` with the port found above. The response is JSON:

```json
{"hostname":"<subdomain>.trycloudflare.com"}
```

The public URL is `https://<subdomain>.trycloudflare.com`.

#### 3. Verify the tunnel serves the dapp

**Do not skip this.** A tunnel can report a hostname but fail to proxy
requests (e.g. if it inherited a stale connection).

```powershell
$r = Invoke-WebRequest -Uri "https://<subdomain>.trycloudflare.com/" -UseBasicParsing -TimeoutSec 10
Write-Host "Status: $($r.StatusCode)  Body: $($r.Content.Length) bytes"
```

- **Status 200** with body > 500 bytes = working. Done.
- **Any error or empty body** = tunnel is broken. Kill cloudflared
  (Step 3), then redo Step 4.

### Common pitfalls

- **"Cannot determine default origin certificate path"** — This is a
  **warning**, not an error. Quick tunnels don't need a cert. Ignore it.
- **Tunnel connects but site shows "Invalid Host header"** — This means
  `allowedHosts: true` is missing from the Vite config. See Step 2.
- **Stale cloudflared processes** — The most common cause of tunnel
  failures. Old `cloudflared` processes from previous sessions stick
  around indefinitely and can claim metrics ports or interfere with new
  tunnels. Always run Step 3 before starting a new tunnel.

---

## Step 5 — Verify everything works

1. **Local check:** Open `http://localhost:5174` in a browser (or
   `Invoke-WebRequest`). The server **must** respond with **HTTP 200**.
   A **404 is NOT OK** — it means the server is running from the wrong
   directory (see Step 2 pitfalls).
2. **Tunnel check:** Open the `https://…trycloudflare.com` URL. You should
   see the dapp loading. Verify with `Invoke-WebRequest` as shown in
   Step 4.

---

## Teardown

To stop everything later:

1. Kill the Vite dev server (Ctrl+C in its terminal, or kill port 5174 as
   in Step 1).
2. Kill the cloudflared process (Ctrl+C in its terminal, or
   `Stop-Process -Name cloudflared`).

---

## Quick-reference summary

```powershell
# 1. Free port 5174
Get-NetTCPConnection -LocalPort 5174 -EA 0 | Select -Exp OwningProcess -Unique | %{ Stop-Process -Id $_ -Force }

# 2. Start dev server (MUST use cmd.exe to set correct working directory)
Start-Process cmd.exe -ArgumentList '/c','cd /d c:\Users\jamie\Documents\GitHub\Plutarch-Eve-Frontier-Sui-Hack && npx vite --port 5174' -WindowStyle Hidden
Start-Sleep -Seconds 5
# Verify: must be 200, NOT 404
(Invoke-WebRequest http://localhost:5174/ -UseBasicParsing -TimeoutSec 5).StatusCode

# 3. Kill ALL stale cloudflared processes
Stop-Process -Name cloudflared -Force -EA 0

# 4. Start tunnel (background)
cloudflared tunnel --url http://localhost:5174

# 5. Find metrics port + get tunnel URL
Start-Sleep -Seconds 8
$cfPids = Get-Process cloudflared -EA 0 | Select -Exp Id
$metricsPort = Get-NetTCPConnection -OwningProcess $cfPids -State Listen -EA 0 | Select -Exp LocalPort -Unique | Sort | Select -First 1
(Invoke-WebRequest "http://127.0.0.1:$metricsPort/quicktunnel" -UseBasicParsing -TimeoutSec 5).Content

# 6. Verify tunnel serves the dapp
$url = (ConvertFrom-Json (Invoke-WebRequest "http://127.0.0.1:$metricsPort/quicktunnel" -UseBasicParsing).Content).hostname
(Invoke-WebRequest "https://$url/" -UseBasicParsing -TimeoutSec 10).StatusCode  # must be 200
```

---

## Running the Overlay locally (dev mode)

Follow Steps 1–4 above first so the dApp is running on port 5174.
The Electron overlay defaults to `http://localhost:5174` and will work with
the local server and/or the Cloudflare tunnel URL.

> **Why local, not ef-plutarch.com?**  The overlay is on a feature branch
> and has not been merged into `main`. Running it locally against port 5174
> keeps the live service at `ef-plutarch.com` completely untouched.

### Step A — Install overlay dependencies (one-time)

From the repository root:

```bash
pnpm overlay:install
```

Or directly:

```bash
cd overlay && npm install
```

### Step B — Start the Electron overlay

Open a **new terminal** (keep the dApp terminal running) and run one of:

```bash
# From repo root (recommended):
pnpm overlay:dev      # Electron + DevTools, targets http://localhost:5174

# Or with full dev tools disabled:
pnpm overlay:start    # same but no DevTools

# Or from inside the overlay directory:
cd overlay
npm run dev           # Electron + DevTools
npm start             # no DevTools
```

The overlay window opens immediately and connects to the dApp at
`http://localhost:5174/overlay`.

### Step C — Verify the connection

1. The overlay title-bar shows a **green status dot** when the SSE stream
   is live.  An orange/red dot means it cannot reach the dApp.
2. Open `http://localhost:5174` in a browser, navigate to **Home**, and use
   the **⊞ Overlay** button (bottom-right) to open the subscription manager.
   Tick the missions you want to track — the Electron window updates within
   10 seconds.

### Using the Cloudflare tunnel URL instead of localhost

If you need the Electron overlay to point at the public tunnel URL (e.g. to
test from a different machine, or to share with a co-player during the
hackathon), open Settings from the system-tray icon and change the
**dApp URL** field:

```
https://<subdomain>.trycloudflare.com
```

Save and the overlay reloads against the tunnel.  **The tunnel must be
running** (Step 4) or the overlay will show a red status dot.

### Teardown

Stop the overlay by closing its window or via the tray → **Quit**.
The dApp (port 5174) and the tunnel can then be stopped independently as
described in the Teardown section above.
