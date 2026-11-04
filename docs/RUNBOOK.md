# Avantdex runbook (Arc Testnet)

Everything here is for **Arc Testnet**. Never put a wallet that holds real value into these steps.

## 1. Get a testnet wallet with gas

1. Create a fresh wallet (for example in MetaMask) used only for this project and copy its private key somewhere safe on your own machine.
2. Add Arc Testnet: chain id `5042002`, RPC `https://rpc.testnet.arc.io`, symbol `USDC`, explorer `https://explorer.testnet.arc.io`.
3. Get test USDC (gas **and** trading funds) from https://faucet.circle.com. On Arc, USDC is the gas token.

## 2. Deploy the contract (from your own wallet)

```bash
export DEPLOYER_PRIVATE_KEY=0x...          # your testnet-only key; never commit it, never paste it into chat
./scripts/deploy-testnet.sh --demo-token   # --demo-token also deploys a practice ERC-20 for a settlement test
```

What the script does: checks the chain id is **5042002** (it refuses mainnet), checks you have gas and that USDC has 6 decimals, deploys `AvantdexExchange` with `ADMIN_ADDRESS` (default: your wallet) as owner and the fee collector `0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6`, and writes `deployments/arc-testnet.json`. It prints `EXCHANGE_ADDRESS`, `EXCHANGE_DEPLOY_BLOCK` and `BOOTSTRAP_ADMIN_ADDRESSES`.

Your wallet now holds the on-chain roles `DEFAULT_ADMIN`, `MARKET_MANAGER` and `PAUSER`. Use a multisig for anything beyond testing.

## 3. Configure and deploy on Coolify

Set these environment variables on the Coolify resource (see `.env.example`):

| Variable | Value |
|---|---|
| `EXCHANGE_ADDRESS`, `EXCHANGE_DEPLOY_BLOCK` | from step 2 |
| `BOOTSTRAP_ADMIN_ADDRESSES` | your wallet address (becomes `super_admin` of the dashboard) |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `AUTH_DOMAIN`, `AUTH_URI` | your domain, for example `avantdex.example.com` / `https://avantdex.example.com` |

Create a **Docker Compose** resource from this repo (branch `main`, file `docker-compose.yml`), add your domain to the `web` service (port 80). Coolify's proxy provides HTTPS. Nothing is built on the server except two small Python images; the frontend is the prebuilt `deploy/dist`.

**Existing PostgreSQL (for example a Coolify database resource):** use `docker-compose.external-db.yml` as the compose file (its api and indexer join Coolify's shared `coolify` network, so the database's internal host name resolves; set `COOLIFY_NETWORK` if your server names it differently), and set `DATABASE_URL=postgresql+psycopg://user:password@host:5432/dbname`. Tables are created automatically by Alembic when the API starts.

**Admin accounts from the environment:** `BOOTSTRAP_ADMIN_ADDRESSES` and `ADMIN_ROLES` (`wallet:super_admin,wallet:super_admin`). There is **one admin level**: every admin can review, approve, list and manage markets (older split role names in `ADMIN_ROLES` are treated as admin). Change the variable and redeploy; admins added from the environment are removed again if you delete them from it, admins added inside the dashboard are never touched, and the last admin is always kept. Dashboard admin is off-chain; creating/activating/suspending/settling a market is an on-chain transaction that needs the `MARKET_MANAGER` contract role on the signing wallet. The contract's `DEFAULT_ADMIN` wallet can grant it from **Admin -> Admins -> On-chain access**.

