# Contract v2 (Phase 3)

Source: `contracts/AvantdexExchange.sol`. Tests: `contracts/test/Avantdex.t.sol` (64 tests including 8 for v2 and the invariant suite), `backend/tests/test_chain.py`. Status: **not audited, testnet only**. The previous version (v1) stays in `deployments/arc-testnet-previous.json`; the Git history keeps its source.

## What changed and why

Each change closes a finding from [SETTLEMENT-AUDIT-AND-PLAN.md](SETTLEMENT-AUDIT-AND-PLAN.md).

| # | Change | Finding | Behaviour |
|---|---|---|---|
| 1 | **Token decimals are stored and checked** | H1 | `createMarket(..., metadataRef, tokenDecimals)` stores the decimals (0 to 36). If the token address is already known, the contract calls `decimals()` and reverts with `DecimalsMismatch` when they differ or the call fails. `openSettlement` checks again, so a token whose decimals differ from the lot-size assumption can never reach settlement. A market created with no token address is checked when settlement opens. |
| 2 | **`cancelMarket` closes after one hour of settlement** | H3 | Allowed while the market is `Setup`, `Live` or `Suspended`, and during `CANCEL_GRACE` (1 hour, equal to `MIN_SETTLEMENT_WINDOW`) after `openSettlement`, to undo a mistaken token or window. After that it reverts with `CancelWindowClosed`. Because the grace is not longer than the shortest possible settlement window, it always ends before any deadline, so a manager can no longer cancel away a default. |
| 3 | **`claimDefault` and `settleTrade` are open to any caller** | M2, M3 | The caller gets nothing: `claimDefault` pays the buyer (payment, fee reserve and the seller's collateral), `settleTrade` pulls the token from the seller's own balance and allowance to the buyer and pays the seller. A keeper, the buyer or the seller can trigger them. A third party cannot deliver for a seller who did not approve the token (the transfer reverts). `NotSeller` and `NotBuyer` no longer exist. |
| 4 | **One market per `metadataRef`** | L3 | A non-zero `metadataRef` can be used once (`metadataRefUsed(ref)`); a second `createMarket` reverts with `MetadataRefUsed`. Zero is exempt (markets without an off-chain record). |

Unchanged: fees (0.5% buyer, 0.5% seller, only on settled trades), roles, pause semantics, escrow accounting, refunds, push-with-fallback to `claimable`. No role can move escrowed funds.

## ABI changes

| Item | Before | After |
|---|---|---|
| `createMarket` | 8 arguments | 9: appended `uint8 tokenDecimals` |
| `getMarket` struct `Market` | 12 fields | appended `uint8 tokenDecimals` (index 12) |
| Event `MarketCreated` | ... `tradingEnd` | appended `uint8 tokenDecimals` |
| New | | `CANCEL_GRACE()`, `metadataRefUsed(bytes32)`, errors `DecimalsMismatch`, `MetadataRefUsed`, `CancelWindowClosed` |
| Removed | `NotSeller`, `NotBuyer` | |

Regenerated: `backend/app/abi/AvantdexExchange.json`, `src/lib/exchangeAbi.ts`.

## Where the rest of the system changed

* **Backend** (`backend/app/chain.py`, `routers/admin.py`, `indexer/worker.py`): `decode_market` returns `token_decimals`; the draft's `onchain_params` include `tokenDecimals`; **Verify configuration** compares it with the chain; the indexer stores it from `MarketCreated` and from every market sync.
* **Dashboard** (`src/pages/admin/Markets.tsx`): "Create on-chain" sends the draft's decimals. **Cancel market** is hidden once the first hour of settlement has passed, with a note explaining why. The market page's Rules tab states the new rules.
* **Scripts**: `scripts/seed_demo_markets.py` and `scripts/testnet_e2e.py` pass the decimals.
* **Indexer defence kept**: a repeated `metadataRef` from an old contract is still ignored (see [OPERATIONS-PHASE-1.md](OPERATIONS-PHASE-1.md) and the RUNBOOK).

## Tests added

| Test | Proves |
|---|---|
| `test_v2_cancelAfterSettlementOpened_onlyDuringGrace` | cancel reverts after one hour; a default is then claimed by a stranger and the buyer is paid |
| `test_v2_cancelAtExactlyTheGraceEndStillWorks` | the boundary is inclusive |
| `test_v2_graceEqualsMinimumSettlementWindow` | grace can never outlast a deadline |
| `test_v2_createMarket_checksDecimalsOfAKnownToken` | wrong decimals, a contract without `decimals()`, and decimals above 36 all revert |
| `test_v2_openSettlement_rejectsATokenWithOtherDecimals` | a 6-decimals market refuses an 18-decimals token |
| `test_v2_metadataRefIsUsedOnce_zeroIsExempt` | reuse reverts, zero is exempt |
| `test_v2_aStrangerCannotMoveFundsToThemselves` | the caller of `claimDefault` gains nothing |
| `test_v2_aSettleByAStrangerNeedsTheSellersApproval` | without the seller's approval the stranger's settle reverts and the trade stays open |
| `test_settleTrade_guards`, `test_claimDefault_*` (updated) | a stranger can settle and claim; the money lands with the right party |
| `backend`: `test_a_draft_cannot_be_sent_to_the_chain_twice`, `test_verify_config_compares_the_stored_decimals` | the contract refuses the duplicate; the stored decimals reach the API |

## Deployment record

| | |
|---|---|
| Version | v2 |
| Network | Arc Testnet, chain 5042002 |
| Address | `0xb48935EeA3B7264a53098B1DB920C3fCa09C0283` ([explorer](https://explorer.testnet.arc.io/address/0xb48935EeA3B7264a53098B1DB920C3fCa09C0283)) |
| Deploy block / tx | 71711143 / `0x3d493266836bc1ee6cf4e296d007a899cd3e8f15bc7614d0bf9624a663e4ce93` |
| Owner (`DEFAULT_ADMIN`, `MARKET_MANAGER`, `PAUSER`) | `0x378862A20B312298dc54585CbabC531D70F9baE9`; the deployer wallet holds no role |
| Fee collector, fees | `0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6`, 0.5% + 0.5% on settled trades |
| Checks after deployment | roles as above; `CANCEL_GRACE` = 3600; runtime code 16,175 bytes equal to the local build except the 6 bytes of the USDC immutable; the production compose stack indexed it from the deploy block with lag 0 |

History: v0 `0x125c...e31d` (`deployments/arc-testnet-v0.json`), v1 `0xB927...E9cb` (`deployments/arc-testnet-previous.json`), v2 current (`deployments/arc-testnet.json`). Both earlier contracts are unused. The real-chain end-to-end script (`scripts/testnet_e2e.py`) needs the deployer to hold `MARKET_MANAGER`; on v2 the owner wallet would have to grant it first, so it was not run against v2. The same flows ran on the local chain (UI feature test, 24 flows). Switching a running server is a configuration change: set `EXCHANGE_ADDRESS` and `EXCHANGE_DEPLOY_BLOCK`; the indexer resets itself (RUNBOOK, "Moving to a new contract deployment").

## Known limits of v2

* Settlement still needs a manager to open it; a late TGE is handled with `extendSettlement` (at most 30 days after opening).
* A fee-on-transfer, rebasing or freezable token can still make delivery fail (`DeliveryNotVerified`); the dashboard's token check does not detect behaviour, only metadata.
* An on-chain `tgeTime` was left out on purpose: TGE dates slip, and enforcing one would need an override path that adds more risk than it removes. The date is off-chain and drives alerts (see Phase 1).
* An independent audit and legal review are still required before mainnet.
