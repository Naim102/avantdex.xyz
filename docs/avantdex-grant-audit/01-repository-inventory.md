# 01. Repository inventory

Audit date: 2026-11-21. Baseline: `main` at commit `f6e4da8` (34 commits, first commit 2026-11-01, last 2026-11-18). Method: read-only. Nothing in the repository was modified, installed, built, deployed or sent to a chain. The only new files are the 14 documents in `docs/avantdex-grant-audit/`.

## How to read the "Inspection status" column

| Status | Meaning |
|---|---|
| **Read in full** | The file was read line by line in this audit. |
| **Read in part** | Key sections, headers, symbols, routes or counts were read in this audit; not every line. |
| **Session-built, re-checked** | The file was written or edited earlier in this project's working sessions and was read then; this audit re-checked it by symbol, route, count or grep extraction, not by a fresh line-by-line read. |
| **Structural only** | Listed and counted. Generated, vendored, binary or build output; not read. |

This audit did **not** re-run any test suite, build or deployment. Test totals quoted in this package come from the repository's own test files (counted statically) and from `docs/TEST-REPORT.md`.

## Coverage summary

| Group | Files | Treatment |
|---|---|---|
| Tracked files in total | 413 | `git ls-files` |
| Vendored `lib/forge-std` | 68 | Structural only |
| Build output `deploy/dist` (prebuilt frontend bundle, committed on purpose) | 97 | Structural only (one grep for instrumentation strings) |
| Screenshots `docs/screenshots` | 34 | Structural only |
| Legacy contracts `contracts/legacy` | 25 | Structural only (not compiled, not used) |
| **Subtotal not read** | **224** | 54% of tracked files, none of them first-party logic |
| **First-party files** | **189** | Listed below; core logic read in full or in part |

First-party size (lines, from `git ls-files`): contract 698; contract tests 1,998 in 4 files (`Avantdex.t.sol` 1,182 lines, legacy `AllocX.t.sol` 698 lines with 46 tests, two mocks); backend app 5,457 in 22 files; backend tests 1,833 in 10 files; Alembic 413; frontend `src/components` 2,611, `src/pages` 3,294, `src/lib` 3,320, `src/hooks` 285 (plus app shell and scaffold files below); scripts 5,371 (of which `compass-deploy.ts` 1,377 and `self-deploy.ts` 875 are legacy); documentation about 1,050 lines in 15 `docs/*.md` files plus `PRD.md` 784, `R&D.md` 630, `project_requirements.md` 1,690.

## Inventory

### Contracts

| Directory / file | Purpose | Importance | Inspection status |
|---|---|---|---|
| `contracts/AvantdexExchange.sol` (698 lines) | The only contract that Avantdex uses: order book, escrow, matching, settlement, fees, roles. Deployed on Arc Testnet as v2. | **Critical** | Read in full |
| `contracts/test/Avantdex.t.sol` (1,182 lines) | Foundry tests for v2: 64 test functions (3 fuzz) plus an invariant contract with 2 invariants and a handler | **Critical** | Read in part (structure and counts) |
| `contracts/test/mocks/` (`MockTokens.sol`, `MockSmartAccount.sol`) | Mock USDC (with a blocklist), mock project tokens, mock smart account | High | Read in part |
| `contracts/test/AllocX.t.sol` | 46 tests for the legacy AllocX contracts (counted in the "112 passed" total) | Low (legacy) | Read in part (count only) |
| `contracts/AllocXEscrow.sol`, `AllocXMarketplace.sol`, `AllocXTransfer.sol` | Legacy v1 marketplace (earlier product). "Still deployed, not used by Avantdex" per `README.md`. | Low | Read in part (headers) |
| `contracts/script/Create2Factory.sol`, `DeployCreate2.s.sol` | Legacy deploy helpers | Low | Structural only |
| `contracts/contract-metadata/AllocXMarketplace.json` | Legacy verification metadata | Low | Structural only |
| `contracts/legacy/` (25 files) | Earlier 10-module design, skipped by `foundry.toml` | None | Structural only |
| `foundry.toml`, `remappings.txt`, `.foundry-version` (`v1.7.1`) | Build config: solc 0.8.28, evm `cancun`, optimizer 200 runs | Medium | Read in full |
| `lib/forge-std` (68 files) | Vendored test library | None | Structural only |

### Backend (`backend/`)

