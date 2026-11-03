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

After changing frontend code: `bun run build:static`, commit `deploy/dist`, redeploy.

## 4. First market (all from the admin dashboard, `/admin`)

1. A project owner opens **Create Listing → Submit Your Project**, fills the form and submits (they sign in with their wallet; the team wallet must be the signing wallet).
2. Admin: **Applications** → *Under Review* → *Verification*; **Verification** → grant badges with evidence → *Approved*.
3. **Approved Projects** → *Configure market* (lot size, tick size, limits, trading window).
4. **Market Management** → *Manage* → **Create on-chain** (your manager wallet signs) → **Verify configuration** → **Activate**.
5. Traders use **Buy / Sell** on the market page. Approve USDC, place orders, see the order book and portfolio update.
6. After the token exists: **Settlement Management** → *Open settlement* (token address + window). Sellers approve the token and press **Settle** in their portfolio. If a seller does not deliver before the deadline the buyer presses **Claim default**.
7. When all trades are closed: **Complete market**.

To practise settlement, use the `--demo-token` address as the project token: mint it to the seller wallet and approve it (the demo token has an open `mint`).

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
