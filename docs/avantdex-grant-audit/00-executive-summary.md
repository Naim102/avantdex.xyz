# 00. Executive summary: Avantdex Circle Developer Grant audit

Audit date: **2026-11-21**. Repository: `F:\allocx_arc_blockchain_asset_marketplace_uxl9s6`, branch `main`, commit `f6e4da8` (34 commits, 2026-11-01 to 2026-11-18, two git authors). Live site: `https://avantdex.xyz`. Chain: Arc Testnet (5042002). Contract: `AvantdexExchange` v2 at `0xb48935EeA3B7264a53098B1DB920C3fCa09C0283`.

**Method and limits.** Read-only. No source file was modified, no dependency installed, no test or build run, no contract deployed, no transaction sent. Live evidence comes from HTTP GETs to the public site and `eth_call` / `eth_getCode` reads on the public Arc Testnet RPC. No secret value was read or printed (environment variables are reported by name). The only new files are the 14 documents in this folder. Status labels used throughout are defined in `13-evidence-and-information-gaps.md`.

## 1. What Avantdex is

A pre-TGE trading marketplace on Arc. Traders place resting buy and sell orders for tokens that have not launched yet; funds are locked on-chain at placement (buy: value plus a 0.5% fee reserve, sell: collateral equal to the value). A taker supplies maker order ids and fills execute at the maker's price. After the token launches, a manager opens settlement with the token address; the seller delivers atomically (token for USDC, delivery verified by the buyer's balance change) or, after the deadline, the buyer claims payment plus the seller's collateral. Fees are 0.5% per side, in USDC, **only on settled trades**. A FastAPI plus PostgreSQL plus indexer layer provides order books, portfolios, listings and an admin dashboard; a React app provides the interface. Only tokens deployed on Arc can be listed.

## 2. Evidence snapshot

| Item | Value | Source |
|---|---|---|
| Deployed contract | v2, Arc Testnet, 16,175 bytes of runtime code, roles and fee constants as documented, not paused | on-chain reads 2026-11-21 |
| On-chain activity | 4 markets, 15 orders, 4 trades (1 Settled, 1 Refunded, 2 Open); contract holds 84.449 testnet USDC | on-chain reads 2026-11-21 |
| Platform activity (API) | `volume_total` 36.5 USDC, `fees_paid` 0.12 USDC, 4 trades among 4 distinct wallets on 2026-11-10 and 2026-11-17 | `/api/stats`, `/api/trades/recent` |
| Indexer | lag 0 at block 73,366,759 | `/api/health` |
| Tests recorded in repo | `forge` 112 (66 for v2 plus 46 legacy), `pytest` 88, UI feature test 33 steps, Circle provider 12, CCTP unit 9, CCTP fork end-to-end 11, read-only CCTP data check | `docs/TEST-REPORT.md`; counts re-derived from the test files statically; **not re-run in this audit** |
| Audit status | **Not audited.** One internal desk review (`docs/AUDIT-2026-11-ARC-CIRCLE.md`); no independent audit | repository and `/api/config` `"audited": false` |
| Circle in production | **None.** Circle Wallet is off on the live site (`circle_wallet.enabled: false`); the CCTP bridge is testnet-only | live `/api/config` |
| CI | None (no `.github/`) | repository |
| Team and legal entity | **Not documented anywhere in the repository** | repository |

## 3. Grant-readiness verdict

**Conditionally ready. A credible, working testnet product that is not yet submission-ready as a grant package.** It meets the technical part of Circle's stated minimum bar (a working product, a technical roadmap, a Circle integration that can be shown) and is weak on the parts that need the founders: team, traction, budget, legal position.

Mapped to the criteria on `https://www.circle.com/grant` (read 2026-11-21):

| Circle criterion | Assessment | Basis |
|---|---|---|
| **Strong platform alignment** (Arc core to value, liquidity or settlement; Circle products meaningful) | **Adequate, improvable in about 2 days** | USDC-only settlement on Arc Testnet; Arc-only listing; CCTP bridge (testnet); passkey wallet built but disabled on the live site; five of eight `@circle-fin/*` packages are not used by the product (see `06`) |
| **Exceptional teams** (shipping ability, technical ownership) | **Unknown (founder input needed)** | Evidence of shipping is strong (working deployment, 34 commits in 18 days, extensive docs and tests); no team information is in the repository; the code carries AI-assistance and scaffold markers (`src/tracing.ts` "Built with Arc Studio"), so technical ownership must be stated accurately by the founders |
| **Traction and path to success** | **Weak today** | Only testnet activity, 4 trades among 4 wallets, no pilots, partners or revenue evidenced. A credible path exists (roadmap with audit, mainnet, beta targets) but its figures are goals, not results |
| **Ecosystem impact** (expands USDC utility, strengthens Arc) | **Plausible, unproven** | Pre-TGE trading of Arc-deployed tokens would create USDC settlement and liquidity on Arc; no evidence yet of listed external projects |
| **Use-case fit** | **Outside the six listed priority areas; Circle states it also funds strong projects outside them** | The closest listed themes are instant deterministic stablecoin settlement (prediction markets, P2P) and treasury-style escrow |

## 4. Strengths (each backed by evidence in the other documents)

