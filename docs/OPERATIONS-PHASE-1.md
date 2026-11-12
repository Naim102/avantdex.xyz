# Admin operations (Phase 1)

What shipped: token pre-flight, the market draft form (TGE date, UTC preview, edit, discard), the Needs attention list, deadline reminders, the admin webhook and the pause control. All of it is dashboard and backend only. Code: `backend/app/ops.py`, `backend/app/routers/admin.py`, `src/pages/admin/MarketForm.tsx`, `src/pages/admin/Markets.tsx`, `src/pages/admin/Misc.tsx`. Tests: `backend/tests/test_ops.py`, `test_chain.py` (token check), the UI feature test.

## 1. Token pre-flight

`GET /api/admin/token-check?address=0x..&decimals=18&market_id=3` (any admin). It only reads the chain.

| Check | Blocks the action? |
|---|---|
| The address is a valid, non-zero address | yes |
| There is contract code at the address on this network | yes |
| `decimals()` and `totalSupply()` answer (looks like an ERC-20) | yes |
| On-chain decimals equal the market form (or the market's stored) decimals | yes |
| Total supply is not zero | warning |
| Same address as the project's confirmed token | warning |
| On-chain symbol matches the project's symbol | warning |

Where it is used: the market form (when a token address is known) and **Open settlement** in Market Management. The settlement button stays disabled until the check passes **and** the admin ticks "I checked this address against the project's official channels". Changing the address clears the tick. The contract v2 repeats the decimals check on-chain ([CONTRACT-V2.md](CONTRACT-V2.md)).

## 2. Market draft form

* Fields: token decimals, lot size, tick size, min and max order, trading start and end, **TGE date (optional)**.
* Every date shows its **UTC** equivalent underneath; two admins in different time zones see the same instant.
* "Set trading end to the TGE date" and a warning when trading ends before the TGE date.
* **Edit draft** (`PUT /api/admin/markets/{id}`) and **Discard draft** (`DELETE /api/admin/markets/{id}`) while the market has not been created on-chain. After that the contract parameters are immutable and both endpoints return 409. Discarding returns the project from Market Setup to Approved. Both are audit-logged (`market.draft_edit`, `market.draft_discard`).
* "Create on-chain" cannot be sent twice by accident: after a confirmed transaction the button is replaced by a waiting notice for 15 minutes (stored per draft in the browser). With contract v2 a second send would revert anyway.

## 3. Needs attention

`GET /api/admin/attention`, shown on **Admin -> Overview** (refreshes every 30 s). Computed from indexed data, nothing is stored.

| Severity | Item | Condition |
|---|---|---|
| Act now | TGE date passed | market Live or Suspended and the market's (or project's) TGE date is in the past |
| Act now | Indexer behind or stopped | more than 100 blocks behind, or no update for 3 minutes |
| Soon | Trading ended | market Live or Suspended, trading end passed, no TGE date |
| Soon | Deadline within 24 hours | settlement open with open trades |
| Soon | Deadline passed | settlement open, open trades remain |
| Soon | Keeper needs attention / has stopped | see [KEEPER.md](KEEPER.md) |
| Info | Ready to complete | settlement open and no open trades |
| Info | Created on-chain, not activated | market in Setup |
| Info | Applications waiting | projects in Submitted |

## 4. Reminders (in-app notifications)

Run by the indexer loop every `OPS_INTERVAL_SECONDS` (default 60). Idempotent through `dedupe_key`, so nothing is sent twice for the same deadline.

| When | To | Notification |
|---|---|---|
| 24 hours before the deadline | seller | deliver before ..., approve the token first |
| 1 hour before the deadline | seller | settle now to avoid losing the collateral |
| deadline passed | seller | the buyer can claim; you can still settle until they do |
| deadline passed | buyer | the seller did not deliver; claim now |

Only trades that are still open are reminded. They appear in the bell and on Portfolio -> Notifications, linking to Settlement Status. If the deadline is extended, the reminders start again for the new deadline (the key includes the deadline).

## 5. Admin webhook

Set `ADMIN_WEBHOOK_URL` (https only). Each new **Act now** or **Soon** item is POSTed once as `{"text": "...", "content": "..."}` (works with Slack and Discord incoming webhooks, or a small relay for Telegram). A resolved item is forgotten, so if it comes back it is sent again. Failures are logged and retried on the next pass. The compose files pass `ADMIN_WEBHOOK_URL` and `OPS_INTERVAL_SECONDS` to the indexer service.

## 6. Pause control

**Admin -> Settings -> New orders.** Reads `paused()` from the contract and calls `pause()` or `unpause()` (needs the `PAUSER_ROLE` on the connected wallet; the button is disabled otherwise). Pausing blocks only new orders. Cancel, settle, default claims and refunds always work.

## Configuration summary

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_WEBHOOK_URL` | empty | where alerts are posted |
| `OPS_INTERVAL_SECONDS` | 60 | how often reminders and alert checks run |