**Fee collector:** set `FEE_COLLECTOR` before running the deploy script; afterwards change it from Admin -> Settings (on-chain transaction by the contract's admin wallet).

After changing frontend code: `bun run build:static`, commit `deploy/dist`, redeploy.

## 4. First market (all from the admin dashboard, `/admin`)

1. A project owner opens **Create Listing → Submit Your Project**, fills the form and submits (they sign in with their wallet; the team wallet must be the signing wallet).
2. Admin: **Applications** → open the project → **Approved** (one click; *Under Review* / *Verification* and badges are optional). Approved projects appear on Home and Explore as **Coming soon** (not tradable).
3. **Approved Projects** → *Configure market* (lot size, tick size, limits, trading window).
4. **Market Management** → *Manage* → **Create on-chain** (your manager wallet signs) → **Verify configuration** → **Activate**.
5. Traders use **Buy / Sell** on the market page. Approve USDC, place orders, see the order book and portfolio update.
6. After the token exists: **Settlement Management** → *Open settlement* (token address + window). Sellers approve the token and press **Settle** in their portfolio. If a seller does not deliver before the deadline the buyer presses **Claim default**.
7. When all trades are closed: **Complete market**.

To practise settlement, use the `--demo-token` address as the project token: mint it to the seller wallet and approve it (the demo token has an open `mint`).

## Demo markets (so the board, bids, asks, volume and depth chart have something to show)

`scripts/seed_demo_markets.py` creates up to four clearly labelled "Demo ..." projects through the real API, creates and activates their markets on-chain and places real orders and one small trade in each (the "tokens" are the worthless open-mint demo ERC-20; the exchange only supports ERC-20, there is no NFT market). It needs an **admin wallet of the dashboard that also holds the on-chain `MARKET_MANAGER` role**, and a second wallet for the buy side. Each market costs about 5 USDC of testnet USDC, locked in resting orders you can cancel back.

```bash
docker run --rm --env-file .env -e API_URL=https://your-domain -e ADMIN_PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY -e DEMO_TOKEN_ADDRESS=$DEMO_TOKEN_ADDRESS -v "$PWD:/repo" -w /repo avantdex-backend-dev python scripts/seed_demo_markets.py
```

Run it only against a testnet deployment. Re-running skips projects that already exist.

## Testnet end-to-end check (real chain, real USDC)

With the stack running against Arc Testnet (API on `http://localhost:8000`) and `.env` holding `DEPLOYER_PRIVATE_KEY`, `TRADER_PRIVATE_KEY`, `EXCHANGE_ADDRESS`, `DEMO_TOKEN_ADDRESS`:

```bash
docker run --rm --env-file .env -e API_URL=http://host.docker.internal:8000 -v "$PWD:/repo" -w /repo avantdex-backend-dev python scripts/testnet_e2e.py
```

It runs the whole lifecycle (project, market, trade, settlement, fees) and prints an explorer link for every transaction. It costs a few cents of testnet USDC.

## Moving to Arc Mainnet (owner only, after an audit)

Mainnet moves real money. Do not do it before an independent audit and legal review. When you are ready:

1. Confirm every address and endpoint in the official docs (https://docs.arc.io/arc/references/connect-to-arc and `.../contract-addresses`): chain id `5042`, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`, USDC address.
2. Deploy the exchange with **your own wallet** and a multisig as `ADMIN_ADDRESS` (the deploy script is testnet-only on purpose: copy `scripts/deploy-testnet-inner.sh`, change the expected chain id and RPC, and review it).
3. Change these settings (Coolify env or `.env`): `CHAIN_ID=5042`, `RPC_URL`, `EXPLORER_URL`, `USDC_ADDRESS`, `EXCHANGE_ADDRESS`, `EXCHANGE_DEPLOY_BLOCK`, `FEE_COLLECTOR`. Use a **new database** (the indexer refuses a database that belongs to another chain/contract).
4. In `src/config.ts` and `src/hooks/useApp.tsx` replace `arcTestnet` with Arc mainnet (`arc` in viem when available, or a custom chain with id 5042), then `bun run build:static` and commit `deploy/dist`.
5. Keep testnet and mainnet configurations in separate environments and never reuse a testnet key on mainnet.

## Tests

Contracts:

```bash
docker run --rm -v "$PWD:/app" -w /app --entrypoint forge ghcr.io/foundry-rs/foundry:v1.7.1 test
```

Backend (needs PostgreSQL and a local chain; compiled contracts in `contracts/out`):

```bash
docker run -d --name pg -e POSTGRES_USER=avantdex -e POSTGRES_PASSWORD=avantdex -e POSTGRES_DB=avantdex -p 55432:5432 postgres:16-alpine
docker run -d --name anvil -p 8546:8545 --entrypoint anvil ghcr.io/foundry-rs/foundry:v1.7.1 --host 0.0.0.0 --chain-id 5042002 --block-time 1
cd backend && docker build -f Dockerfile.dev -t avantdex-backend-dev .
docker run --rm -v "$PWD:/app" -v "$PWD/../contracts/out:/out:ro" -w /app \
  -e DATABASE_URL=postgresql+psycopg://avantdex:avantdex@host.docker.internal:55432/avantdex \
  -e CHAIN_RPC=http://host.docker.internal:8546 -e CONTRACT_OUT_DIR=/out \
  avantdex-backend-dev python -m pytest tests -q
```

## Operations notes

* **Pause** blocks only new orders. Cancel, settle, default claims and refunds always work.
* If a market's TGE is cancelled: **Cancel market** → every trade becomes refundable with no fee (anyone can trigger `refundTrade`).
* If a market is never settled, anyone can refund trades 90 days after trading ended.
* Rebuild the database from the chain at any time: drop the PostgreSQL volume and restart; the indexer replays every event from `EXCHANGE_DEPLOY_BLOCK`. (Project records, badges and audit logs are off-chain and live only in PostgreSQL, so back it up.)
* Back up the `pgdata` volume regularly.