1. **A deployed, exercised contract with a conservative trust model.** No role can reach escrow; every exit stays open when paused; payouts are push-with-fallback; delivery and pulls are balance-delta verified; fees only on settlement (`04`). Settle and refund paths have each executed on Arc Testnet.
2. **Arc-specific engineering that is real, not decorative:** 20 gwei floor, blocklist-safe payouts, USDC 6-decimals-only handling, non-strict timestamps, deterministic-finality indexer (`05`).
3. **A rebuildable, defensive data layer:** idempotent indexer, state re-read pinned to the processed block, automatic reset on contract change, append-only audit log (`07`).
4. **Unusual honesty in the repository:** an internal audit that lists its own open blockers (H-1, H-2), a test report that lists what is not covered, banners that say "testnet" and "not audited" (`08`).
5. **A CCTP bridge built against Circle's own chain data and checked against the real contracts on forks**, including two documented traps in Arc's sample code (the four-argument `depositForBurn` and the wrong `MessageSent` topic) (`06`).

## 5. Gaps that would weigh most with a reviewer (ranked)

| # | Gap | Where | Why it matters |
|---|---|---|---|
| 1 | No independent audit; one EOA holds all three on-chain roles; settlement token chosen by a single manager signature (H-1, **mainnet blocker**) | `04` R-1, R-2 | Circle's roadmap step 03 (audit) and 04 (mainnet) depend on it |
| 2 | No Circle product is running in production; the strongest one (Modular Wallets) is switched off; no complete real CCTP transfer recorded | `06` | The video requirement is easiest to satisfy with these two |
| 3 | No traction evidence, no team section, no budget, no legal entity | `09`, `13` | Needed for "exceptional team" and "traction" |
| 4 | Security hygiene on the live site: the security headers set in `nginx.conf` are **not sent** (nginx `add_header` inheritance; verified on the live response: only `x-content-type-options`), no CSP or HSTS, and scaffold tracing code (`src/tracing.ts`, `console-capture.ts`) is active in the production bundle | `07` F-1, F-2 | Cheap to fix; looks careless in an audit if left |
| 5 | No CI, no LICENSE file on a public repository, legacy contracts and scripts mixed with the shipping code, unused Circle packages | `01`, `07`, `08` | Reviewer first impression and audit scope |
| 6 | Regulatory exposure of pre-TGE token trading is not assessed anywhere; legal pages are marked "Draft, not legal advice" | `09`, `13` | A reviewer from Circle Ventures or a screening step may ask |
| 7 | Mechanism limit: seller collateral equals trade value, so buyer protection holds only up to a 2x price move; no on-chain price priority | `04` R-3, R-7 | Product risk to explain, not hide |

## 6. Pre-submission actions (about one week, no contract change)

1. **Enable Circle Wallet passkey sign-in on the testnet site** (Client Key, Passkey Domain `avantdex.xyz`, run the repository's 5-step checklist). Half a day to one day.
2. **Run and record one complete public-testnet CCTP transfer in each direction** (use Avalanche Fuji or Polygon Amoy to keep waits short). Half a day.
3. **Create a Gas Station policy** limited to the exchange and USDC, then film a first trade with zero USDC for gas. Half a day.
4. Fix the nginx header inheritance, add a CSP and HSTS, remove or gate `tracing.ts` and `console-capture.ts` in production builds, add a LICENSE, add a CI workflow that runs `forge test`, `pytest`, typecheck and lint. One to two days.
5. Remove or integrate the unused `@circle-fin/*` packages and archive the legacy contracts and deploy scripts to a `legacy` branch. Half a day.
6. Founders supply: team and roles, legal entity and jurisdiction, any pilot or partner conversations, budget quotes (audit firm, infrastructure, engineering), and a statement of how the code was produced (see `13`).
7. Record the demo using the script in `12-presentation-demo-script.md`.

## 7. Recommended grant request (proposal, to be confirmed by the founders)

Circle's page says grants run from $10,000 to $100,000 in USDC, most between $10,000 and $20,000, amounts of $25,000 or more need demonstrated traction and a wider scope, and $100,000 is exceptional. With no traction today, the supportable request is the **Lean MVP to Production-ready range (about $10,000 to $25,000)**, tied to milestones: Circle integrations in production on testnet first, then audit funding and mainnet readiness. An "ecosystem expansion" scenario is described in `11-roadmap-milestones-budget.md` only as something to apply for after traction exists. All amounts in this package are proposals, not quotes.

## 8. Document map

| File | Content |
|---|---|
| `01-repository-inventory.md` | Every directory and file group, purpose, importance, inspection status |
| `02-system-architecture.md` | Stack, diagrams, trust boundaries, data flow |
| `03-feature-walkthrough.md` | 14 features end to end, with status and evidence |
| `04-smart-contract-analysis.md` | Functions, roles, escrow math, lifecycles, risk register R-1 to R-13 |
| `05-arc-integration.md` | What is Arc-specific, what is not, hard-wiring |
| `06-circle-integration-audit.md` | Circle product table and the recommended integration roadmap |
| `07-database-backend-security.md` | Data model, API, security findings F-1 to F-12 |
| `08-testing-production-readiness.md` | Test inventory, gaps, readiness checklist |
| `09-product-business-analysis.md` | Users, problem, differentiation, business model, risks, no invented numbers |
| `10-circle-grant-proposal.md` | Application sections A to L |
| `11-roadmap-milestones-budget.md` | 3 and 6 month plans, three budget scenarios, milestones with acceptance criteria |
| `12-presentation-demo-script.md` | 15-slide outline and 3 to 5 minute demo script |
| `13-evidence-and-information-gaps.md` | Status legend, evidence index, claims not to make, founder questions |
