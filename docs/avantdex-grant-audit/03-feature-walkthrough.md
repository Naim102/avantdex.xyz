# 03. Feature-by-feature walkthrough

Audit date: 2026-11-21, commit `f6e4da8`. Each feature lists the path **user action, frontend, API, backend, database, wallet, contract, event, UI result**, then a status and its evidence. "Recorded test" means a result in `docs/TEST-REPORT.md` (a local dev stack with a mock wallet on a local chain using Arc's chain id; this audit did not re-run it). "On-chain evidence" means a read-only read of Arc Testnet made on 2026-11-21.

Real-network evidence that exists today (all read-only): the exchange has 4 markets, 15 orders, 4 trades. Trade 2 is **Settled** (12.0 USDC value, fees 0.06 + 0.06 USDC, matching the API's `fees_paid` of 120000 base units), trade 1 is **Refunded**, trades 3 and 4 are **Open** on market 4 (Live), market 3 is **SettlementOpen**, markets 1 and 2 are **Cancelled**. So the place, match, settle and refund paths have each executed at least once on Arc Testnet v2.

## F1. Wallet connect and sign-in

* **User action:** clicks Connect Wallet; picks a wallet (or Circle passkey, if enabled); signs a login message.
* **Frontend:** `src/components/ConnectButton.tsx` (dialog: Circle Wallet first, then ConnectKit wallet list), `src/config.ts` (wagmi connectors: **only** `injected()` and `circleWallet()`; no WalletConnect connector or project id is configured, although the dialog text at `ConnectButton.tsx` line 121 names WalletConnect and Coinbase Wallet: whether non-injected mobile wallets can connect is UNKNOWN and was not tested, `TEST-REPORT.md` lists "mobile wallets" as not covered), `src/hooks/useApp.tsx` (auth context).
* **API:** `POST /api/auth/nonce`, `POST /api/auth/verify` (rate limit 30 per 60 s per IP), `GET /api/auth/me`, `POST /api/auth/logout` (`backend/app/routers/auth.py` lines 38 to 59).
* **Backend:** `security.py`: `issue_nonce`, `build_message` (the text says it authorizes no transaction), `verify_signature` (ECDSA, else `_smart_wallet_signed` through `smart_sig.py`: ERC-1271, or ERC-6492 for an undeployed account), `create_token` (JWT 12 h; admin 2 h), `roles_of`.
* **Database:** `auth_nonces`, `users`, `admin_roles`.
* **Wallet / contract / event:** a `personal_sign` only. No transaction, no contract call.
* **UI result:** header shows the address; admin links appear if an admin row exists for the address.
* **Status:** VERIFIED for ECDSA and smart-account signatures (recorded tests: `backend/tests/test_auth.py` 18 tests, `test_smart_wallet.py` 7 tests with real ERC-1271 and ERC-6492 accounts on a local chain; UI test connects and signs in). Circle passkey path: IMPLEMENTED, **not exercised with a real Circle Client Key** (`TEST-REPORT.md` "Not covered"; live `/api/config` shows `circle_wallet.enabled: false`).

## F2. Browse markets (Home, Explore, Market page)

* **User action:** opens Home or Explore, searches, filters by category, opens a market.
* **Frontend:** `src/pages/Home.tsx`, `Explore.tsx`, `MarketDetail.tsx`; `MarketBoard`, `MarketCard`, `OrderBook`, `DepthChart`, `UpcomingSection`.
* **API:** `GET /api/markets`, `/api/stats`, `/api/trades/recent`, `/api/projects/upcoming`, `/api/markets/{key}`, `/orderbook`, `/trades`, `/stats` (`public.py` lines 200 to 403).
* **Backend / database:** aggregates over `markets`, `orders`, `trades`, joined to `projects`. Order book groups live orders by side and price and returns cumulative lots and `last_indexed_block`.
* **Wallet / contract:** none (read only).
* **UI result:** board with bid and ask, volume, open interest, depth chart. All numbers come from the API (project rule: never invent market data).
* **Status:** VERIFIED. Live `/api/stats` on 2026-11-21: `markets_live` 2, `markets_total` 4, `open_orders` 6, `trades_total` 4, `trades_settled` 1, `volume_total` 36500000 (36.5 USDC), `fees_paid` 120000. These are **testnet** numbers (see `09-product-business-analysis.md`: not traction).

## F3. Place a limit order or a market-style (IOC) order

* **User action:** enters side, price per token, size; clicks Approve (if needed), then Place order.
* **Frontend:** `src/components/TradePanel.tsx` (match plan query at line 83; approval at line 110; `placeOrder` call at line 124; `ioc = type === 'market'`, `minFill`), `src/hooks/useTx.ts` (simulate first, `maxFeePerGas` at least 20 gwei, success only after a successful receipt), `src/lib/exchange.ts` (`parseOrderInput`, `fee`, `CONTRACT_ERRORS` messages).
* **API:** `GET /api/markets/{key}/match-plan` (best-first maker ids, up to 50, advisory: "the contract validates every maker").
* **Backend / database:** reads `orders` filtered to live opposite-side orders at crossing prices, excluding the caller's own orders.
* **Wallet:** (1) `USDC.approve(exchange, total)` with the exact amount; (2) `placeOrder(marketId, side, price, lots, expiry, ioc, minFillLots, makerIds)`.
* **Contract:** `placeOrder` (`AvantdexExchange.sol` line 396): checks market Live and inside the trading window, price multiple of `tickSize`, lots within min and max, order value at least 1 USDC, expiry at most `tradingEnd`, at most 50 makers; `_match` per maker at the **maker's price**; buy orders lock value plus 0.5% fee reserve, sell orders lock value as collateral; leftover rests (limit) or is discarded (IOC); one `_pullUsdc` at the end with a balance-delta check.
* **Events:** `OrderPlaced`, `TradeExecuted` (per fill), `OrderCancelled` (reason `IocRemainder`, ignored in notifications).
* **Indexer / database:** `_on_OrderPlaced` (worker line 253), `_on_TradeExecuted` (294) insert `orders` and `trades` and write `trade_created` notifications for both parties; `_sync` re-reads `getOrder`, `getTrade`, `getMarket` at the processed block.
* **UI result:** order appears in "My orders" and the book; fills appear as trades; the portfolio updates.
* **Status:** VERIFIED. Recorded tests: contract unit, fuzz and invariants (`Avantdex.t.sol`); UI test "place a limit buy (USDC approval then order)" and "market buy (IOC) fills against resting sell orders". On-chain evidence: 15 orders and 4 trades exist on v2. Design limitation: the contract does not enforce best-price priority (R-7 in `04-smart-contract-analysis.md`).

## F4. Cancel an order, expire an order

* **User action:** clicks Cancel on an open order. Anyone (a keeper, a bot) can expire old orders.
* **Frontend:** `src/components/MyOrders.tsx`.
* **Contract:** `cancelOrder(orderId)` (line 454: owner only, returns the full remaining lock, fee 0, allowed even when paused or the market is suspended); `expireOrders(ids)` (line 462: anyone, up to 50, funds always go to the owner).
* **Events and indexer:** `OrderCancelled` then `_on_OrderCancelled` writes an `order_cancelled` or `order_expired` notification ("Your remaining lock of X USDC was returned").
* **Keeper:** `Keeper.expire_orders` (`keeper.py` line 93) when enabled.
* **Status:** VERIFIED (recorded UI test: cancel shows status Cancelled; contract tests). Keeper: IMPLEMENTED, off by default, **not running on the live deployment** (live config does not show it; `KEEPER_ENABLED` defaults to false in `config.py`).

## F5. Portfolio, positions and claimable USDC

* **User action:** opens Portfolio; may withdraw USDC that could not be pushed earlier.
* **Frontend:** `src/pages/Portfolio.tsx`, `src/components/PortfolioOverview.tsx` (token allocation per market).
* **API:** `GET /api/portfolio/{address}/orders|trades|summary|positions` (`public.py` lines 464 to 546), notifications under `/api/notifications` (`user.py` line 229).
* **Contract:** `withdrawClaimable()` (line 542) pays `claimable[msg.sender]`; `_pay` credits `claimable` when USDC transfer fails (for example a blocklisted recipient).
* **Events / database:** `ClaimableCredited`, `ClaimableWithdrawn` update `claimable_credits`.
* **Status:** VERIFIED (recorded UI test: portfolio overview, trade history and settlement tabs; contract tests for blocklisted recipients with a mock USDC). Not tested against the real Arc blocklist (finding M-2 in the repository's own audit).

## F6. Settlement after the token launch (seller delivers)

* **User action (admin):** after the token exists on Arc, a manager opens settlement with the token address and a 1 hour to 14 day window. **User action (seller):** approves the project token for the exchange, then clicks Settle.
* **Frontend:** admin `SettlementManagement` (`src/pages/admin/Markets.tsx`), pre-flight panel; trader Portfolio settlement tab.
* **API:** `GET /api/admin/token-check` (reads `name`, `symbol`, `decimals`, `totalSupply`, code size from the chain and compares with the project record and the typed value; `ops.py` `check_token`), `POST /api/admin/markets/{mid}/note-action` (stores a transaction hash the browser reports).
* **Contract:** `openSettlement(marketId, token, windowSeconds)` (line 343: `MARKET_MANAGER_ROLE`; token must be a contract, must match any token set at creation, and `decimals()` must equal the stored `tokenDecimals`); `settleTrade(tradeId)` (line 479): marks the trade Settled, pulls the token from the seller to the buyer, **verifies the buyer's balance delta equals the amount**, pays the seller `2 x value - sellerFee`, pays the fee collector both fees.
* **Events:** `SettlementOpened`, `MarketStatusChanged`, `TradeSettled`, `FeeCollected`.
* **UI result:** trade shows Settled; fee collector total rises.
* **Status:** VERIFIED for the code path (contract tests; recorded UI test "the seller approves the token and settles, the trade shows Settled and the fee collector total rises"; **on-chain: trade 2 Settled on Arc Testnet**). Open item, a **mainnet blocker** acknowledged by the project: the token address is chosen by one manager signature (finding H-1 in `docs/AUDIT-2026-11-ARC-CIRCLE.md`); see `04-smart-contract-analysis.md` R-1.

## F7. Default claim (seller fails to deliver)

* **User action:** after the deadline, the buyer (or anyone, since v2) clicks Claim.
* **Contract:** `claimDefault(tradeId)` (line 509): requires `SettlementOpen` and `block.timestamp > settlementDeadline`; pays the **buyer** `2 x value + buyerFee` (payment, fee reserve and the seller's collateral); no platform fee.
* **Events:** `TradeDefaulted`. **Indexer:** `_on_TradeDefaulted` notifies both parties.
* **Status:** VERIFIED in tests (recorded UI test: chain clock moved past the deadline, buyer claims, status Defaulted; contract tests). **Not yet observed on Arc Testnet v2** (no trade is Defaulted on chain today). The keeper does not perform this duty yet (finding M-5).

## F8. Refund (market cancelled or abandoned)

* **User action:** anyone triggers a refund; each side receives its own funds.
* **Contract:** `cancelMarket` (line 328, manager; closed after `CANCEL_GRACE` of one hour once settlement is open) then `refundTrade(tradeId)` (line 525): buyer gets `value + buyerFee`, seller gets `value`, **no fee**. A market that never reaches settlement is refundable 90 days after `tradingEnd` (`_isRefundable`, line 594).
* **Keeper:** `Keeper.refund_trades` (line 98) when enabled.
* **Status:** VERIFIED on-chain: trade 1 is **Refunded** on Arc Testnet v2 (market 2 Cancelled).

## F9. Project listing and community listing request (off-chain)

* **User action:** completes the Create Listing form (project) or files a community listing request for a token.
* **Frontend:** `src/pages/Listing.tsx` (`ListingHub` at `/list`, `SubmitProject` at `/list/submit`, `RequestListing` at `/list/request`). Arc is a fixed value in the form.
* **API:** `POST /api/projects` (20 per hour per IP), `PUT /api/projects/{pid}`, `POST /api/projects/{pid}/submit`, `GET /api/projects/mine`, `POST /api/listing-requests` (30 per hour), `GET /api/listing-requests/summary|mine` (`user.py`). The Arc-only rule `arc_chain` (`utils.py`) answers `arc_only` for other chains. A TGE date may be `TBD` (`projects.tge_tbd`, migration 0003).
* **Database:** `projects`, `project_status_history`, `listing_requests`.
* **Contract:** none. **Create Listing is not Create Order** (project rule).
* **Status:** VERIFIED (recorded UI test: submit a listing request; `test_projects.py` 28 tests; TBD flow). Review quality (who verifies a team) depends on admin process, not code.

## F10. Admin: review, verify, create and activate a market

Three separate steps, as the project rules require:

1. **Approve the project.** `POST /api/admin/projects/{pid}/transition` (Applications and Verification pages); badges via `POST /api/admin/projects/{pid}/badges`.
2. **Create the market.** `POST /api/admin/markets` makes a **draft** (only for an Approved project; trading end at least 1 hour after start; `metadata_ref = keccak256(slug)`). The admin then signs `createMarket(...)` from the dashboard (needs `MARKET_MANAGER_ROLE`). `MarketCreated` is indexed and linked to the draft by `metadataRef` (`_on_MarketCreated`, worker line 220); a duplicate creation is ignored.
3. **Verify and activate.** `GET /api/admin/markets/{mid}/verify-config` reads the market back from the chain and compares 9 fields with the draft; activation is blocked on mismatch; `POST .../approve-activation` records a second approver when `REQUIRE_TWO_PERSON_APPROVAL=true` (off by default); the admin signs `activateMarket(marketId)`; the site shows the market once `Live`.
* **Other admin actions:** hide or show a market (`POST /api/admin/markets/{mid}/delist`, off-chain only: orders, settlement and refunds are untouched), `GET /api/admin/attention` (trading ended but settlement not open, deadline within 24 h, open trades past the deadline, indexer lag), roles (`/roles`), audit logs (`/audit-logs`), settings (fee collector view, pause, keeper status).
* **Status:** VERIFIED in the recorded UI test (draft, create on-chain, verify, activate, hide and show, add and remove an admin, grant the on-chain manager role). One audit gap: the audit log entry for an on-chain action is **self-reported by the browser** (finding M-3).

## F11. Disputes and notifications (off-chain)

* **User action:** a trade participant opens a dispute ticket; admins resolve it.
* **API:** `POST /api/disputes` (20 per hour), `GET /api/disputes/mine`, admin `GET /api/admin/disputes`, `POST /api/admin/disputes/{did}`.
* **Contract:** none. A dispute ticket cannot change an on-chain outcome. No duplicate guard per trade (L-9 in the repository's audit).
* **Status:** IMPLEMENTED; `test_disputes_notifications.py` has 3 tests.

## F12. Bridge USDC with CCTP V2 (Circle)

* **User action:** chooses source and destination network and an amount on `/bridge`; picks "I finish it myself" or "Circle finishes it".
* **Frontend:** `src/pages/Bridge.tsx` (lazy chunk), `src/lib/directBridge.ts` (`burnStandard` line 120, `completeTransfer` line 164, `isReceived` line 218), `src/lib/cctp.ts` (`fetchMessage`, `waitForAttestation`, `verifyAttestation`, `parseMessage`), `src/lib/bridgeRoutes.ts` (24 testnet routes built from Circle's Bridge Kit chain data).
* **API:** only `/api/config` for `cctp.api_url`. No Avantdex contract and no Avantdex backend is in the path.
* **Wallet:** approve USDC; `TokenMessengerV2.depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller=0, maxFee=0, minFinalityThreshold=2000)`; then `MessageTransmitterV2.receiveMessage(message, attestation)` on the destination chain.
* **Circle service:** Iris sandbox `GET /v2/messages/{sourceDomain}?transactionHash=...` and `GET /v2/publicKeys`.
* **Recovery:** the burn hash is kept in this browser (`avantdex:bridge:v2`); "Finish on {chain}" resumes from the hash.
* **Status:** PARTIAL. VERIFIED: the call arguments, message layout and nonce handling against the **real CCTP V2 contracts** on Base Sepolia and Ethereum Sepolia forks (`scripts/test-bridge-fork.mjs`, 11 checks; only the attester was the test's own key), a read-only data check of every address against Circle's tables (`scripts/verify-cctp.mjs`), and a live Forwarding fee quote in the UI test. **Not yet done:** a complete public-testnet transfer with Circle's live attestation signatures (needs funds; `docs/CCTP.md` "Limits"). Note: a Circle Wallet cannot start a bridge transfer (Arc-only provider).

## F13. Operations: keeper, reminders, webhook

* **Ops job** (`ops.py`, run from the indexer loop each `OPS_INTERVAL_SECONDS`): writes deadline reminder notifications (24 h and 1 h before a deadline), builds the attention list, can POST a JSON summary to `ADMIN_WEBHOOK_URL`. Sends no transactions.
* **Keeper** (`keeper.py`): see F4, F8. Writes `audit_logs` rows with role `keeper`.
* **Status:** IMPLEMENTED and unit tested (`test_ops.py` 7 tests; keeper tests in `test_chain.py`). Whether either runs on the live deployment is UNKNOWN from the repository (the live health endpoint reports only the indexer: lag 0 at block 73,366,759).

## F14. Roadmap and testnet notice

* `src/lib/roadmap.ts` holds the seven roadmap steps (two marked completed: 15 and 17 November 2026; five upcoming or long-term with target dates from 28 February 2027 to 30 September 2027 and ongoing). `src/components/Roadmap.tsx` renders them on Home and `/roadmap`. The site says in four places that it runs on Arc Testnet and that the contract is not audited (`docs/ROADMAP.md`).
* **Status:** VERIFIED (recorded UI test). The adoption goals in step 6 (100 wallets, 10 listings, 25 trades) are goals, not results.

## Pipeline map for the three money flows

```mermaid
sequenceDiagram
  participant Adm as Manager wallet
  participant S as Seller
  participant B as Buyer
  participant C as Exchange
  participant I as Indexer
  Note over C: Market Live, trade 3 Open (buyer escrow: value + fee reserve, seller collateral: value)
  Adm->>C: openSettlement(market, token, window)
  C-->>I: SettlementOpened, MarketStatusChanged(SettlementOpen)
  alt seller delivers before or after the deadline (until default is claimed)
    S->>S: approve(token, exchange, amount)
    S->>C: settleTrade(trade)  (anyone may call; token comes from the seller's own balance)
    C->>B: token amount (balance delta checked)
    C->>S: 2 x value - sellerFee (USDC)
    C->>C: fees to feeCollector
    C-->>I: TradeSettled, FeeCollected
  else seller does not deliver, deadline passed
    B->>C: claimDefault(trade)  (anyone may call; money goes to the buyer)
    C->>B: 2 x value + buyerFee (no platform fee)
    C-->>I: TradeDefaulted
  else market cancelled or abandoned
    B->>C: refundTrade(trade)  (anyone may call)
    C->>B: value + buyerFee
    C->>S: value
    C-->>I: TradeRefunded
  end
```
