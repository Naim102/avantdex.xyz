# Full audit, round 2: code review against the Arc and Circle documentation

Date: 2026-11-18. Status of what was audited: contract v2 (`0xb48935EeA3B7264a53098B1DB920C3fCa09C0283`), backend, indexer, keeper, frontend, deploy configuration. This is a **desk review by the project's own tooling, not an independent audit**. The contract remains unaudited and testnet only.

Sources read: [Arc docs](https://docs.arc.io/) (EVM differences, USDC system events, gas and fees, contract addresses, RPC endpoints, indexing events, compliance, porting checklist, stablecoin native model), [Arc: bridge USDC with CCTP](https://docs.arc.io/integrate/exchanges/cctp-bridging), [Circle CCTP](https://www.circle.com/cross-chain-transfer-protocol), and Circle's CCTP developer pages (contract interfaces, fees, finality, forwarding service, Ethereum to Arc quickstart).

No code was changed in this round. Fixes and integrations wait for the next instruction.

## 1. What the documentation says that matters for this project

| Topic | Fact (source) | Where it touches Avantdex |
|---|---|---|
| Mainnet exists | Arc mainnet chain id `5042`, RPC `https://rpc.mainnet.arc.io`, explorer `explorer.arc.io`. Testnet `5042002` (RPC docs) | `AGENTS.md` says mainnet is "not configured": still true for our deployment, but the chain itself is live. Switching needs code, not only env (finding M-6). |
| One USDC, two views | Native 18 decimals, ERC-20 6 decimals at `0x3600...0000`, same balance. Never add or mix them; `balanceOf` truncates below 1e-6 (native model) | The contract only uses the ERC-20 view and never touches native value. The frontend reads `balanceOf`. The keeper reads native balance and divides by 1e18, which is the same asset, correct. |
| Value transfer rules | Value to `0x0` reverts, burning reverts, blocklisted sender or receiver reverts, gas is still charged (EVM differences) | `_pay` is push-with-fallback to `claimable`, so a blocklisted recipient cannot block settlement. |
| Blocklist at tx level | A blocklisted **sender** is rejected before the mempool or before execution: no gas, **no receipt** (compliance) | The UI must not wait for a receipt forever (finding L-4). |
| Fee floor | `maxFeePerGas` below 20 gwei is silently dropped (gas and fees) | Frontend `useTx` (floor 20 gwei), keeper (`max(KEEPER_MAX_GAS_GWEI, 20)`) and scripts all comply. |
| Timestamps | Non-decreasing, not strictly increasing; order by block number | Contract compares timestamps only with `<`, `<=`, `>`, `>=` against stored deadlines. The indexer orders by `(blockNumber, logIndex)`. |
| Finality | Deterministic, one confirmation, no reorgs | Indexer has no reorg handling, correct. |
| Events | A USDC ERC-20 transfer emits two `Transfer` logs: the 6-decimal one from `0x3600...` and the 18-decimal one from the system emitter `0xffff...fffE` | We index only our own contract's events, so no double counting. Any future "USDC transfer history" feature must pick one emitter. |
| No beacon randomness | `PREVRANDAO` is `0` | Not used. |
| Tooling | Standard `anvil` does not reproduce Arc behaviour; use Arc Foundry (`arc-forge`, `arc-anvil --network arc`) | Our forge tests run on a standard EVM (finding M-2). |
| Test blocklisted address (testnet) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | This is also the public anvil dev account 1. Anything on testnet that uses the default anvil key 1 is blocklisted. |
| RPC | The primary endpoint is load balanced; a node behind the head returns `-32014`, retry after a short backoff | Indexer handles it (section 3). |
| CCTP on Arc | Domain `26`. Testnet: TokenMessengerV2 `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`, MessageTransmitterV2 `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, TokenMessengerWithFees `0x8745D906D67C346E5eb1aEEED38Eb87F34DF0C0A`. Mainnet: TokenMessengerV2 `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, TokenMessengerWithFees `0x71f54F818671cD0D7ea140Da213e5C8b5C92a408` | Nothing integrated yet. |
| CCTP model | Burn-and-mint of **USDC, EURC and cirBTC** (plus registered third-party tokens). Standard transfers are free, Fast Transfer costs an onchain fee. Arc as a source reaches attestation in about 0.5 s (standard) | Moves USDC to and from Arc. It does **not** move arbitrary project tokens (finding H-2). |
| Hooks and forwarding | `depositForBurnWithHook` runs an action after the mint; the Forwarding Service submits the destination mint for you (hook data starts with `cctp-forward`) | Candidates for "deposit from another chain straight into trading". |
| Other Arc contracts | Gateway (unified balance), Memo, Multicall3From (batch calls keeping `msg.sender`), Permit2, StableFX, USYC | Candidates only. |

**A discrepancy to resolve before integrating CCTP.** The Arc page "Bridge USDC and EURC with CCTP" shows `depositForBurn(amount, destinationDomain, mintRecipient, burnToken)` (four arguments) and polls `iris-api.circle.com/v2/attestations/{messageHash}`. Circle's own CCTP V2 interface lists `depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold)` (seven arguments) and the quickstarts poll `GET /v2/messages/{sourceDomain}?transactionHash=...`. Circle states that V2 is not backwards compatible with V1. Treat Circle's developer pages as authoritative, and verify the ABI on the Arc explorer before writing code.

## 2. Findings

Severity is for a mainnet launch holding real funds. Testnet exposure is lower because the tokens are worthless.

### High

**H-1. Settlement token is still one manager signature (residual of the first audit's H2).** `openSettlement` accepts any contract whose `decimals()` matches, when the market was created without a token address (the normal pre-TGE case). The dashboard pre-flight is advisory only. Concrete abuse: a manager wallet that is also a buyer opens settlement with a token that sellers do not hold. Nobody can deliver, the window expires, and `claimDefault` (open to anyone since v2) pays the buyer payment plus the seller's collateral. `CANCEL_GRACE` (one hour) does not help the sellers because the abuser simply does not cancel. This does not let a role move funds directly, but it breaks the stated guarantee "default only happens when a seller fails to deliver the real token".
*Fix options (contract v3, in order of strength):* (a) a two-step `proposeSettlementToken` then `openSettlement` after a public delay (for example 12 to 24 hours), with sellers able to see the proposed address on chain; (b) token address provided by the project team's registered wallet and confirmed by the manager; (c) `MARKET_MANAGER` held by a multisig with a timelock. Whichever is chosen, a multisig for `DEFAULT_ADMIN` and `MARKET_MANAGER` is a hard requirement for mainnet. Also add the explorer-verified token address to the project record and refuse a mismatch on chain, not only in the UI.

**H-2. Settlement works only for tokens that exist on Arc.** `settleTrade` pulls an `IERC20` from the seller on the same chain. Most pre-TGE tokens launch on other chains, and CCTP cannot carry them (it moves USDC, EURC, cirBTC and registered assets). A market for such a token would end in mass defaults or a cancel. This is an architecture and listing-policy limit, not a bug. *Decide before mainnet:* list only projects that commit to an Arc deployment (verify with a signed message from the team wallet), or design cross-chain settlement (escrow on the token's chain, proof of delivery), which is a large change and a new trust model. Whatever is chosen should be stated on the listing form and the market page.

### Medium

**M-1. Rate limits can be bypassed by a spoofed `X-Forwarded-For` (verified).** The API runs with `--forwarded-allow-ips "*"`. In uvicorn's `ProxyHeadersMiddleware`, when every address is trusted it takes the **first** entry of `X-Forwarded-For`, which the client controls (confirmed by reading the installed source). nginx appends with `$proxy_add_x_forwarded_for` rather than overwriting. A client can therefore rotate the header and reset the `nonce`, `verify`, `project`, `lreq` and `dispute` limits. The per-wallet cap on project creation (5 per hour) is database based and holds.
*Fix:* trust only the proxy hop (set `--forwarded-allow-ips` to the nginx container's network, or in nginx use the `real_ip` module with `set_real_ip_from` and `real_ip_recursive on`, then send `X-Forwarded-For $remote_addr`). Move the counters to the database or Redis if more than one API process is ever run (they are per process now).

**M-2. Arc-specific behaviour is not covered by tests.** Forge runs on a standard EVM with `evm_version = "cancun"`, and the USDC in tests is a mock (`BlocklistUSDC` approximates a reverting transfer). Arc's docs say a standard `anvil` cannot reproduce native/ERC-20 duality, EIP-7708 logs or blocklist enforcement. *Fix:* add an Arc Foundry job (`arc-forge test`, `arc-anvil --network arc`) running the existing suite, plus tests against the real testnet blocklisted address; run the settle, default, refund and withdraw paths with a blocklisted buyer, seller and fee collector.

**M-3. The audit log of on-chain actions is self-reported.** `POST /admin/markets/{id}/note-action` stores whatever transaction hash the admin's browser sends, so the "who did what on chain" trail is not verified. *Fix:* build those entries from indexed `MarketStatusChanged`, `SettlementOpened` and `SettlementExtended` events and the transaction's `from`, which the indexer can read.

**M-4. Browser hardening.** nginx sets `nosniff`, `Referrer-Policy` and `X-Frame-Options` but no `Content-Security-Policy` and no HSTS (the Coolify proxy may add HSTS). The API serves `/docs` and `/openapi.json` in production. Project logos are loaded from any https host, which lets a project operator see visitor IP addresses. Wallet connection and admin actions run in this page, so a CSP is worth the effort. *Fix:* a strict CSP (self, the RPC, WalletConnect hosts), disable the docs routes in production, proxy or restrict logo hosts.

**M-5. Keeper does not claim defaults.** Since v2 anyone can call `claimDefault`; the buyer is paid. The keeper only expires orders, refunds cancelled markets and (optionally) completes markets, so an inactive buyer still blocks `completeMarket`. *Improvement:* add a `claim_default` duty (gas only, money goes to the buyer); simulation already protects against wasted gas.

**M-6. The frontend and scripts are pinned to Arc Testnet.** `useTx.ts` imports `arcTestnet`, `src/config.ts` registers `arcTestnet` and Ethereum mainnet (for ENS), scripts hard-code `5042002`. Moving to Arc mainnet is a code change in several places, not only the env list in `AGENTS.md`. *Fix:* one chain definition driven by `/api/config` (viem ships both `arc` and `arcTestnet`).

### Low and notes

* **L-1.** `auth_nonces` rows are never deleted. Rate limited (30 per minute per IP, bypassable, see M-1), so growth is slow but unbounded. Purge expired rows in the ops job.
* **L-2.** Sessions are stateless JWTs and logout is a no-op. Admin rights are re-read from the database on every request, so removing an admin takes effect immediately; ordinary wallet sessions last 12 hours.
* **L-3.** Repository clutter: legacy `contracts/AllocX*.sol`, `contracts/legacy/`, `scripts/compass-deploy*.ts`, `contracts/script/Create2Factory.sol`, unused `foundry.toml` RPC entries, and `lib/forge-std` vendored into git (68 files). None is deployed. Remove or move to a `legacy` branch before an external audit so reviewers read only what ships. `src/onchain-*.ts` are still imported by `src/lib/format.ts`: check before deleting.
* **L-4.** `waitForTransactionReceipt` has no explicit message for "no receipt". On Arc a transaction below 20 gwei or from a blocklisted sender never appears, so the UI sits in "confirming" until the library timeout. Add a visible timeout with text that names both causes.
* **L-5.** Hook tokens (ERC-777 style) let a buyer contract revert in its receive hook, so the seller can never deliver and defaults. The token pre-flight should flag hook and fee-on-transfer behaviour (it already only reads metadata) and managers should refuse such tokens.
* **L-6.** Funds sent directly to the exchange (ERC-20 transfer, or native value forced in by `SELFDESTRUCT` from another contract, which is the same USDC pool on Arc) are unrecoverable. Accounting is unaffected because every pull uses a before/after balance delta, but users should be told not to send USDC to the contract.
* **L-7.** Circle can blocklist any address, including the exchange contract itself, or pause USDC. All escrow depends on that. This is inherent and should be written in the risk section for users.
* **L-8.** Two approvals plus an order means two transactions per first trade. Options: EIP-2612/3009 signatures if the Arc USDC supports them for our flow, `Multicall3From` batching, or EIP-7702 batching.
* **L-9.** Dispute tickets have no duplicate guard per trade (rate limited, 20 per hour).
* **L-10.** `AGENTS.md` and the docs say "Mainnet is not configured". Keep that as policy, but add that Arc mainnet exists and its addresses are in this document.

## 3. Checked and found sound

* Contract: no `msg.value`, no payable function, no `selfdestruct`, no `prevrandao`, no `delegatecall`; every external call is to USDC or the project token; `nonReentrant` on all state-changing entry points; fee arithmetic (`2v + buyerFee` in equals `2v + buyerFee` out on settle, default and refund; floor rounding keeps fills within the locked reserve); the delivery balance-delta check; the pull balance-delta check; push-with-fallback to `claimable` so a blocklisted buyer, seller or fee collector cannot block anyone else; cancel, expire, refund and withdraw paths stay open when paused.
* Indexer: state is re-read **pinned to the processed block** (`call(block_identifier=block)`), so a lagging node behind Arc's load balancer produces an error and a retry instead of stale data being stored; idempotent by `(tx_hash, log_index)`; no timestamp ordering.
* Backend: every admin route depends on a role check that reads the database per request; user routes verify ownership (`_mine`, trade participant check for disputes); all user URLs are https-only; text is length-limited; the audit table is append-only at the database level; the login message states that it authorizes nothing; nonces are single use; secrets are read from the environment and none are committed (the only private key in the repository is the public anvil test key).
* Frontend: `maxFeePerGas` at least 20 gwei; each call is simulated before the wallet opens; approvals are for the exact amount; success is shown only after a receipt with status success; no `dangerouslySetInnerHTML`; external links use `noopener noreferrer`; the wallet balance comes from `balanceOf` (6 decimals), never from the native balance, so there is no double counting.

Last full test run (earlier this session): forge 112, backend pytest 76, UI flow test 25 of 25. The additions since then (health endpoint, blank environment variables) have their own tests.

## 4. Porting checklist from the Arc docs, applied to the contract

| Step in the Arc checklist | Result |
|---|---|
| 1. Balance and decimal assumptions | Only `usdc.balanceOf` (6 decimals) with delta checks; no `address.balance`. Pass |
| 2. Value transfers | No native sends. Pass |
| 3. Approvals and sweeps | No sweep and no native path; exact allowances in the UI. Pass |
| 4. DEX or AMM porting | Not applicable (order book, no wrapped native token) |
| 5. `SELFDESTRUCT` | Not used. Pass |
| 6. Randomness | Not used. Pass |
| 7. Test on Arc | **Gap**: standard forge only (M-2) |
| 8. Exercise revert paths with the blocklisted test address | **Gap** on the real chain; mock only (M-2) |

## 5. Integration surface available for the next step

Nothing below is built. It is the menu that the documentation supports, with the dependency each one has on the findings above.

| Option | What it gives | Notes |
|---|---|---|
| CCTP deposit into Arc (Bridge Kit or direct, V2, domain 26) | Users fund trading USDC from other chains | Use Circle's V2 signatures (section 1). Standard transfers are free; Fast Transfer costs a fee. Mint goes to the user's wallet, then the normal approve and order flow. |
| CCTP withdrawal out of Arc | Users send USDC to another chain from the portfolio | Source attestation on Arc is about 0.5 s. The user signs the burn; no custody. |
| CCTP hooks and the Forwarding Service | Cross-chain deposit that completes without the user holding gas on Arc | Needs careful design: the exchange has no deposit function (funds are pulled with `transferFrom`), so a hook would target a helper contract or the user's wallet. |
| Gateway or Unified Balance Kit | One USDC balance across chains | Separate product from CCTP; larger UI change. |
| Memo and Multicall3From | Attach order metadata, batch approve plus order keeping `msg.sender` | Needs compliance attribution awareness (Arc compliance page). |
| Arc Foundry in CI | Closes M-2 | No product change. |
| EURC | Euro-priced markets | Needs a second quote token; the contract is USDC only. |
| Mainnet readiness | Chain config driven by API (M-6), multisig and timelock (H-1), external audit, legal review | Phase 4 of the settlement plan. |

H-2 (tokens that live on another chain) is the question that decides how far cross-chain integration should go: CCTP helps funding, not delivery of project tokens.

## 6. Follow-up (2026-11-18)

* The CCTP V2 signature discrepancy in section 1 was **verified on chain** with `scripts/verify-cctp.mjs`: the deployed Arc Testnet token messenger has the seven-argument `depositForBurn` and no four-argument form.
* The CCTP bridge was built on Circle's kit, not on the Arc page's sample code: [CCTP.md](CCTP.md). It does not change H-1, H-2 or any contract; H-2 still decides how far cross-chain integration can go.
* Findings M-6 (testnet pinned) and L-10 (mainnet wording) are unchanged. The site now states clearly that it runs on Arc Testnet: [ROADMAP.md](ROADMAP.md).
* **Decisions (2026-11-18):** H-2 is answered: **only tokens deployed on Arc are listed** (API rule `arc_only`, fixed "Arc" in the forms, listing policy text, FAQ). M-1 is **fixed**: `nginx.conf` now passes the real visitor address (tested with spoofed `X-Forwarded-For` values; see the RUNBOOK). Circle Wallet passkey sign-in was added, which adds an `eth_call`-based signature check to the login endpoint; it is size-capped and covered by tests ([CIRCLE-WALLET.md](CIRCLE-WALLET.md)). H-1 (settlement token chosen by one manager signature) is still open and is a mainnet blocker.
