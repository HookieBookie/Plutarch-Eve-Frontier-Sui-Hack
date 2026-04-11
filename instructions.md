# SUI Arbitrage Bot — Build, Deploy & Fund Instructions

> Based on [MystenLabs/capybot](https://github.com/MystenLabs/capybot).  
> This document guides you from a fresh clone through full production deployment on a VPS.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Project Structure Overview](#3-project-structure-overview)
4. [Configure Environment Variables](#4-configure-environment-variables)
5. [Choose & Configure an RPC Endpoint](#5-choose--configure-an-rpc-endpoint)
6. [Understand and Customize Strategies](#6-understand-and-customize-strategies)
7. [Add or Modify Liquidity Pools](#7-add-or-modify-liquidity-pools)
8. [Add a New DEX Adapter](#8-add-a-new-dex-adapter)
9. [Set Profit Thresholds & Gas Limits](#9-set-profit-thresholds--gas-limits)
10. [Build & Test Locally](#10-build--test-locally)
11. [Choose a VPS](#11-choose-a-vps)
12. [Deploy to VPS](#12-deploy-to-vps)
13. [Run as a Background Service (systemd)](#13-run-as-a-background-service-systemd)
14. [Fund the Trading Wallet](#14-fund-the-trading-wallet)
15. [Monitor the Bot](#15-monitor-the-bot)
16. [Security Checklist](#16-security-checklist)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Prerequisites

Install the following on your local machine before starting:

- **Node.js** v18 or later — https://nodejs.org
- **npm** v9 or later (bundled with Node.js)
- **Git** — https://git-scm.com
- A **SUI wallet** with a funded address (see §14)
- A **VPS** running Ubuntu 22.04 LTS (see §11)

---

## 2. Clone & Install

```bash
# Clone the capybot repository
git clone https://github.com/MystenLabs/capybot.git sui-arbitrage-bot
cd sui-arbitrage-bot

# Install dependencies
npm install

# Verify the build works
npm run build
```

---

## 3. Project Structure Overview

```
sui-arbitrage-bot/
├── src/
│   ├── index.ts              # Entry point — register pools, strategies, start loop
│   ├── capybot.ts            # Core orchestrator: polling loop + trade submission
│   ├── logger.ts             # Structured logger (Pino)
│   ├── coins/                # Coin type address constants
│   ├── dexs/
│   │   ├── pool.ts           # Abstract Pool base class
│   │   ├── cetus/            # Cetus CLMM adapter
│   │   ├── turbos/           # Turbos CLMM adapter
│   │   └── suiswap/          # Suiswap adapter
│   ├── strategies/
│   │   ├── strategy.ts       # Abstract Strategy base class
│   │   ├── arbitrage.ts      # Multi-hop triangular arbitrage
│   │   ├── ride_the_trend.ts # Moving average trend following
│   │   └── market_difference.ts # CEX vs DEX price divergence
│   └── data_sources/         # External price feed connectors (Binance/CCXT)
├── package.json
├── tsconfig.json
└── .env                      # Secret config (gitignored — you create this)
```

---

## 4. Configure Environment Variables

Create a `.env` file in the project root. **Never commit this file.**

```bash
# .env — DO NOT COMMIT
ADMIN_PHRASE="word1 word2 word3 ... word12"   # BIP39 mnemonic for your trading wallet
ADMIN_ADDRESS="0xYOUR_SUI_ADDRESS_HERE"        # Hex address of the wallet above
SUI_RPC_URL="https://YOUR_RPC_ENDPOINT_HERE"   # See §5
```

Load `.env` in your code by adding this at the top of `src/index.ts` (if not already present):

```typescript
import * as dotenv from "dotenv";
dotenv.config();
```

---

## 5. Choose & Configure an RPC Endpoint

The bot calls the SUI RPC on every polling interval (default: every 1 second). A fast, reliable, and rate-limit-free RPC is essential.

### Free / Public Options (good for testing)

| Provider | URL | Notes |
|---|---|---|
| MystenLabs (Mainnet) | `https://fullnode.mainnet.sui.io` | Official, rate-limited |
| MystenLabs (Testnet) | `https://fullnode.testnet.sui.io` | For testing only |
| Suiscan | `https://rpc.suiscan.xyz:443` | Public, may throttle |

### Paid / Dedicated Options (recommended for production)

| Provider | URL | Cost | Notes |
|---|---|---|---|
| **Triton One** | https://triton.one | ~$49/mo | Lowest latency, SUI-native |
| **Shinami** | https://shinami.com | Free tier + pay-as-you-go | Great for low-volume bots |
| **Chainbase** | https://chainbase.com | Free tier available | Multi-chain |
| **Alchemy** | https://alchemy.com | Free tier + paid | Reliable, SUI supported |
| **BlockVision** | https://blockvision.org | Free tier available | SUI-focused |
| **QuickNode** | https://quicknode.com | ~$9/mo starter | Well-known, reliable |

> **Recommendation:** Start with **Shinami** (generous free tier) or **QuickNode** ($9/mo) for a cost-effective production setup. Upgrade to **Triton One** if you need the absolute lowest latency.

Set your chosen URL in `.env`:

```bash
SUI_RPC_URL="https://api.shinami.com/node/v1/YOUR_API_KEY"
```

Then update `src/capybot.ts` (or wherever the SUI client is initialized) to read this variable:

```typescript
import { SuiClient, getFullnodeUrl } from "@mysten/sui.js/client";

const rpcUrl = process.env.SUI_RPC_URL ?? getFullnodeUrl("mainnet");
const suiClient = new SuiClient({ url: rpcUrl });
```

---

## 6. Understand and Customize Strategies

All strategies live in `src/strategies/`. Each extends the abstract `Strategy` class and must implement:

```typescript
evaluate(dataPoint: DataPoint, dataSource: string): Order[]
```

### Included Strategies

#### `Arbitrage` — Triangular / Multi-hop Arbitrage
Detects profit when the product of prices along a chain of pools deviates from 1.

```typescript
// Example: SUI → USDC (Turbos) → CETUS (Cetus) → SUI (Cetus)
capybot.addStrategy(
  new Arbitrage(
    [
      { pool: turbosSUItoUSDC.uri, a2b: true },
      { pool: cetusUSDCtoCETUS.uri, a2b: true },
      { pool: cetusCETUStoSUI.uri, a2b: true },
    ],
    defaultAmount[coins.SUI],   // Starting trade size (in MIST)
    1.0001,                      // Minimum profit threshold (0.01% net gain)
    "Arbitrage: SUI → USDC → CETUS → SUI"
  )
);
```

**Tuning tips:**
- Lower `limit` (e.g. `1.00005`) = more trades, smaller profit per trade
- Higher `limit` (e.g. `1.005`) = fewer trades, larger profit per trade, safer
- Always ensure `limit` covers gas costs at minimum

#### `RideTheTrend` — Moving Average Crossover
Trades when a short-term moving average crosses a long-term moving average.

```typescript
capybot.addStrategy(
  new RideTheTrend(
    cetusUSDCtoSUI.uri,
    5,       // Short window (seconds)
    10,      // Long window (seconds)
    [defaultAmount[coins.USDC], defaultAmount[coins.SUI]],
    1.000005,
    "RideTheTrend (USDC/SUI)"
  )
);
```

#### `MarketDifference` — CEX vs DEX Divergence
Exploits price gaps between a Binance spot price and an on-chain DEX pool.

```typescript
capybot.addStrategy(
  new MarketDifference(
    cetusWBTCtoUSDC,
    "BinanceBTCtoUSDC",
    [defaultAmount[coins.WBTC], defaultAmount[coins.USDC]],
    1.01,    // 1% minimum divergence before trading
    "Market diff: WBTC/USDC Binance vs Cetus"
  )
);
```

### Writing a Custom Strategy

```typescript
// src/strategies/my_strategy.ts
import { Strategy } from "./strategy";
import { Order } from "./order";

export class MyStrategy extends Strategy {
  constructor(
    private poolUri: string,
    private amount: number,
    private limit: number,
    name: string
  ) {
    super(name);
    this.subscribe(poolUri); // Subscribe to data from this pool
  }

  evaluate(dataPoint: number, dataSource: string): Order[] {
    // Implement your logic here
    // Return [] if no trade, or [{ pool, a2b, amount }] to execute a swap
    if (/* your condition */) {
      return [{ pool: this.poolUri, a2b: true, amount: this.amount }];
    }
    return [];
  }
}
```

Register in `src/index.ts`:

```typescript
capybot.addStrategy(new MyStrategy(myPool.uri, defaultAmount[coins.SUI], 1.001, "My Strategy"));
```

---

## 7. Add or Modify Liquidity Pools

Pool addresses for Cetus, Turbos, and Suiswap are listed in the capybot README. To add a pool:

```typescript
// src/index.ts
import { CetusPool } from "./dexs/cetus/cetus";

const myNewPool = new CetusPool(
  "0xPOOL_ADDRESS_ON_CHAIN",
  coins.TOKEN_A,
  coins.TOKEN_B
);
capybot.addPool(myNewPool);
```

To find pool addresses:
- **Cetus:** https://app.cetus.zone (inspect pool URLs or use the Cetus SDK)
- **Turbos:** https://app.turbos.finance
- **DeepBook:** https://deepbook.mystenlabs.com
- **FlowX:** https://flowx.finance

Add new coin type addresses to the `coins` map at the top of `src/index.ts`.

---

## 8. Add a New DEX Adapter

To support a DEX not already in the codebase (e.g. DeepBook, FlowX, Aftermath):

1. Create `src/dexs/<dex_name>/<dex_name>.ts`
2. Extend `Pool`:

```typescript
import { Pool } from "../pool";
import { Order } from "../../strategies/order";

export class MyDexPool extends Pool {
  constructor(address: string, coinTypeA: string, coinTypeB: string) {
    super(address, coinTypeA, coinTypeB);
  }

  async getPrice(): Promise<number> {
    // Fetch current price from on-chain state or SDK
    // Return price as coinB per coinA
  }

  async createSwapTransaction(order: Order): Promise<TransactionBlock> {
    // Build and return the SUI TransactionBlock for this swap
  }
}
```

3. Register in `src/index.ts` just like existing pools.

---

## 9. Set Profit Thresholds & Gas Limits

In `src/index.ts`, adjust these constants to match current network conditions:

```typescript
// Minimum net profit required before executing a trade (relative multiplier)
// 1.0001 = at least 0.01% profit after fees
const ARBITRAGE_RELATIVE_LIMIT = 1.0001;
const RIDE_THE_TREND_LIMIT = 1.000005;
const MARKET_DIFFERENCE_LIMIT = 1.01;

// Max SUI gas budget per transaction block (in MIST). Adjust based on gas price oracle.
export const MAX_GAS_PRICE_PER_TRANSACTION = 4_400_000; // ~0.0044 SUI
```

> **Important:** Always set `ARBITRAGE_RELATIVE_LIMIT` high enough to cover gas costs. At current gas prices (~0.002–0.005 SUI per tx), a 0.01% profit on a 1 SUI trade = 0.0001 SUI — which barely covers gas. Increase trade size or threshold accordingly.

---

## 10. Build & Test Locally

```bash
# Compile TypeScript
npm run build

# Dry run (check logs without funding the wallet)
export ADMIN_PHRASE="your mnemonic here"
export ADMIN_ADDRESS="0xyouraddress"
npm run start

# The bot will log identified opportunities even if the wallet has zero balance
# Watch logs for "Arbitrage opportunity found" messages to validate strategies
```

To run for a custom duration, edit the last line in `src/index.ts`:

```typescript
// Run for 24 hours (86,400,000 ms), polling every 1 second
capybot.loop(86_400_000, 1000);
```

---

## 11. Choose a VPS

The bot is lightweight (~50–100 MB RAM, minimal CPU). Any small VPS works.

### Recommended VPS Providers (cheapest to most capable)

| Provider | Plan | Price | Specs | Notes |
|---|---|---|---|---|
| **Hetzner** | CX11 | ~€3.29/mo | 1 vCPU, 2 GB RAM | Best value in Europe; lowest latency to EU RPC nodes |
| **Contabo** | VPS S | ~$5.50/mo | 4 vCPU, 8 GB RAM | Cheap, good specs; can be slow to provision |
| **Vultr** | Cloud Compute 1GB | $6/mo | 1 vCPU, 1 GB RAM | Global locations; great for Asia/US proximity |
| **DigitalOcean** | Droplet Basic | $6/mo | 1 vCPU, 1 GB RAM | Easy to use; reliable |
| **Linode (Akamai)** | Nanode 1GB | $5/mo | 1 vCPU, 1 GB RAM | Reliable; many locations |

> **Recommendation:** **Hetzner CX11** (~€3.29/mo) for EU, or **Vultr 1GB** ($6/mo) for US/Asia. Both are well within budget and more than powerful enough.

### VPS Location Tips
- Choose a data center geographically close to your RPC provider's servers
- Triton One (US East) → pick a US East VPS
- Shinami (US) → US VPS
- Lower latency between bot and RPC = faster price checks and transaction submission

---

## 12. Deploy to VPS

### 12.1 Initial VPS Setup (Ubuntu 22.04)

```bash
# Connect to VPS
ssh root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install git
apt install -y git

# Verify
node --version   # should be v18.x.x
npm --version    # should be 9.x.x
```

### 12.2 Deploy the Bot

```bash
# Clone the repository onto the VPS
git clone https://github.com/MystenLabs/capybot.git /opt/sui-arbitrage-bot
cd /opt/sui-arbitrage-bot

# Install dependencies
npm install

# Build
npm run build

# Create environment file
cat > /opt/sui-arbitrage-bot/.env << 'EOF'
ADMIN_PHRASE=word1 word2 word3 ... word12
ADMIN_ADDRESS=0xYOUR_ADDRESS
SUI_RPC_URL=https://YOUR_RPC_ENDPOINT
EOF

chmod 600 /opt/sui-arbitrage-bot/.env   # Restrict read access to root only
```

---

## 13. Run as a Background Service (systemd)

Create a systemd service so the bot restarts automatically on crash or reboot.

```bash
cat > /etc/systemd/system/sui-bot.service << 'EOF'
[Unit]
Description=SUI Arbitrage Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sui-arbitrage-bot
EnvironmentFile=/opt/sui-arbitrage-bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable sui-bot
systemctl start sui-bot

# Check status
systemctl status sui-bot

# View live logs
journalctl -u sui-bot -f
```

---

## 14. Fund the Trading Wallet

### Create a Dedicated Trading Wallet

Never reuse your personal wallet. Create a fresh wallet specifically for the bot:

```bash
# Using the SUI CLI (install from https://docs.sui.io/references/cli)
sui client new-address ed25519

# Note the address and export the mnemonic
# Fund this address before starting the bot
```

### How Much to Fund

| Trade Size | Recommended Balance | Notes |
|---|---|---|
| ~1 USD per trade | 5–10 SUI | Minimum viable; low profit |
| ~10 USD per trade | 50–100 SUI | Reasonable starting point |
| ~100 USD per trade | 500+ SUI | Better profit-to-gas ratio |

The bot trades `defaultAmount` per opportunity (set to ~1 USD equivalent by default in `src/index.ts`). Increase `defaultAmount` values to scale profit — but also increases risk.

### Transfer SUI to the Bot Wallet

Use any SUI wallet (Sui Wallet, Suiet, Phantom) to send SUI to `ADMIN_ADDRESS`. The bot will use this balance to execute trades.

---

## 15. Monitor the Bot

### Live Logs on VPS

```bash
journalctl -u sui-bot -f --output=cat
```

### Capybot Monitor (Python visualizer)

The official capybot monitor generates live price plots:

```bash
# On your local machine
git clone https://github.com/MystenLabs/capybot-monitor.git
cd capybot-monitor
pip install -r requirements.txt
python monitor.py
```

### Check Wallet Balance

```bash
# Using SUI CLI
sui client balance --address 0xYOUR_ADDRESS
```

### Key Log Messages to Watch

| Log Message | Meaning |
|---|---|
| `"Arbitrage opportunity found"` | Profitable trade detected |
| `"Submitting transaction"` | Trade being executed |
| `"Transaction failed"` | Trade failed (gas, slippage, etc.) |
| `"Price updated"` | Normal polling — pools are being monitored |

---

## 16. Security Checklist

- [ ] `.env` file is in `.gitignore` and not committed
- [ ] VPS firewall blocks all inbound ports except SSH (22): `ufw allow 22 && ufw enable`
- [ ] `.env` file permissions are `600` (`chmod 600 .env`)
- [ ] Trading wallet is separate from personal/hot wallet
- [ ] `ADMIN_PHRASE` is backed up securely offline (paper or hardware wallet)
- [ ] Bot wallet holds only the capital needed for trading (not your entire holdings)
- [ ] SSH key authentication enabled on VPS (password auth disabled)
- [ ] `MAX_GAS_PRICE_PER_TRANSACTION` is set to prevent runaway gas spend
- [ ] `ARBITRAGE_RELATIVE_LIMIT` is set high enough to cover gas costs

---

## 17. Troubleshooting

### Bot crashes with `Error: ADMIN_PHRASE is undefined`
→ Make sure `.env` exists and `dotenv.config()` is called before any environment variable access.

### `npm run build` fails with TypeScript errors
→ Run `npm install` to ensure all dependencies are installed, then retry.

### Transactions fail with `Insufficient gas`
→ Increase `MAX_GAS_PRICE_PER_TRANSACTION` in `src/index.ts` and ensure the wallet has enough SUI.

### No opportunities found (bot runs but never trades)
→ Lower `ARBITRAGE_RELATIVE_LIMIT` slightly, or add more pools/routes. Also verify the RPC is returning fresh data (check timestamps in logs).

### RPC rate limit errors (`429 Too Many Requests`)
→ Switch to a paid RPC endpoint (see §5) or add a delay between polling calls.

### Bot finds opportunities but transactions are rejected
→ Slippage may be too high, or another bot front-ran the trade. Increase `limit` slightly, or reduce `defaultAmount` to reduce market impact.

### Logs show stale prices (not updating)
→ The RPC may be lagging. Try a different RPC endpoint with lower latency.
