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

## Moving to a new contract deployment

The indexer now handles the switch itself: when `EXCHANGE_ADDRESS` changes on the same chain it deletes what it indexed from the old contract (events, orders, trades, markets, disputes; projects, badges, admins and audit logs stay, and projects tied to an old market go back to Approved) and re-indexes from `EXCHANGE_DEPLOY_BLOCK`. A different chain id still needs a fresh database. A new `AvantdexExchange` has a new address and its own empty state. To switch an existing server: (1) deploy with `ADMIN_ADDRESS=<your dashboard admin wallet> ./scripts/deploy-testnet.sh`; (2) set `EXCHANGE_ADDRESS` and `EXCHANGE_DEPLOY_BLOCK` from the output in Coolify; (3) point `DATABASE_URL` at a **new, empty database** (or drop the old one: the indexer refuses a database that indexed a different contract); (4) redeploy and open `/api/health` until it reports `"status":"ok"`. Projects, badges and audit logs live only in PostgreSQL, so a new database starts without them: re-add projects from Admin -> Applications -> Add a project. The latest deployment is recorded in `deployments/arc-testnet.json`, the previous one in `deployments/arc-testnet-previous.json`.

## Circle Wallet credentials (passkey sign-in)

Set `CIRCLE_CLIENT_KEY` (and optionally `CIRCLE_PAYMASTER`) on the API service, register your domain as the Passkey Domain in Circle Console, redeploy, and check `GET /api/config` for `circle_wallet.enabled: true`. Step by step and an acceptance checklist: [CIRCLE-WALLET.md](CIRCLE-WALLET.md). The key is public by design (it is shown to browsers); a `TEST_API_KEY:` key is for Arc Testnet, a `LIVE_API_KEY:` key for mainnet.

## Admin controls (super admin)

Every admin wallet has every control in `/admin`: Applications (approve, reject, **Add a project**, **Edit**, **Delete** a project that has no market on-chain), Verification badges, Approved projects, market drafts, **Hide from site / Show on site** for a market (off-chain visibility only; orders, settlement and refunds are untouched), settlement, disputes, users, admins, audit logs and settings. The only things an admin cannot do are the on-chain ones that need a role on the contract: creating, activating, suspending and settling a market needs `MARKET_MANAGER` on the signing wallet, and changing the fee collector needs `DEFAULT_ADMIN`. Grant the first from **Admin -> Admins -> On-chain access** while connected as the contract admin.

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

Frontend units and the whole UI (no browser needed for the first):

```bash
node scripts/test-circle-provider.mjs        # Circle Wallet provider logic with fake accounts
node scripts/verify-cctp.mjs                 # read-only check of the CCTP contracts on public testnets
docker compose -f docker-compose.dev.yml up -d --build   # chain + db + api + indexer, then seed (scripts/seed_demo_markets.py)
node scripts/ui-feature-test.mjs <DEMO_TOKEN_ADDRESS>    # headless Chrome, see the file header
```

Run containers that talk to each other on one Docker network (`--network ...`) rather than through `host.docker.internal`: on a machine that also runs another local chain on port 8545 the host name can reach the wrong one.

## Operations: attention list, reminders, webhook

* **Admin -> Overview -> Needs attention** lists what a person should do now: a TGE date has passed and settlement is not open (act now), trading ended without settlement, a settlement deadline is within 24 hours, a deadline passed with trades still open, a market ready to complete, a market created on-chain but not activated, a stalled indexer, applications waiting.
* **Before settlement opens** the dashboard reads the token from the chain (code, name, symbol, decimals, total supply), compares decimals with the market form and the address with the project record, blocks the button if the address is not a token or the decimals differ, and asks you to confirm that you checked the address against the project's official channels.
* **Market drafts** can be edited (including the TGE date and a UTC preview of every time) or discarded until the market is created on-chain.
* **Reminders:** every `OPS_INTERVAL_SECONDS` (default 60) the indexer writes notifications to sellers at 24 h and 1 h before a settlement deadline and to both sides once it has passed. They appear in the bell and on the Portfolio notifications tab.
* **Webhook:** set `ADMIN_WEBHOOK_URL` (https) to receive a JSON message `{"text": ...}` once per new high or warn item.
* **Pause** (Admin -> Settings) stops new orders on every market. It needs the `PAUSER` role. Cancel, settle, default claims and refunds keep working.

