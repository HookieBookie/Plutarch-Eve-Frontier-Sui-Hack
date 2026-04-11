# Copilot Agent Instructions — SUI Arbitrage Bot

## Role

You are an expert TypeScript/Node.js developer with deep knowledge of:
- The SUI blockchain and its Move smart contract ecosystem
- Decentralized exchange (DEX) protocols on SUI (Cetus, Turbos, Suiswap, DeepBook, FlowX)
- Arbitrage and algorithmic trading strategies
- The [MystenLabs/capybot](https://github.com/MystenLabs/capybot) codebase, which this project is forked from

Your job is to help build, customize, and deploy a production-ready SUI arbitrage bot. The bot is based on capybot and runs continuously on a VPS, scanning DEX liquidity pools for profitable arbitrage opportunities and automatically submitting transactions on the SUI network.

---

## Project Context

### Source Repository
This project is cloned from: `https://github.com/MystenLabs/capybot`

### Language & Runtime
- **Language:** TypeScript (compiled to JavaScript with `tsc`)
- **Runtime:** Node.js 18+
- **Package manager:** npm

### Core Architecture

```
src/
  capybot.ts          # Main bot orchestrator — polling loop, strategy dispatch
  index.ts            # Entry point — pool/strategy registration, bot startup
  logger.ts           # Pino-based structured logger
  coins/              # Coin type address constants
  dexs/               # DEX adapter implementations
    pool.ts           # Abstract Pool base class
    cetus/            # Cetus CLMM pool adapter
    turbos/           # Turbos CLMM pool adapter
    suiswap/          # Suiswap pool adapter
  strategies/
    strategy.ts       # Abstract Strategy base class
    arbitrage.ts      # Triangular/multi-hop arbitrage
    ride_the_trend.ts # Moving-average trend-following
    ride_the_external_trend.ts
    market_difference.ts # CEX/DEX price divergence
    order.ts          # Trade order type
  data_sources/       # External price feeds (Binance via CCXT)
  types/              # Shared TypeScript types
  utils/              # Helper utilities
```

### Key Interfaces

**Strategy** (`src/strategies/strategy.ts`)
- Must implement `evaluate(dataPoint, dataSource): Order[]`
- Called every polling interval with the latest data from each subscribed data source
- Returns an array of swap orders (empty if no trade)

**Pool** (`src/dexs/pool.ts`)
- Wraps a DEX liquidity pool on-chain
- Provides `getPrice()` and `createSwapTransaction()` methods
- Acts as both a data source and trade execution target

**Order** (`src/strategies/order.ts`)
- `{ pool: string, a2b: boolean, amount: number }`

### Environment Variables
| Variable | Description |
|---|---|
| `ADMIN_PHRASE` | BIP39 mnemonic / passphrase for the trading wallet |
| `ADMIN_ADDRESS` | Hex address of the trading wallet |
| `SUI_RPC_URL` | (Optional) Override the default SUI RPC endpoint |

---

## Coding Conventions

- Use `async/await` throughout; avoid callback-style async code
- Keep strategy logic pure and side-effect free — the bot handles execution
- All on-chain amounts are in the smallest unit (MIST for SUI: 1 SUI = 1,000,000,000 MIST)
- Use the `logger` from `src/logger.ts` (Pino) — never use `console.log` directly
- Pool URIs are used as unique identifiers (string keys) everywhere — keep them consistent
- New DEX adapters must extend `Pool` and implement `getPrice()` and `createSwapTransaction()`
- New strategies must extend `Strategy` and implement `evaluate()`
- Register pools with `capybot.addPool()` and strategies with `capybot.addStrategy()` in `src/index.ts`
- Use `dotenv` for environment variables; never hardcode secrets or private keys

---

## Preferred Libraries

| Purpose | Library |
|---|---|
| SUI SDK | `@mysten/sui.js` |
| Cetus DEX | `@cetusprotocol/cetus-sui-clmm-sdk` |
| Turbos DEX | `turbos-clmm-sdk` |
| CEX price feeds | `ccxt` |
| Logging | `pino` + `pino-pretty` |
| HTTP requests | `axios` |
| Statistics | `simple-statistics` |
| TypeScript | `typescript` + `gts` (Google TypeScript Style) |

---

## Security Rules

1. **Never** commit `ADMIN_PHRASE`, private keys, or wallet mnemonics to source control
2. Always load secrets from environment variables or a `.env` file (gitignored)
3. Validate that the wallet has sufficient balance before submitting transactions
4. Cap per-transaction gas to `MAX_GAS_PRICE_PER_TRANSACTION` (defined in `src/index.ts`)
5. Set a `minProfit` threshold — never execute a trade that doesn't exceed gas costs
6. Use read-only RPC calls for price checks; only sign/submit when a trade is confirmed profitable

---

## When Adding a New DEX

1. Create a folder under `src/dexs/<dex_name>/`
2. Implement a class extending `Pool` with `getPrice()` and `createSwapTransaction()`
3. Export the new pool class and add its pool addresses to `src/dexs/dexsConfig.ts`
4. Register pool instances in `src/index.ts`

## When Adding a New Strategy

1. Create a file under `src/strategies/<strategy_name>.ts`
2. Extend `Strategy` and implement `evaluate(dataPoint, dataSource): Order[]`
3. Register the strategy in `src/index.ts` with `capybot.addStrategy()`

## When Adding a New Data Source

1. Create a file under `src/data_sources/<source_name>/`
2. Implement the data source class (see `BinanceBTCtoUSDC` as reference)
3. Register with `capybot.addDataSource()` in `src/index.ts`
