# Avantdex

Follow us on X: [@AvantDex](https://x.com/AvantDex)

Pre-market trading on **Arc Network**. Users trade tokens that have not launched yet through an on-chain order book, settled in USDC with escrow. After the token launch the seller delivers the token **atomically** (token and payment move in one transaction); if they do not, the buyer receives their payment plus the seller's collateral.

> **Status: Arc Testnet only. Unaudited.** Do not use with real value. See [docs/RUNBOOK.md](docs/RUNBOOK.md) to deploy and [PRD.md](PRD.md) / [R&D.md](R&D.md) for the full product and research documents.

## Platform fees

Paid in USDC to the fee collector `0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6`.

| Action | Fee |
|---|---|
| Buyer (successful trade) | 0.5% |
| Seller (successful trade) | 0.5% |
| Unfilled order cancellation | 0% |
| Project listing | 0% |
| Community listing request | 0% |
| Failed transaction | 0% platform fee |

"Successful trade" means a trade that reaches *Settled*. Defaults, cancelled markets, refunds and order cancellations never pay a platform fee.

## How it fits together

```
Browser (React) ──/api──▶ nginx ──▶ FastAPI ──▶ PostgreSQL ◀── Indexer (web3.py) ◀── Arc RPC ◀── AvantdexExchange
      │                                                                                  ▲
      └────────────── wallet signs transactions ─────────────────────────────────────────┘
```

| Part | Folder | What it does |
|---|---|---|
| Smart contract | `contracts/AvantdexExchange.sol` | Orders, matching, escrow, settlement, fees, market status. **All money rules live here.** |
| Backend | `backend/` | FastAPI + PostgreSQL: projects, verification badges, admin dashboard API, audit logs, order book/portfolio API |
| Indexer | `backend/app/indexer/` | Copies contract events into PostgreSQL (the chain stays the source of truth; the DB can be rebuilt by replaying) |
| Frontend | `src/` | Home, Explore, Market (order book + trade panel), Portfolio, Create Listing, Admin dashboard |
| Legacy | `contracts/AllocX*.sol`, `contracts/legacy/` | The earlier AllocX v1 marketplace (still deployed, not used by Avantdex) |

Admins can **never** move escrowed funds: there is no such function. Users keep every exit (cancel order, settle, claim default, refund) even if the market is suspended or the contract is paused.

## Run everything locally (no real network, no real money)

Needs Docker and Bun.

```bash
docker compose -f docker-compose.dev.yml up --build   # PostgreSQL + local chain + contracts + API + indexer
```

```bash
bun install
echo "VITE_RPC_URL=http://localhost:8545" > .env.local   # point the wallet reads at the local chain
bun run dev                                             # frontend on http://localhost:5173
```

Use a browser wallet pointed at `http://localhost:8545` (chain id 5042002) and import one of anvil's public dev accounts (account 0 is the admin: `0xf39F…2266`). Contract roles and the dashboard `super_admin` belong to account 0.

## Interface

Two themes, Sky (light, the default) and Ink (dark), picked from the Theme menu in the footer and remembered per browser. All use the brand green `#28DF99` and black `#262627`; Archivo for text, IBM Plex Mono for every figure. The home page shows a live platform ledger and a market board (last price, best bid/ask, 24h volume, open interest, buy-side vs sell-side liquidity); a market page adds a depth chart. `scripts/seed_demo_markets.py` fills a testnet deployment with labelled demo markets.

## Home page and motion

The home page has a 3D hero (the brand pyramid, built with three.js; it turns and pulls apart as you scroll), a liquidity landscape (one pair of towers per market, buy side green and sell side red, drawn from live order data), a scroll-driven "life of a trade" walkthrough, a latest-trades feed and a product FAQ. three.js loads in its own chunk and renders on demand. Everything respects `prefers-reduced-motion` and has a text alternative.

## Product tour

`docs/Avantdex-product-tour.pptx` is a slide deck of every page, built from the screenshots in `docs/screenshots/` (captured from the local dev stack with demo data). `python scripts/build_deck.py` rebuilds the deck.

## Tests

```bash
docker run --rm -v "$PWD:/app" -w /app --entrypoint forge ghcr.io/foundry-rs/foundry:v1.7.1 test   # contracts
bun run check                                                                                       # lint + typecheck
```

Backend tests (PostgreSQL + a local chain), see [docs/RUNBOOK.md](docs/RUNBOOK.md#tests).

## Deployed on Arc Testnet

AvantdexExchange v2 `0xb48935EeA3B7264a53098B1DB920C3fCa09C0283` ([explorer](https://explorer.testnet.arc.io/address/0xb48935EeA3B7264a53098B1DB920C3fCa09C0283)), details in [docs/CONTRACT-V2.md](docs/CONTRACT-V2.md). Earlier deployments (`deployments/arc-testnet-previous.json`, `arc-testnet-v0.json`) are unused; the full lifecycle on real Arc USDC was run on the earlier one with `scripts/testnet_e2e.py`. All documentation is indexed in [docs/README.md](docs/README.md).

## Deployed on Arc Testnet

AvantdexExchange `0xb48935EeA3B7264a53098B1DB920C3fCa09C0283` ([explorer](https://explorer.testnet.arc.io/address/0xb48935EeA3B7264a53098B1DB920C3fCa09C0283)). The same lifecycle (project, market, trade, atomic settlement, fees to the collector, completion) was run on the previous deployment (`deployments/arc-testnet-previous.json`) with real Arc USDC; see `scripts/testnet_e2e.py`. The current deployment's runtime code matches the local build (only the USDC immutable differs).

## Deploy

1. Deploy the contract to Arc Testnet from **your** wallet: `./scripts/deploy-testnet.sh` ([runbook](docs/RUNBOOK.md)).
2. Put the printed `EXCHANGE_ADDRESS` / `EXCHANGE_DEPLOY_BLOCK` in your environment ([.env.example](.env.example)).
3. Deploy `docker-compose.yml` on Coolify. The web container serves the prebuilt frontend in `deploy/dist` (nothing is compiled on the server). After changing frontend code run `bun run build:static` and commit `deploy/dist`.

## Notes

* USDC on Arc has **6 decimals** through its ERC-20 interface (the native gas token view uses 18). Testnet chain id **5042002**, RPC `https://rpc.testnet.arc.io`, faucet `https://faucet.circle.com`.
* Legal pages are placeholders marked "Draft — not legal advice". No restricted-jurisdiction list, legal entity or compliance status is claimed.
* Onchain ownership of tokens or rights is not legal ownership of a company, brand or intellectual property.
