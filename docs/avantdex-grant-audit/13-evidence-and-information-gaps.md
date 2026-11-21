# 13. Evidence, claims to avoid, and information gaps

Audit date: 2026-11-21, commit `f6e4da8`. This document lets a reader check every important claim in the package, lists what must not be claimed, and lists what only the founders can supply.

## 1. Status legend used in documents 00 to 12

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed by evidence this audit could check: a read-only live API or chain read, a static count from the repository, or a recorded test result in `docs/TEST-REPORT.md` that matches the test files. "Recorded" results were **not re-run** here |
| **IMPLEMENTED** | Code exists and reads as complete; not independently exercised by this audit |
| **PARTIAL** | Some of the path is built or verified; named parts are not |
| **PLANNED** | Described in a roadmap or plan; no code |
| **MISSING** | Searched for and not found, and needed |
| **UNKNOWN** | The repository cannot answer; founder input or external research needed |

## 2. Evidence index

### 2.1 Live reads made in this audit (public, read-only, 2026-11-21)

| Claim | Evidence | How to reproduce |
|---|---|---|
| Site and API are up; indexer is at the chain head | `/api/health`: `status ok`, `database ok`, `migrated true`, `last_block` 73,366,759 = `chain_head`, `lag_blocks` 0 | `curl https://avantdex.xyz/api/health` |
| Runtime config: chain 5042002, USDC address and 6 decimals, exchange address, fee collector, fees 50 and 50 bps, `audited: false`, Circle Wallet disabled, CCTP sandbox API | `/api/config` | `curl https://avantdex.xyz/api/config` |
| Platform stats: `markets_live` 2, `markets_total` 4, `projects_upcoming` 1, `open_orders` 6, `bid_depth` 24000000, `ask_depth` 20400000, `volume_total` 36500000, `open_interest` 14000000, `trades_total` 4, `trades_settled` 1, `fees_paid` 120000 | `/api/stats` | `curl https://avantdex.xyz/api/stats` |
| Four trades, four distinct wallets, dates 2026-11-10 and 2026-11-17 | `/api/trades/recent` | `curl https://avantdex.xyz/api/trades/recent` |
| Market states: Live, SettlementOpen, Cancelled x2 | `/api/markets` | `curl https://avantdex.xyz/api/markets` |
| Security headers: only `x-content-type-options: nosniff`; no frame, referrer, CSP or HSTS headers | response to `curl -I https://avantdex.xyz/` | `curl -I https://avantdex.xyz/` |
| `/api/docs`, `/api/openapi.json`, `/api/redoc` return 404 | HTTP status | `curl -s -o /dev/null -w '%{http_code}' https://avantdex.xyz/api/docs` |

### 2.2 Chain reads made in this audit (Arc Testnet RPC `https://rpc.testnet.arc.io`)

