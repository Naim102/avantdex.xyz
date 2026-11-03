# Avantdex

> Pre-market trading marketplace on Arc Network (Arc Testnet, unaudited). Built on the earlier AllocX repository.

Project memory. Read [README.md](README.md), [PRD.md](PRD.md) and [R&D.md](R&D.md) for the full picture; this file is the short version for agents.

## What it is

Order-book pre-TGE trading. Resting orders are on-chain (funds locked at placement). A taker supplies maker order ids; fills execute at the maker's price with partial fills. Each trade escrows buyer payment + 0.5% fee reserve and seller collateral (= trade value). After TGE a market manager opens settlement with the token address; the seller settles atomically (token for payment, balance-delta verified) or the buyer claims payment + collateral after the deadline.

## Platform fees (confirmed)

Buyer 0.5% and seller 0.5% on **settled** trades only; 0% for order cancellation, project listing, community listing requests and failed transactions/defaults/refunds. All fees go in USDC to `0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6` (constants in the contract; only the collector address can be changed, by `DEFAULT_ADMIN_ROLE`).

## Stack

- Contracts: Solidity 0.8.28, OpenZeppelin 5, Foundry (`contracts/AvantdexExchange.sol`, tests in `contracts/test/Avantdex.t.sol`).
- Backend: Python 3.12, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16, web3.py indexer (`backend/`).
- Frontend: React 18, Vite, TypeScript, Tailwind, wagmi v2, viem, ConnectKit (`src/`). Runtime config comes from `/api/config` (no rebuild needed to change addresses).
- Chain: Arc Testnet 5042002, RPC `https://rpc.testnet.arc.io`. USDC ERC-20 `0x3600000000000000000000000000000000000000`, 6 decimals. Mainnet (5042) is deliberately not configured.

## Deployed (Arc Testnet, chain 5042002)

- AvantdexExchange: `0x125ca669F4d42Dc09A0C435B721bD8089602e31d` (deploy block 70515453, tx in `deployments/arc-testnet.json`). Runtime bytecode (15,505 bytes) matches the local build; fee constants 50/50 bps, collector `0x136a…Ebd6`.
- Owner / `DEFAULT_ADMIN` / `MARKET_MANAGER` / `PAUSER`: testnet deployer wallet `0xd6ac46673C844b4B46D5b66AC9223765bD6D65dC` (testnet-only key is in the git-ignored `.env`).
- Demo ERC-20 for settlement practice: `0x9B4aDa076774DE9575797cae424e0192a1cB6E34` (open mint, worthless).
- Mainnet is NOT deployed. For mainnet the owner deploys with their own wallet and changes `CHAIN_ID`, `RPC_URL`, `EXPLORER_URL`, `USDC_ADDRESS`, `EXCHANGE_ADDRESS`, `EXCHANGE_DEPLOY_BLOCK` and the wagmi chain in `src/config.ts` (and must get an audit first).

## Rules that must not break

- No role can withdraw or redirect escrowed funds. Users always keep cancel / settle / default claim / refund paths. Pause blocks only new orders.
- USDC on Arc reverts for blocklisted accounts: every payout is push-with-fallback to `claimable`.
- The chain is canonical. The indexer copies events and re-reads touched state from the contract; the DB must be rebuildable by replay.
- Create Listing (project listing/request) is **not** Create Order. Approval, verification and market activation are three separate steps.
- Never present an off-chain order as guaranteed; never invent market data; never claim the contract is audited.
- `maxFeePerGas` must be at least 20 gwei on Arc. Never assume strictly increasing `block.timestamp`.
- Secrets (private keys, JWT secret, DB password) never go in the repo; `.env` is git-ignored.

## Key files

- `contracts/AvantdexExchange.sol`; legacy v1 `contracts/AllocX*.sol` and `contracts/legacy/` (not used by Avantdex).
- `backend/app/routers/` (public, auth, user, admin), `backend/app/indexer/worker.py`, `backend/app/models.py`, `backend/alembic/`.
- `src/pages/` (Home, Explore, MarketDetail, Portfolio, Listing, admin/*), `src/components/TradePanel.tsx`, `src/lib/exchange.ts` (units and contract errors).
- `docker-compose.yml` (production / Coolify), `docker-compose.dev.yml` (local), `scripts/deploy-testnet.sh`, `docs/RUNBOOK.md`.

## Commands

```bash
bun install && bun run dev                    # frontend (needs the dev stack for data)
docker compose -f docker-compose.dev.yml up --build   # local chain + DB + API + indexer
bun run check                                 # lint + typecheck
bun run build:static                          # rebuild deploy/dist (commit it; the server does not build)
```
Tests: `forge test` (Docker image `ghcr.io/foundry-rs/foundry:v1.7.1`), backend `pytest` (see docs/RUNBOOK.md).
