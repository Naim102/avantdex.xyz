# 08. Testing and production readiness

Audit date: 2026-11-21, commit `f6e4da8`. **No test, build or deployment was run in this audit.** Counts below were derived from the test files by static counting and match the totals recorded in `docs/TEST-REPORT.md` (runs dated 2026-11-10 and 2026-11-18, local dev stack). Everything labelled "recorded" is the repository's own claim; everything labelled "verified today" was read from the live site or chain in this audit.

## 1. Test inventory

| Suite | Location | Count (static) | Recorded result | What it exercises | Needs |
|---|---|---|---|---|---|
| Contract v2: unit, fuzz, invariants | `contracts/test/Avantdex.t.sol` (1,182 lines) | 61 unit + 3 fuzz + 2 invariants = 66 | part of "112 passed" | Roles, market status machine, order validation, maker-price execution, partial fills, IOC, cancel, expiry, settlement, default, refund, v2 behaviours, blocklist cases with a mock USDC, native value rejection, solvency invariant, collector-only-settled-fees invariant | Docker image `ghcr.io/foundry-rs/foundry:v1.7.1` |
| Legacy contract tests | `contracts/test/AllocX.t.sol` (698 lines) | 46 (1 fuzz) | part of "112 passed" | The retired AllocX contracts. **Inflates the headline number**: 66 of the 112 cover the shipping contract | same |
| Backend (pytest) | `backend/tests/` | 88: `test_auth` 18, `test_chain` 12, `test_config` 3, `test_disputes_notifications` 3, `test_markets_api` 10, `test_ops` 7, `test_projects` 28, `test_smart_wallet` 7 | "88 passed" | Auth and roles, chain integration with a local node (indexer, keeper, v2 contract), settings parsing, disputes, API reads, ops, project lifecycle and listing rules, ERC-1271 and ERC-6492 with real account contracts | PostgreSQL plus a local chain (`docs/RUNBOOK.md` "Tests") |
| UI feature test | `scripts/ui-feature-test.mjs` (617 lines) | 33 steps | "all passed" (first full run 31, two test-side issues fixed, rerun passed) | Public pages, trader flow (approve, limit order, cancel, IOC, portfolio, listing request), admin flow (market draft, create on-chain, verify, activate, hide, delete, roles, second admin), settlement (settle and default with the chain clock moved), TBD TGE date, Circle dialog states, roadmap, bridge validation and a live Circle fee quote, 375 px layout | Headless Chrome, local stack, mock wallet on a local chain using Arc's chain id |
| Circle provider unit | `scripts/test-circle-provider.mjs` | 12 | "12 passed" | Provider logic with a fake smart account and fake bundler (user operations, sponsorship fallback, cancelled passkey) | Node |
| CCTP library unit | `scripts/test-cctp.mjs` | 9 | "9 passed" | Message and burn-body parsing, attester addresses, attestation acceptance and refusal, Iris polling, route list | Node |
| CCTP fork end-to-end | `scripts/test-bridge-fork.mjs` | 11 | "11 passed" | The direct transfer against the **real CCTP V2 contracts** on Base Sepolia and Ethereum Sepolia forks, with the test's own attester and a fake Iris | Docker, public RPCs |
| CCTP data check | `scripts/verify-cctp.mjs` | read-only script | "all OK" | Contract addresses, USDC addresses and domains against Circle's tables; attester keys enabled on chain | Network |
| Real-network end-to-end | `scripts/testnet_e2e.py` (191 lines) | 1 script | Ran on Arc Testnet earlier (v1 era); **not recorded against v2** | Full lifecycle with real testnet USDC | Funded wallets |
| nginx visitor-address test | in `docs/RUNBOOK.md` and `TEST-REPORT.md` | manual | "real address passed on" | Spoofed `X-Forwarded-For` through the real `nginx.conf` | Docker |
| Typecheck and lint | `scripts/check.sh` | n/a | "clean" | `tsc` and `oxlint --type-aware` | Bun |

Fuzz and invariant runs use Foundry defaults: `foundry.toml` has no `[fuzz]` or `[invariant]` section.

## 2. What the tests do not cover (the repository states most of these itself)

| Gap | Source | Consequence |
|---|---|---|
| Arc-specific behaviour (native and ERC-20 duality, real blocklist enforcement, system logs) is not reproduced: forge runs a standard EVM (`cancun`) with a mock USDC | repository audit M-2 | Blocklist payout paths are proven against a mock only |
| No Arc Foundry job; no run against Arc's published blocklisted test address | repository audit M-2 | as above |
| A full CCTP transfer on public testnets with Circle's live signatures | `TEST-REPORT.md` "Not covered"; `docs/CCTP.md` | The bridge is verified up to everything except Circle's real signing |
| A real Circle passkey registration and login | `TEST-REPORT.md`; `docs/CIRCLE-WALLET.md` checklist | Circle Wallet acceptance test pending |
| Mobile wallets | `TEST-REPORT.md` | WalletConnect path unknown (F-12) |
| Cold start of the production Docker images on Coolify | `TEST-REPORT.md` | Deploy has failed before for configuration reasons (commits `0f367fd`, `5cd13b4`) and was fixed |
| The default-claim path and the keeper on the real chain | on-chain reads today: no Defaulted trade; keeper not evidenced as running | Tested locally only |
| Frontend unit or component tests | none exist; the UI test is one end-to-end script | Regression risk when the interface changes |
| Load, soak and RPC-failure tests | none | Capacity is UNKNOWN |
| Independent security testing (audit, penetration test, bug bounty) | none | See `04` and `07` |
| Test coverage report, mutation testing, formal verification | none | |
| CI | no `.github/` | Tests depend on someone running them |

