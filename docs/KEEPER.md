# Keeper (Phase 2)

A small worker that performs the on-chain chores nobody needs to be trusted for. Code: `backend/app/keeper.py` (logic), `backend/app/keeper_run.py` (entry point), `keeper` service in `docker-compose.yml` and `docker-compose.external-db.yml`. Tests: `backend/tests/test_chain.py` (4 keeper tests). It is **off by default**: the container idles until `KEEPER_ENABLED=true`.

## What it does

| Duty | Contract call | Why it is safe |
|---|---|---|
| Expire old orders | `expireOrders(ids)` (up to 50 per call) | anyone may call it; every refund goes to the order's owner |
| Refund trades of a cancelled market, or of an abandoned market (90 days after trading ended and settlement never opened) | `refundTrade(id)` | anyone may call it; each side gets its own funds back, no fee |
| Complete a settled market (**optional**, `KEEPER_COMPLETE_MARKETS=true`) | `completeMarket(id)` | the contract refuses unless every trade is closed; needs `MARKET_MANAGER` on the keeper wallet |

With contract v2 the same worker can also trigger defaults and deliveries for sellers who approved their token (`claimDefault`, `settleTrade`, both open to any caller). That duty is **not** enabled in this release; the safe set above comes first.

It never calls `cancelMarket`, `suspendMarket`, `openSettlement`, `extendSettlement`, `pause`, `setFeeCollector` or any role function. Even with a compromised keeper key, the worst an attacker can do is spend the small gas balance, or (only if `KEEPER_COMPLETE_MARKETS` is on) complete markets that are already fully settled.

## Safeguards

* **Chain clock**: what is "due" is judged with the latest block's timestamp, not the server clock.
* **Simulate first**: every transaction is simulated with `eth_call`; a revert means the work is already done and nothing is sent, so nothing is paid.
* **Gas**: `maxFeePerGas` is at least 20 gwei (Arc requirement), configurable up with `KEEPER_MAX_GAS_GWEI` (default 25); gas limit is the estimate plus 25 %.
* **Caps**: at most `KEEPER_MAX_TX_PER_RUN` (10) transactions per pass; passes run every `KEEPER_INTERVAL_SECONDS` (30).
* **Low balance**: below `KEEPER_MIN_BALANCE` USDC (0.5) it stops sending and reports the problem (Arc's gas token is USDC).
* **Isolation**: one failing duty does not stop the others; errors are logged and surfaced.
* **Dry run**: `KEEPER_DRY_RUN=true` logs what would be sent and sends nothing.
* **Audit trail**: every transaction is written to `audit_logs` with role `keeper`, action `keeper.expire_orders`, `keeper.refund_trade` or `keeper.complete_market`, and the transaction hash.

## Turning it on

0. The keeper container is **not started by default** (a compose profile, to save memory on small servers). Set `COMPOSE_PROFILES=keeper` in the environment (Coolify: add it as a variable) and redeploy to start it.
1. Create a **new wallet** only for this. Never use an admin, deployer or personal key. Send it a little USDC for gas (a few cents per call).
2. Set on the `keeper` service: `KEEPER_ENABLED=true`, `KEEPER_PRIVATE_KEY=0x...`. Start with `KEEPER_DRY_RUN=true` for a day and read the logs.
3. Set `KEEPER_DRY_RUN=false`.
4. Optional: grant the wallet `MARKET_MANAGER` (Admin -> Admins -> Allow markets, or `grantRole`) and set `KEEPER_COMPLETE_MARKETS=true`. Leave it off unless you accept a hot key with that role.

Never put the key anywhere but the environment of the keeper service. The API container does not receive it.

## Monitoring

* **Admin -> Settings -> Keeper** (`GET /api/admin/keeper`): wallet, gas balance, last pass, mode, totals since start and the last 10 actions. Read-only. The key is never exposed.
* **Overview -> Needs attention** warns when the keeper reports an error (for example low gas) or has not run for 10 minutes. If a webhook is configured the warning is sent there too.
* Logs: JSON lines from the `keeper` container.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `KEEPER_ENABLED` | `false` | master switch; when false the container idles |
| `KEEPER_PRIVATE_KEY` | empty | the keeper wallet's key |
| `KEEPER_DRY_RUN` | `false` | log only |
| `KEEPER_COMPLETE_MARKETS` | `false` | also complete fully settled markets (needs the role) |
| `KEEPER_MAX_GAS_GWEI` | 25 | max fee per gas (minimum 20 is enforced) |
| `KEEPER_MAX_TX_PER_RUN` | 10 | transactions per pass |
| `KEEPER_INTERVAL_SECONDS` | 30 | seconds between passes |
| `KEEPER_MIN_BALANCE` | 0.5 | USDC below which it pauses |

## Tests

`test_keeper_expires_orders_and_refunds_a_cancelled_market` (nothing due is a no-op; expired orders are cleaned; a live market's open trades are never touched; after `cancelMarket` the keeper refunds the trade and the buyer gets everything back; both actions are audit-logged), `test_keeper_dry_run_sends_nothing`, `test_keeper_completes_markets_only_when_enabled_and_allowed` (off by default; on without the role reports and sends nothing; with the role it completes), `test_keeper_status_and_low_balance_warning` (status API, no key in the output, attention item).