| Directory / file | Purpose | Importance | Inspection status |
|---|---|---|---|
| `backend/app/main.py` | FastAPI app, routers, start-up | High | Session-built, re-checked |
| `backend/app/config.py` | All settings from environment variables (names only reported; values never printed) | High | Read in part |
| `backend/app/models.py` (17 tables) | SQLAlchemy models | High | Read in part (table list) |
| `backend/app/db.py`, `runtime.py`, `utils.py` | DB session, runtime helpers, the Arc-only listing rule `arc_chain` | Medium | Session-built, re-checked |
| `backend/app/security.py` | Wallet-signature login, JWT, role checks, append-only audit, in-memory rate limit | **Critical** | Read in part (symbols) and session-built |
| `backend/app/smart_sig.py` | ERC-1271 / ERC-6492 signature verification via `eth_call` (for Circle smart accounts) | High | Session-built, re-checked |
| `backend/app/chain.py` | web3 client, contract binding, decoders | High | Session-built, re-checked |
| `backend/app/routers/public.py` | Public read API: config, health, markets, order book, match plan, stats, portfolio | **Critical** | Read in part (routes and the order book / match-plan code) |
| `backend/app/routers/auth.py` | Nonce, verify, me, logout | High | Read in part (routes) |
| `backend/app/routers/user.py` | Project submissions, listing requests, notifications, disputes | High | Read in part (routes) |
| `backend/app/routers/admin.py` | Admin: projects, markets (draft, verify, approve, delist), token check, attention list, keeper status, roles, audit logs, settings | **Critical** | Read in part (lines 325 to 455 and all routes) |
| `backend/app/indexer/worker.py`, `run.py` | Event indexer: copies contract events into PostgreSQL, re-reads state pinned to the processed block, resets itself when the contract address changes | **Critical** | Read in part (lines 100 to 400 in full) |
| `backend/app/keeper.py`, `keeper_run.py` | Optional keeper: expire orders, refund cancelled or abandoned markets, optionally complete markets. Off by default. | Medium | Read in part (symbols, `docs/KEEPER.md`) |
| `backend/app/ops.py` | Token pre-flight, "needs attention" list, deadline reminders, admin webhook | Medium | Read in part (header, `check_token`) |
| `backend/app/abi/` | Contract ABI JSON | Medium | Structural only |
| `backend/alembic/` (`0001_initial`, `0002_widen_role_columns`, `0003_project_tge_tbd`) | Schema migrations | Medium | Read in part (names) |
| `backend/tests/` (8 test files, 88 test functions) | See table in `08-testing-production-readiness.md` | High | Read in part (counted per file) |
| `backend/Dockerfile`, `Dockerfile.dev`, `entrypoint.sh`, `requirements*.txt`, `alembic.ini`, `pytest.ini` | Container image (python 3.12-slim, non-root user), pinned dependencies | Medium | Read in full (Dockerfile, requirements) |

### Frontend (`src/`)

| Directory / file | Purpose | Importance | Inspection status |
|---|---|---|---|
| `src/main.tsx`, `App.tsx`, `config.ts`, `index.css`, `vite-env.d.ts`, `connectors-slim.ts` | App shell, routes, wagmi config (Arc Testnet and Ethereum mainnet for ENS), themes | High | Read in full (`main.tsx`, `App.tsx`, `config.ts`, `connectors-slim.ts`) |
| `src/pages/Home.tsx`, `Explore.tsx`, `MarketDetail.tsx`, `Portfolio.tsx`, `Listing.tsx`, `Legal.tsx`, `RoadmapPage.tsx` | Public product pages | High | Session-built, re-checked |
| `src/pages/Bridge.tsx` | CCTP bridge page (lazy chunk): Standard direct flow and Circle Forwarding mode | High | Session-built, re-checked (imports and flow) |
| `src/pages/admin/` (`AdminLayout`, `Projects`, `Markets`, `MarketForm`, `Misc`) | Admin dashboard (12 routes) | High | Session-built, re-checked |
| `src/components/TradePanel.tsx` | Order entry: match plan, approval, `placeOrder` | **Critical** | Read in part (call sites) |
| `src/components/OrderBook.tsx`, `DepthChart.tsx`, `MyOrders.tsx`, `PortfolioOverview.tsx`, `MarketBoard.tsx`, `MarketCard.tsx`, `MarketParts.tsx`, `UpcomingSection.tsx`, `HomeSections.tsx` | Market and portfolio views | High | Session-built, re-checked |
| `src/components/ConnectButton.tsx`, `Header.tsx`, `Footer.tsx`, `BottomNav.tsx`, `Roadmap.tsx` | Connect dialog (Circle Wallet first), navigation, testnet banner, roadmap | Medium | Read in full (`BottomNav.tsx`, `Roadmap.tsx`); the rest session-built, re-checked |
| `src/components/three/`, `CursorFx`, `CountUp`, `Reveal`, `ThemePicker`, `Logo`, `XIcon`, `ui.tsx` | 3D hero (three.js), motion, theme, UI primitives | Low | Structural only |
| `src/hooks/useTx.ts`, `useApp.tsx`, `useNow.ts`, `useTheme.tsx` | Transaction runner (simulate first, 20 gwei floor), auth and config context, clock, theme | High | Read in part (`useTx.ts` lines 1 to 60) |
| `src/lib/exchange.ts`, `exchangeAbi.ts` | Units, fee math, contract error messages, ABI | High | Read in part (exports) |
| `src/lib/api.ts`, `format.ts`, `errors.ts` | API client and types, formatting, error parsing | Medium | Session-built, re-checked |
| `src/lib/cctp.ts`, `bridgeRoutes.ts`, `directBridge.ts` | CCTP V2 messages, Iris client, attestation check, route list, direct transfer | High | Read in full (`bridgeRoutes.ts`); symbols (`cctp.ts`, `directBridge.ts`) |
| `src/lib/circleWallet.ts`, `circleProvider.ts` | Circle Modular Wallets passkey connector and EIP-1193 provider | High | Read in part (symbols, imports, lines 84 to 117) |
| `src/lib/roadmap.ts` | The only place that holds roadmap copy and dates | Low | Read in part (titles, status, dates) |
| `src/onchain-facts.ts`, `onchain-money.ts`, `onchain-wait.ts` | **Generated** by the Arc Studio scaffold ("GENERATED, do not edit"). Registry of Arc chain data, USDC and Circle contract addresses (CCTP, Gateway). Only `src/lib/format.ts` imports `onchain-facts`. | Low | Read in part (headers, Gateway entries) |
| `src/tracing.ts`, `src/console-capture.ts` | **Scaffold instrumentation** imported first in `main.tsx`: patches `fetch`, `window.ethereum.request` and `console`, posts events to the parent frame. See finding F-2 in `07-database-backend-security.md`. | Medium (security hygiene) | Read in part (headers, emit and origin logic) |

