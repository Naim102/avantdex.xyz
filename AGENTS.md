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
- Chain: Arc Testnet 5042002, RPC `https://rpc.testnet.arc.io`. USDC ERC-20 `0x3600000000000000000000000000000000000000`, 6 decimals. Arc mainnet (5042) exists but is deliberately not configured here. The site says it runs on Arc Testnet (banner, header tag, hero chip, footer), driven by the API's chain id.

## Deployed (Arc Testnet, chain 5042002)

- AvantdexExchange **v2**: `0xb48935EeA3B7264a53098B1DB920C3fCa09C0283` (deploy block 71711143, tx in `deployments/arc-testnet.json`). Runtime bytecode (16,175 bytes) matches the local build (only the USDC immutable differs); fee constants 50/50 bps, collector `0x136a…Ebd6`. v2 changes are in `docs/CONTRACT-V2.md` (decimals check, cancel closes after one hour of settlement, `claimDefault`/`settleTrade` open to any caller, one market per `metadataRef`). Earlier deployments: v1 `0xB927…E9cb` (`deployments/arc-testnet-previous.json`) and v0 `0x125c…e31d` (`deployments/arc-testnet-v0.json`), both unused. The indexer resets itself when `EXCHANGE_ADDRESS` changes on the same chain.
- Owner / `DEFAULT_ADMIN` / `MARKET_MANAGER` / `PAUSER`: the project admin wallet `0x378862A20B312298dc54585CbabC531D70F9baE9` (also `BOOTSTRAP_ADMIN_ADDRESSES`). The testnet deployer wallet `0xd6ac46673C844b4B46D5b66AC9223765bD6D65dC` (testnet-only key in the git-ignored `.env`) holds no role on this deployment; the admin wallet can grant roles from Admin -> Admins -> On-chain access. The indexer wipes the old contract's indexed data by itself when the contract address changes (projects, admins and audit logs are kept).
- Demo ERC-20 for settlement practice: `0x9B4aDa076774DE9575797cae424e0192a1cB6E34` (open mint, worthless).
- Mainnet is NOT deployed. For mainnet the owner deploys with their own wallet and changes `CHAIN_ID`, `RPC_URL`, `EXPLORER_URL`, `USDC_ADDRESS`, `EXCHANGE_ADDRESS`, `EXCHANGE_DEPLOY_BLOCK` and the wagmi chain in `src/config.ts` (and must get an audit first).

## Admin model

One admin level, and it is the super admin: any wallet with an admin row (`BOOTSTRAP_ADMIN_ADDRESSES` / `ADMIN_ROLES` / dashboard) can do everything in `/admin`: review and approve projects, add, edit and delete projects (`POST/PUT/DELETE /api/admin/projects`), hide or show a market (`POST /api/admin/markets/{id}/delist`, off-chain only), manage admins, disputes, listing requests, settings. Old split role names are accepted and treated as admin. Approved projects show publicly as "Coming soon" (`GET /api/projects/upcoming`); trading starts only after the on-chain market is created and activated by a wallet holding the on-chain `MARKET_MANAGER` role. Official X account: https://x.com/AvantDex.

## Design

Themes live in `src/index.css` (`data-theme` on `<html>`: sky, the default, and ink) and `src/hooks/useTheme.tsx`. Use the CSS variables (`--ink`, `--surface`, `--accent`, `--accent-ink`, `--line`, `--r-*`), never hard-coded colors, so every theme keeps working. No em dash characters in UI text. Phones get a bottom navigation bar and a small header (`src/components/BottomNav.tsx`, `Header.tsx`); a project's TGE date may be `TBD` (`projects.tge_tbd`). Market numbers come from the API (`/api/stats`, per-market `stats`); never invent them. `scripts/seed_demo_markets.py` creates real, clearly labelled demo markets on testnet only.

## Rules that must not break

- No role can withdraw or redirect escrowed funds. Users always keep cancel / settle / default claim / refund paths. Pause blocks only new orders.
- USDC on Arc reverts for blocklisted accounts: every payout is push-with-fallback to `claimable`.
- The chain is canonical. The indexer copies events and re-reads touched state from the contract; the DB must be rebuildable by replay.
- **Arc only listing policy:** only tokens deployed on Arc can be listed (`arc_chain` in `backend/app/utils.py`); settlement happens on Arc.
- Create Listing (project listing/request) is **not** Create Order. Approval, verification and market activation are three separate steps.
- Never present an off-chain order as guaranteed; never invent market data; never claim the contract is audited.
- `maxFeePerGas` must be at least 20 gwei on Arc. Never assume strictly increasing `block.timestamp`.
- Secrets (private keys, JWT secret, DB password) never go in the repo; `.env` is git-ignored.

## Key files

- `contracts/AvantdexExchange.sol`; legacy v1 `contracts/AllocX*.sol` and `contracts/legacy/` (not used by Avantdex).
- `backend/app/routers/` (public, auth, user, admin), `backend/app/indexer/worker.py`, `backend/app/models.py`, `backend/alembic/`.
- `src/pages/` (Home, Explore, MarketDetail, Portfolio, Listing, Bridge, RoadmapPage, admin/*), `src/components/TradePanel.tsx`, `src/lib/exchange.ts` (units and contract errors).
- Bridge (`/bridge`, Circle CCTP V2, testnet only, lazy chunk): `src/pages/Bridge.tsx`, `src/lib/cctp.ts`, `src/lib/bridgeRoutes.ts`, `src/lib/directBridge.ts` (Standard transfer the user finishes with `receiveMessage`), Circle's Bridge Kit for the Forwarding Service mode; `CCTP_API_URL` (Iris) comes from `/api/config`; [docs/CCTP.md](docs/CCTP.md). Roadmap copy and dates live only in `src/lib/roadmap.ts` ([docs/ROADMAP.md](docs/ROADMAP.md)). Every Connect Wallet button opens a dialog with Circle Wallet passkey sign-in first (`src/components/ConnectButton.tsx`, `src/lib/circleWallet.ts`, `backend/app/smart_sig.py`; turned on by `CIRCLE_CLIENT_KEY` on the API; [docs/CIRCLE-WALLET.md](docs/CIRCLE-WALLET.md)). The wallet is a smart account, so sign-in verifies ERC-1271 / ERC-6492 signatures as well as ECDSA.
- `docs/README.md` indexes all documentation (admin dashboard, Phase 1 operations, keeper, contract v2, indexer, design).
- `docker-compose.yml` (production / Coolify), `docker-compose.dev.yml` (local), `scripts/deploy-testnet.sh`, `docs/RUNBOOK.md`.

## Commands

```bash
bun install && bun run dev                    # frontend (needs the dev stack for data)
docker compose -f docker-compose.dev.yml up --build   # local chain + DB + API + indexer
bun run check                                 # lint + typecheck
bun run build:static                          # rebuild deploy/dist (commit it; the server does not build)
```
Tests: `forge test` (Docker image `ghcr.io/foundry-rs/foundry:v1.7.1`), backend `pytest` (see docs/RUNBOOK.md).