| Claim | Evidence |
|---|---|
| Chain id 5042002 | `eth_chainId` returned `0x4cef52` |
| Contract exists, 16,175 bytes of runtime code | `eth_getCode` at `0xb48935EeA3B7264a53098B1DB920C3fCa09C0283` |
| `usdc()` = `0x3600...0000`; `feeCollector()` = `0x136a...Ebd6`; `BUYER_FEE_BPS` 50; `SELLER_FEE_BPS` 50; `paused()` false | `eth_call` reads |
| `marketCount` 4, `orderCount` 15, `tradeCount` 4 | `eth_call` reads |
| Admin wallet `0x3788...9baE9` holds `DEFAULT_ADMIN_ROLE`, `MARKET_MANAGER_ROLE`, `PAUSER_ROLE`; testnet deployer `0xd6ac...65dC` holds no default admin role | `hasRole` reads |
| Contract holds 84.449 USDC (testnet) | USDC `balanceOf(exchange)` |
| Trade 1 Refunded (10.5 USDC, fees 52500 each, market 2 Cancelled); trade 2 Settled (12.0 USDC, fees 60000 each, market 3 SettlementOpen); trades 3 and 4 Open (9.0 and 5.0 USDC, market 4 Live) | `getTrade`, `getMarket` reads |
| `TradeSettled` for trade 2 emitted at block 71,729,618 in transaction `0x8f649c185a0e9f09d3fdb3b173792e70df255b20f80bc68382c1d3b796763f2a` (matches the API's closing hash) | `eth_getLogs` around the trade's timestamp. **Note:** the public RPC returned `null` for `eth_getTransactionReceipt` on this older transaction (and on the two others tried), so a receipt-level check should use the Arc explorer |
| The settlement token of the SettlementOpen market is an ERC-20 named "ARC", symbol "ARC", 18 decimals, 1,000,000 supply | `name`, `symbol`, `decimals`, `totalSupply` reads of `0x8b853a010e0f5645084e3e734c0af5d032a7c400` |

### 2.3 Repository evidence (static)

| Claim | Evidence |
|---|---|
| 413 tracked files; 224 are vendored, generated, screenshots or legacy | `git ls-files` and directory counts (`01`) |
| 34 commits, 2026-11-01 to 2026-11-18, authors `yaminyann` (33) and `Naim Hasan` (1) | `git shortlog`, `git log` |
| Contract is 698 lines, Solidity 0.8.28, 28 errors, 14 events, 11 numeric constants plus two role ids, no `payable`, no `delegatecall`, no `selfdestruct` | read in full |
| 64 test functions (3 fuzz) and 2 invariants for v2; 46 for legacy AllocX; backend 88 test functions in 8 files | static counts; they sum to the recorded 112 and 88 |
| No `.github/`, no `LICENSE`, only `.env.example` tracked among env files | file listing, `git ls-files` |
| 29 environment variable names in `.env.example` | names only; no value was printed |
| Five of eight `@circle-fin/*` packages unused by the product | `package.json` versus imports (`06`) |
| Tracing scaffold in the production bundle | `src/main.tsx` lines 1 to 2; string `studio-trace-event` found in `deploy/dist/assets/index-BQ4iFq5D.js` |
| nginx security headers defined at server level and overridden per location | `nginx.conf` lines 25 to 27 and the three location blocks |

### 2.4 Recorded but not re-run (the repository's own claims)

`docs/TEST-REPORT.md` (2026-11-10 and 2026-11-18): forge 112 passed, pytest 88 passed, UI feature test 33 steps, Circle provider 12, CCTP unit 9, CCTP fork end-to-end 11, `verify-cctp.mjs` all OK, nginx real-address check, runtime code versus local build and a production-compose stack indexing the contract with lag 0. Treat as the project's claim until reproduced.

### 2.5 External source used

* Circle Developer Grants program page, read 2026-11-21: `https://www.circle.com/grant` (funding range, criteria, process, minimum bar, listed focus areas). A web search also returned third-party aggregator summaries; **none of their details were used** where the official page covers the point. Re-read the page and the grants portal before submitting.
* Arc and Circle documentation findings are those recorded in `docs/AUDIT-2026-11-ARC-CIRCLE.md` and `docs/CCTP.md`; this audit did not re-fetch Arc or CCTP documentation.

## 3. Claims that must NOT be made

| Do not claim | Because |
|---|---|
| "Audited", "secure", "safe", "battle-tested" | No independent audit; one internal review; open blockers H-1 and single-EOA control |
| "Live on Arc mainnet" or any mainnet deployment | Only Arc Testnet (5042002); mainnet deliberately not configured |
| Users, volume, TVL, revenue, partnerships, pilots, community size | None evidenced; testnet activity involves 4 wallets; fees were test USDC |
| "Circle Wallet is live" or "passkey login works" | Built and tested with fakes and local accounts; disabled on the live site; never run with a real Client Key |
| "CCTP bridging is proven end to end" | Verified on forks with the test's own attester and read-only on-chain checks; no complete public-testnet transfer recorded |
| Integration with Gateway, Nanopayments, StableFX, EURC, USYC, Circle Mint, developer-controlled or user-controlled wallets, Smart Contract Platform (in the product) | Not present, configuration or legacy scripts only (`06`) |
| "All 112 tests cover the contract" | 66 cover v2; 46 cover retired contracts |
| "The order book enforces price-time priority" | It does not (R-7) |
| "Admins cannot affect users at all" | They cannot move escrow, but they choose the settlement token (R-1), control market status and can redirect future fees |
| "Buyers are fully protected from seller default" | Collateral equals trade value; protection holds up to a 2x price move (R-3) |
| "Security headers are in place" | The live response does not carry them (F-1) |
| Competitor comparisons beyond the repository's single researched competitor | Not researched |
| That the founders wrote or reviewed all code themselves, or the opposite | Unknown; the code shows AI-assistance and scaffold markers; state the facts accurately |

## 4. Inconsistencies found in the repository's own documentation

| Where | Inconsistency | Suggested fix |
|---|---|---|
| `docs/AUDIT-2026-11-ARC-CIRCLE.md` M-4 | Says nginx sets `X-Frame-Options` and `Referrer-Policy`; the live response does not carry them (F-1) | Fix nginx, then re-check with `curl -I` |
| `docs/TEST-REPORT.md` headline "Contracts v2: 112 passed" | 112 includes 46 legacy AllocX tests | State "66 v2 tests plus 46 legacy" |
| `README.md` | Contains two "Deployed on Arc Testnet" sections; one is truncated or older | Merge into one |
| `PRD.md` section 4 | Lists six admin roles; `AGENTS.md` and the code have one admin level | Update the PRD |
| `docs/AUDIT-2026-11-ARC-CIRCLE.md` last test line | Mentions "pytest 76" (earlier run); the current record is 88 | Update |
| `ConnectButton.tsx` line 121 | Names WalletConnect and Coinbase Wallet; `src/config.ts` configures only injected and the Circle connector | Test or reword (F-12) |
| `package.json` | Package name `studio-app`; unused Circle packages | Rename; remove or use packages |
| `src/onchain-facts.ts` | Says "GENERATED, do not edit" by Arc Studio yet is part of the shipped source | Explain or remove if unused |

## 5. Information only the founders can provide

### 5.1 Team and ownership

1. Names, roles, time commitment and links to prior shipped work for each person.
2. Who designed, reviewed and operates the contract, backend and front end; how AI assistance was used; who can be held accountable for each part.
3. Who controls the admin wallet `0x3788...9baE9` and the deployer key, how they are secured, and the plan for a multisig.
4. Advisors, auditors or mentors, if any, with consent to name them.

### 5.2 Entity, legal and compliance

5. Legal entity name, jurisdiction, registration, and who signs the grant agreement.
6. Counsel's view on pre-TGE token trading, KYC and AML, sanctions screening and restricted jurisdictions (`PRD.md` LEGAL-004 is open).
7. Terms, privacy and risk-disclosure texts (the current pages are placeholders).

### 5.3 Traction and market

8. Any pilot, partner or ecosystem conversation: names, dates, status, written evidence.
9. Waitlist, community, interviews, X audience, testnet user counts that are not team wallets.
10. Primary-source research on competitors (fees, volumes, default rates), with dates.
11. First target projects and why they would list; liquidity plan for the first 90 days.

### 5.4 Finance

12. Monthly running costs (hosting, RPC, monitoring, tools) and who pays them.
13. Audit quotes from at least two firms (scope: about 700 lines of Solidity plus deployment configuration), earliest start dates and durations.
14. Engineering cost basis for the grant (rates or days), legal budget, and whether the founders will co-fund the audit.
15. A break-even estimate: settled volume needed for 1% fees to cover costs.

### 5.5 Circle and Arc relationship

16. Whether a Circle Developer Console account exists, and who owns it; permission to create a testnet Client Key and register `avantdex.xyz` as a Passkey Domain.
17. Any existing contact with Circle or Arc teams, and whether Arc mainnet access or ecosystem programs have been discussed.
18. Whether the founders accept the pre-submission actions in `00` section 6 and the code changes they imply (this audit changed nothing).

### 5.6 Product decisions

19. Whether to fix H-1 with a two-step proposal and delay, a project-signed token address, or a multisig with timelock.
20. Whether to raise collateral for volatile tokens or to disclose the 2x bound only.
21. Mainnet go and no-go criteria, and who decides.

## 6. Limits of this audit

* **Read-only.** No test, build, install or deployment was run. Test results are recorded claims, partly corroborated by static counts.
* **Depth.** The contract (698 lines) was read in full. Backend and frontend files were read in part in this audit and otherwise inspected at symbol, route and grep level, supported by earlier work on the same files (`01` states the status of each group). Generated, vendored, build and legacy files were not read.
* **No bytecode comparison** was repeated; only the deployed size, roles and constants were read. The earlier equality result is the project's record.
* **Snapshots.** Live numbers were read on 2026-11-21 (the indexer timestamp in the first health read was 13:43 UTC) and will change.
* **Not covered:** penetration testing, dependency vulnerability scanning, review of OpenZeppelin or Circle SDK internals, performance testing, legal analysis, competitor research, verification of Circle's or Arc's current documentation beyond the grant program page.
* **Opinions** (severity ratings, readiness levels, scenario amounts) are the author's and are labelled as such.