## 3. Deployment and operations evidence

| Item | Evidence | Status |
|---|---|---|
| Live site | `https://avantdex.xyz` returned 200 on 2026-11-21; Cloudflare in front | VERIFIED |
| Health | `/api/health`: `status ok`, `database ok`, `migrated true`, indexer lag 0; `/api/livez` GET 200 (HEAD returns 405 by design) | VERIFIED |
| Frontend delivery | Prebuilt `deploy/dist` committed; the server never builds; live `last-modified` 2026-11-18 16:50:45 GMT | VERIFIED. Rollback means redeploying an older commit |
| Containers | `postgres`, `api`, `indexer`, `web` always; `keeper` only with compose profile and `KEEPER_ENABLED`; restart policy `unless-stopped`; healthchecks on postgres, api and web; API image runs as a non-root user | IMPLEMENTED |
| Migrations | Run by the app in the background at start-up (`backend/entrypoint.sh`); the API stays reachable and reports a database problem on `/api/health` | IMPLEMENTED. Schema changes ship with the code; there is no separate migration gate or rollback script |
| Configuration | Environment variables (29 names in `.env.example`); runtime values to the browser via `/api/config`; blank variables mean "use the default" (`env_ignore_empty`) | IMPLEMENTED |
| Runbook | `docs/RUNBOOK.md` (166 lines): wallet, deploy, Coolify, new contract, Circle credentials, first market, demo markets, e2e, mainnet steps, tests, operations, keeper, rate limits, deploy failure | IMPLEMENTED. No backup, restore, incident or on-call section |
| Monitoring | Health endpoints; optional admin webhook with a "needs attention" summary; admin keeper status | PARTIAL. No metrics or external alerting evidenced |
| Disaster recovery | Chain mirror replays; editorial data does not | PARTIAL (F-4) |

## 4. Production-readiness checklist

Scale: **Ready** (can run in production as is), **Testnet-ready** (fine for the current testnet beta, not for real funds), **Not ready**, **Unknown**.

| Area | Level | Note |
|---|---|---|
| Contract correctness (own tests) | Testnet-ready | 66 tests including fuzz and invariants; Arc-specific gaps (R-12) |
| Independent contract audit | **Not ready** | None; roadmap step 03 (target 28 February 2027) |
| Contract governance (multisig, timelock, key custody) | **Not ready** | One EOA holds all roles (R-2) |
| Settlement token safety (H-1) | **Not ready** | Mainnet blocker per the repository's own audit |
| Mechanism design for volatile tokens | Testnet-ready | R-3, R-7 should be disclosed |
| Backend and indexer correctness | Testnet-ready | 88 tests, pinned reads, idempotent, auto-reset |
| API security and browser hardening | **Not ready** | F-1, F-2, F-3 (fixable in about a day) |
| Data protection and backups | **Not ready** | F-4 |
| CI/CD | **Not ready** | F-5 |
| Observability and alerting | Testnet-ready | Health plus webhook only |
| Performance and capacity | Unknown | No load test; matching is on-chain (50-maker cap), reads are indexed SQL |
| Wallet and onboarding UX | Testnet-ready | Injected wallets plus optional passkey; two transactions for a first trade; mobile wallets untested |
| Circle integrations | Testnet-ready | CCTP bridge (testnet), passkey wallet built but off |
| Legal, regulatory, terms of service | **Not ready** | Placeholders marked "Draft, not legal advice"; pre-TGE token trading may be regulated; counsel needed |
| Support and dispute handling | Testnet-ready | Off-chain tickets cannot change on-chain outcomes; no staffing evidenced |
| Mainnet configuration | **Not ready** | Pinned to Arc Testnet in several files (M-6) |
| Licensing and repository hygiene | **Not ready** | No LICENSE, legacy code in tree, unused packages |
| Documentation | **Ready** (for a testnet project) | 15 docs plus PRD and R&D; matches the code where this audit checked it, except the nginx header claim (F-1) |

## 5. Blockers by horizon

* **Before submitting the grant (about one week, no contract change):** Circle Wallet on, one real CCTP run, Gas Station policy, nginx headers and CSP, remove tracing scaffold from production, LICENSE, CI, dependency cleanup, backup script.
* **Before any real funds (the grant's audit and mainnet milestones):** independent audit; fix H-1; multisig plus timelock for admin and manager; mainnet chain configuration; legal review and terms; monitoring and backups; a documented incident plan; Arc Foundry tests and a real-blocklist test run.
* **Before scale:** shared rate limiter, a read replica or cache if needed, load tests, formal support process, bug bounty.