## Keeper (optional)

A small worker (`keeper` service in the compose files) that does the on-chain chores nobody needs to be trusted for: `expireOrders` (refunds go to the order owners) and `refundTrade` for cancelled or abandoned markets (each side gets its own funds back). It idles and costs nothing unless enabled.

1. Create a **new wallet** just for this and send it a little USDC for gas (Arc's gas token; a few cents per call). It needs no role. Never use an admin, deployer or personal key.
2. Set `KEEPER_ENABLED=true` and `KEEPER_PRIVATE_KEY=0x...` on the keeper service. Start with `KEEPER_DRY_RUN=true` to see in the logs what it would send, then set it to `false`.
3. Watch **Admin -> Settings -> Keeper** (wallet, gas balance, last pass, recent actions). The overview warns when the keeper is low on gas, failing or silent for 10 minutes. Every action is in the audit log with role `keeper`.

What it will never do: cancel or suspend a market, open or extend settlement, pause, or touch roles and fees. `KEEPER_COMPLETE_MARKETS=true` additionally calls `completeMarket` once every trade is closed; that needs `MARKET_MANAGER` on the keeper wallet, so leave it off unless you accept a hot key with that role. Due work is judged by the chain's clock, each pass is limited to `KEEPER_MAX_TX_PER_RUN` transactions, and a transaction that would revert is skipped before it costs gas.

## Visitor addresses and rate limits

`nginx.conf` trusts only private network hops in `X-Forwarded-For` (`set_real_ip_from`, `real_ip_recursive on`) and passes one address to the API, so a visitor cannot pick their own address by sending the header (this was audit finding M-1). If your proxy is not on a private network range, add its range to `set_real_ip_from`.

## Operations notes

* **Pause** blocks only new orders. Cancel, settle, default claims and refunds always work.
* If a market's TGE is cancelled: **Cancel market** → every trade becomes refundable with no fee (anyone can trigger `refundTrade`).
* If a market is never settled, anyone can refund trades 90 days after trading ended.
* Rebuild the database from the chain at any time: drop the PostgreSQL volume and restart; the indexer replays every event from `EXCHANGE_DEPLOY_BLOCK`. (Project records, badges and audit logs are off-chain and live only in PostgreSQL, so back it up.)
* Back up the `pgdata` volume regularly.

## Deploy fails with "dependency failed to start: container api ... is unhealthy"

The compose health check calls `GET /api/livez`, which answers as soon as the API process is up and does not touch the database, so a slow or unreachable database no longer blocks the stack; `GET /api/health` still reports the database and migration state (`status: degraded` with the reason). Database connections time out after 5 seconds. The `keeper` service is a compose profile and is not started unless `COMPOSE_PROFILES=keeper` is set (it saves memory on small servers, where three Python processes plus the old stack during a rolling deploy can be killed for lack of memory). If the API container still does not become healthy, read **its own log** in Coolify (the first lines show `[start] database: ...`); a crash there names the cause (for example `JWT_SECRET must be set ... at least 32 characters`).

Cause found on the first real deploy: Coolify passed some variables (`OPS_INTERVAL_SECONDS`, `KEEPER_MAX_GAS_GWEI`, `KEEPER_COMPLETE_MARKETS`) to the API as empty strings, and the settings parser rejected an empty number or boolean, so the API crashed on start. Settings now treat a blank variable as unset (`env_ignore_empty`); test `test_blank_environment_variables_use_the_defaults`.