### Scripts, deployment, docs

| Directory / file | Purpose | Importance | Inspection status |
|---|---|---|---|
| `docker-compose.yml` (122 lines) | Production stack: `postgres`, `api`, `indexer`, `keeper` (profile), `web` (nginx) | High | Read in part (service list) |
| `docker-compose.external-db.yml`, `docker-compose.dev.yml` | External-database variant (Coolify); local dev stack with a local chain | Medium | Read in part (headers) |
| `nginx.conf` | Serves the prebuilt app, proxies `/api/`, real-IP handling, security headers | High | Read in full |
| `Dockerfile`, `Dockerfile.source` | Static image (nginx + `deploy/dist`); source-build variant | Medium | Read in part |
| `deploy/dist` (97 files) | Prebuilt frontend, committed so the server does not build | High (it is what runs) | Structural only |
| `.env.example` | Variable names and defaults (29 names; values never reproduced here) | High | Read in part (names only) |
| `deployments/arc-testnet.json`, `arc-testnet-previous.json`, `arc-testnet-v0.json` | Deployment records v2, v1, v0 | High | Read in full (v2) |
| `scripts/deploy-testnet.sh`, `deploy-testnet-inner.sh` | Testnet deploy; refuses any chain other than 5042002 | Medium | Read in part |
| `scripts/testnet_e2e.py`, `seed_demo_markets.py` | Real-network end-to-end run; demo market seeding (testnet, labelled demo) | Medium | Read in part (headers, constants) |
| `scripts/test-cctp.mjs`, `test-bridge-fork.mjs`, `verify-cctp.mjs`, `test-circle-provider.mjs`, `ui-feature-test.mjs` | CCTP unit, fork end-to-end, read-only data check; Circle provider unit; UI test (headless Chrome) | High | Read in part (`docs/TEST-REPORT.md`, `docs/CCTP.md`) |
| `scripts/compass-deploy.ts`, `self-deploy.ts`, `compass-deploy-helpers.ts`, `fetch-abi.ts` | **Legacy** deploy tooling using Circle developer-controlled wallets and Smart Contract Platform SDKs | Low | Read in part (imports) |
| `scripts/build_deck.py`, `scripts/check.sh`, `scripts/dev` | Product-tour deck builder, lint and typecheck runner, dev helper | Low | Read in part |
| `docs/*.md` (15 files) and `docs/Avantdex-product-tour.pptx` | Operations, audit, CCTP, Circle Wallet, indexer, keeper, roadmap, runbook, test report | High (evidence) | Read in full: `TEST-REPORT`, `AUDIT-2026-11-ARC-CIRCLE`, `CIRCLE-WALLET`, `CCTP`, `ROADMAP`, `SETTLEMENT-AUDIT-AND-PLAN` (partly), `KEEPER` (partly); others session-built |
| `README.md`, `AGENTS.md`, `PRD.md`, `R&D.md`, `project_requirements.md` | Product and project documentation | High (claims to check) | Read in part (`README.md`, `AGENTS.md` in full) |
| `package.json`, `bun.lock`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `.oxlintrc.json`, `.bun-version` | Frontend build and dependency configuration | Medium | Read in full (`package.json`) |
| `.gitignore`, `.dockerignore`, `.gitattributes`, `.agents` | Repository hygiene; `.env`, `.env.coolify`, `.env.production` are git-ignored | Medium | Read in part (`.gitignore`) |

### Notable absences (searched, not found)

* No `LICENSE` file at the repository root (the contract has an `SPDX-License-Identifier: MIT` line; the repository has no license text). Matters because the second remote is public.
* No `.github/` directory: no continuous-integration workflow exists. Tests run only by hand.
* No audit report from an independent firm. `docs/AUDIT-2026-11-ARC-CIRCLE.md` states itself to be "a desk review by the project's own tooling, not an independent audit".
* No team, company or legal-entity information anywhere in the repository (only the X account `@AvantDex` and git author handles).
* No coverage report, no gas report, no formal verification, no fuzzing campaign beyond the 3 fuzz tests and 2 invariants.
