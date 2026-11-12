# Admin, token configuration and settlement: audit and plan

Scope: `contracts/AvantdexExchange.sol`, `backend/app` (admin API, indexer), the admin dashboard in `src/pages/admin`. Read-only review on 2026-11-10. Nothing was changed by this document. Severity is about product risk on a testnet that is meant to become a real product.

## 1. What an admin can configure today

| Item | Where | Notes |
|---|---|---|
| Project record: name, token name and symbol, category, chain, website, socials, docs, supply, allocation, TGE text, TGE date, token address (optional), evidence, team wallet, logo URL | Applications -> Add / Edit | Same validation as the public form. TGE date is off-chain only. |
| Market draft: token decimals, lot size (tokens), tick size (USDC per token), min and max order (lots), trading start, trading end | Approved Projects -> Configure market | Becomes immutable once created on-chain. The draft API also accepts `tge_date`, but the form does not send it (it falls back to the project's). A draft cannot be edited afterwards. |
| On-chain market actions | Market Management / Live Markets / Settlement | create, verify, approve, activate, suspend, resume, cancel, open settlement (token address, window 1 to 336 h), extend deadline, complete. All need `MARKET_MANAGER` on the signing wallet. |
| Visibility | Market cards | Hide or show a market on the site (off-chain only). |
| Fee collector | Settings | `setFeeCollector`, needs `DEFAULT_ADMIN`. |
| Pause | not in the UI | `pause/unpause` exist in the contract (`PAUSER_ROLE`); there is no button. |

Token related facts that matter: the token address may be empty until the market is created, and is then fixed by `openSettlement` (it must match if one was set). Decimals are typed by hand and only used to compute lot size and for display.

## 2. How settlement works on-chain (what is enforced)

1. Trading is allowed only while status is `Live` and `tradingStart <= now < tradingEnd`. Order expiry cannot exceed `tradingEnd`.
2. A manager calls `openSettlement(market, token, window)`: status must be `Live` or `Suspended` (it does not need `tradingEnd` to have passed, and nothing forces it to be called). Window is 1 hour to 14 days. Trading stops. `extendSettlement` can push the deadline up to 30 days after opening.
3. The seller calls `settleTrade`: token moves seller -> buyer, verified by the buyer's balance change, then payout plus collateral minus seller fee goes to the seller and both fees to the collector. Works until the buyer claims a default, also after the deadline.
4. After the deadline the buyer calls `claimDefault`: payment, fee reserve and the seller's collateral go to the buyer, no fee.
5. `cancelMarket` (any state except Completed/Cancelled) makes every open trade refundable by anyone with no fee. After `tradingEnd + 90 days` a market that never reached SettlementOpen is refundable too.
6. `completeMarket` needs zero open trades.

## 3. Findings

### High

**H1. Decimals are never checked against the real token.** Lot size is stored in token base units, computed in the browser from a typed decimals value (default 18). `openSettlement` does not read `decimals()`. If the real token has 6 decimals, one "1 token" lot would settle as 10^12 tokens. The market parameters are immutable, so the only recovery is to cancel the market.
*Fix:* read `decimals()` (and name, symbol, total supply) from the token wherever an address is known, show it next to the typed value, and block activation on mismatch. On-chain: store `tokenDecimals` at creation and require `IERC20Metadata(token).decimals()` to equal it in `openSettlement`.

**H2. The token address that settlement uses is set by one manager signature, with no verification.** A wrong or malicious address makes sellers deliver the wrong asset (buyers pay real USDC for it). The UI warns about it, but nothing checks the address against the project's confirmed address, the contract badge or the on-chain metadata.
*Fix:* a pre-flight panel before "Open settlement" that shows project-confirmed address vs entered address, code size, name, symbol, decimals, total supply, explorer link, and requires typing the symbol to confirm; refuse if it differs from `project.token_address` unless an admin explicitly overrides (audit-logged). Longer term, a two-person approval (the `REQUIRE_TWO_PERSON_APPROVAL` flag exists for activation only).

**H3. A manager can cancel a market while settlement is open.** `cancelMarket` is allowed in `SettlementOpen`. That turns every pending default claim into a plain refund, so a manager could rescue defaulting sellers from losing their collateral (or cancel to stop a legitimate settlement). Funds are never lost or redirected, but the economic guarantee "default pays the buyer" depends on manager honesty.
*Fix (contract v2):* disallow `cancelMarket` once `SettlementOpen` unless the deadline has not passed and no trade has settled yet, or remove cancel there altogether. Until then, document it in the rules page and require two admins.

### Medium

**M1. No time-based follow-up exists.** There is no scheduler anywhere in the backend. After `tradingEnd` a market sits as `Live` in the database until a human acts; nobody is told that TGE has passed, that settlement is still closed, that a deadline is close, or that a market can now be completed. Users rely on their own countdown on the portfolio page. If managers stay silent, funds are locked until the 90-day abandon rule.
*Fix:* a keeper service (section 5) plus an admin "Needs attention" list.

**M2. `completeMarket` can be blocked by unclaimed trades.** It requires zero open trades. After the deadline an unsettled trade stays open until its buyer claims or its seller settles. A market with one inactive buyer can never be completed, and `SettlementOpen` never ends.
*Fix (contract v2):* let anyone call `claimDefault` and `refundTrade` after the deadline on behalf of the buyer (the payout still goes to the buyer, so it is safe), or let a manager force-close defaulted trades.

**M3. Sellers can miss the deadline by inaction even when they are willing.** `settleTrade` is seller-only, and needs a token approval first. A late seller loses the collateral to the buyer.
*Fix:* reminders (24 h, 1 h before deadline), plus optionally allow anyone to call `settleTrade` for a seller who has already approved the token (the funds go to the same two parties, so it is safe).

**M4. TGE date is informational only.** It is not tied to `tradingEnd`, to opening settlement, or to any alert. The market draft form does not even collect it (it silently uses the project's date); a draft cannot be edited. A TGE date moved by the project has no place to be updated except the project record.
*Fix:* collect and edit `tge_date` on the market (off-chain), show "TGE passed, settlement not opened" in admin, and default `tradingEnd` to the TGE date.

**M5. Tokens that do not behave.** Fee-on-transfer and rebasing tokens make the balance-delta check fail (`DeliveryNotVerified`), so a willing seller can never settle and is forced into default. A token that blocklists the buyer or the exchange has the same effect. Pausable or upgradeable tokens can freeze delivery later.
*Fix:* pre-flight simulation at settlement time (an `eth_call` of a transfer between two test accounts is not possible, so check the token's known features and require manager sign-off), and a "token risk" note on the market page.

### Low

- **L1.** Pause (`PAUSER_ROLE`) has no dashboard control; the only emergency stop for new orders needs a CLI or block-explorer call.
- **L2.** Draft parameters cannot be edited or discarded from the dashboard once a draft exists. A wrong draft needs a new project record or database surgery. Add "Edit draft" and "Discard draft" while no on-chain market exists.
- **L3.** Pressing Create on-chain twice sent the same draft to the chain several times. Fixed in the dashboard and indexer on 2026-11-10 (copies are ignored), but the contract still accepts duplicate `metadataRef` values. Contract v2 can reject a `metadataRef` that is already used.
- **L4.** Time zones: the form uses the browser's local time and converts to UTC. The dashboard should show the UTC time next to the local time for trading and settlement windows so two admins agree.
- **L5.** Settlement window bounds (1 h to 14 d, 30 d total) are fixed constants; a project with a long vesting claim may need a different policy. Keep as is, but write the policy down.
- **L6.** `MAX_BATCH` is 50, so a taker supplies at most 50 maker orders per call; fine for now, document it for market makers.

### Verified as sound

Escrow bookkeeping, settle/default/refund payouts, fee only on settlement, push-with-fallback to `claimable` for blocklisted accounts, reentrancy guard, role split (only the fee collector address can change, by `DEFAULT_ADMIN`), no function that moves escrowed funds to an admin. 104 contract tests, including invariants, pass.

## 4. What can be automated, and what cannot

| Step | Today | Who may call it on-chain | Automate? |
|---|---|---|---|
| Clean up expired orders (`expireOrders`) | manual | anyone | Yes, keeper, no trust needed. |
| Refund trades of a cancelled or abandoned market (`refundTrade`) | each user | anyone | Yes, keeper, no trust needed. |
| Open settlement (`openSettlement`) | manager | MARKET_MANAGER | Only semi-automatic: keeper prepares and checks, a human signs (H2). |
| Extend settlement | manager | MARKET_MANAGER | Human decision. |
| Complete market (`completeMarket`) | manager | MARKET_MANAGER | Yes once no trade is open; low risk, but needs the manager key or a v2 permissionless version. |
| `claimDefault` | buyer | buyer only | Not with the current contract. v2: anyone may trigger it for the buyer. |
| `settleTrade` | seller | seller only | Not with the current contract. v2: anyone may trigger it when the seller has approved. |
| Suspend / cancel / pause | manager / pauser | restricted | Human decision, plus alerts. |

Rule of thumb: automate what only moves funds to their rightful owners (cleanup, refunds, defaults, settlements the seller already approved), and keep every decision that changes the rules (token address, cancel, extend) behind a human signature.

## 5. Plan

**Status 2026-11-10: Phase 1 is implemented** (token pre-flight with decimals check and typed confirmation before settlement, TGE date and UTC preview on the market form, edit and discard of drafts, Needs attention list on the admin overview, pause button on Settings, deadline reminders for buyers and sellers, optional admin webhook). **Phase 2 (keeper) is implemented** with the permissionless duties plus an optional, off-by-default completeMarket. Phases 3 and 4 are still open. Details of what shipped are in docs/RUNBOOK.md, section Operations.

### Phase 1: dashboard and backend only (no contract change, about 1 week)
1. **Token pre-flight panel** (H1, H2): read `decimals/name/symbol/totalSupply/code` from the chain, compare with the project record and the typed decimals, block mismatches, require a typed confirmation, audit-log the result.
2. **Market form**: add TGE date, UTC preview, "default trading end to TGE", edit and discard draft (L2, L4, M4).
3. **Needs attention** list on the admin overview, computed by the API from indexed data: trading ended and settlement not open, TGE date passed, settlement deadline within 24 h, open trades past the deadline, market ready to complete, indexer lag, manager wallet without role.
4. **Pause / unpause** buttons (L1).
5. **Notifications** to sellers and buyers (24 h and 1 h before a deadline, "settlement opened", "deadline passed, claim now") using the existing notification table, written by a small scheduled job.
6. Optional email or Telegram webhook for admins (`ADMIN_WEBHOOK_URL`), so alerts reach people who are not in the dashboard.

### Phase 2: keeper service (about 1 week, one new container)
A separate worker next to the indexer with its **own wallet and a deliberately small permission set**.
- Permissionless duties only: `expireOrders`, `refundTrade` for cancelled or abandoned markets. The key holds no role and only needs gas.
- A second, optional mode with `MARKET_MANAGER` for `completeMarket` when no trades are open. Keep it off by default; if on, the key is a hot key with a spending limit on gas only, and the audit log records every call.
- Never give the keeper `cancelMarket`, `openSettlement` or `extendSettlement`.
- Config: `KEEPER_PRIVATE_KEY`, `KEEPER_ENABLED`, `KEEPER_MAX_GAS_GWEI` (at least 20 gwei on Arc), dry-run mode that only logs what it would send.

### Phase 3: contract v2 (about 2 weeks including tests, and a new deployment)
Only the changes that remove real risk:
1. `tokenDecimals` at creation, checked in `openSettlement` (H1).
2. `cancelMarket` not allowed after settlement opened (H3).
3. `claimDefault` and `refundTrade` callable by anyone for the rightful receiver; `settleTrade` callable by anyone when the seller has approved (M2, M3).
4. Reject a reused `metadataRef` (L3).
5. Optional `tgeTime` stored on-chain, `openSettlement` allowed only after it unless the manager passes an explicit override flag that emits an event (M1, M4).
6. Optional separate `KEEPER_ROLE` limited to `completeMarket`.

Every v2 item needs tests (including the invariant suite), an independent review and a fresh deployment. The indexer already resets itself when the contract address changes (added 2026-11-10), so switching is a config change.

### Phase 4: before real money
Independent audit of the v2 contract, legal review, mainnet deployment by the owner with a multisig as admin, and a published settlement policy (window sizes, what happens on a late TGE, how a token address is verified).

## 6. Suggested order

1. Phase 1 items 1, 2, 3 (they remove H1/H2/M1/M4 without touching the contract).
2. Phase 2 with only the permissionless duties.
3. Decide on contract v2; if yes, ship items 1 to 4, then re-run the full test suite and redeploy.
