# Plutarch — Corporate Management for EVE Frontier

A full-featured dApp for managing EVE Frontier corporations on the Sui blockchain. Built with React 19, TypeScript, Vite, and SQLite.

## Features

- **Corporate Storage** — Three-tier on-chain storage (ephemeral → open → main) with escrow management
- **Goal & Mission System** — Create goals, decompose them into missions, assign to wings, track progress
- **Wing Management** — Organise members into wings with role-based assignments
- **Market Board** — Tribal marketplace with buy/sell orders and partial fills
- **Contract System** — Create and manage contracts with on-chain item escrow
- **Delivery System** — Multi-courier delivery logistics with tracking
- **Network Map** — Interactive map of SSU network with territory management
- **Tribe Credits** — Deploy custom Sui coins for your tribe with on-chain vaults
- **Analytics** — Ledger tracking, budget management, and mission analytics
- **Territory Fuel** — Monitor network node fuel levels across your territory

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 10
- [Sui CLI](https://docs.sui.io/build/install) (for tribe coin compilation)
- [EVE Vault](https://evefrontier.com) browser extension

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YourOrg/Plutarch-Eve-Frontier-Sui-Hack.git
cd Plutarch-Eve-Frontier-Sui-Hack

# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env

# Start the dev server
pnpm dev
```

The app will be available at **http://localhost:5174**.

## Exposing via Cloudflare Quick Tunnel

To share access externally (e.g. for testing with the EVE Frontier game client), use [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

```bash
# Install cloudflared (if not already)
# Windows: winget install Cloudflare.cloudflared
# macOS:   brew install cloudflared
# Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Start the tunnel (no account needed)
pnpm tunnel
```

This generates a temporary `*.trycloudflare.com` URL pointing to your local dev server.

> **Note:** The Vite server is configured with `allowedHosts: true` so tunnelled requests work out of the box.

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # Reusable UI components
│   │   └── tribe/          # Tribe management tabs
│   ├── context/            # React contexts (Goals, Contracts, Deployment)
│   ├── data/               # Supply chain / recipe data & mission decomposition
│   ├── hooks/              # Custom React hooks (inventory, market, etc.)
│   ├── lib/                # Utilities (coin bytecode patching)
│   ├── pages/              # Page components (Home, Market, Territory, etc.)
│   └── utils/              # Helper utilities
├── server/                 # Server-side code (runs in Vite dev middleware)
│   ├── db.ts               # SQLite database (Drizzle ORM) — all API logic
│   ├── schema.ts           # Drizzle table definitions
│   └── crypto.ts           # Location encryption utilities
├── public/                 # Static assets (item icons, type metadata)
├── move-contracts/         # Sui Move contracts
│   └── coin_template/      # Template for tribe credit coin compilation
├── vite.config.mts         # Vite config + API middleware (the "server")
├── package.json
├── tsconfig.json
└── drizzle.config.ts
```

## Environment Configuration

| Variable | Description | Default |
|---|---|---|
| `VITE_EVE_TENANT` | EVE Frontier tenant (`utopia` or `stillness`) | `stillness` |

Tenant-specific settings (RPC URLs, package IDs, etc.) are configured in `src/tenants.ts`.

## Available Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start dev server (default tenant) |
| `pnpm dev:stillness` | Start dev server on Stillness |
| `pnpm dev:utopia` | Start dev server on Utopia |
| `pnpm build` | Type-check and build for production |
| `pnpm typecheck` | Run TypeScript type-checker |
| `pnpm tunnel` | Open a Cloudflare Quick Tunnel to localhost:5174 |
| `pnpm db:studio` | Open Drizzle Studio to browse the SQLite database |

## Architecture

The app runs as a **Vite dev server** with API middleware — there's no separate backend process. The `vite.config.mts` registers Express-style middleware handlers under `/api/*` that use SQLite (via Drizzle ORM) for persistence.

- **Frontend**: React 19 with `@mysten/dapp-kit-react` for wallet connection and `@evefrontier/dapp-kit` for EVE Frontier smart object integration
- **Backend**: Vite dev middleware with SQLite (`better-sqlite3`) — all data is in a local `tribe.db` file
- **Blockchain**: Sui testnet transactions for inventory transfers, vault operations, and coin management

## License

MIT
