# 07. Database, backend and security

Audit date: 2026-11-21, commit `f6e4da8`. Read-only. Environment variables are named, never valued. Status labels are defined in `13-evidence-and-information-gaps.md`. Severity is for a mainnet launch with real funds and is this author's opinion, not an independent assessment.

## 1. Data model (PostgreSQL 16, SQLAlchemy 2, 3 Alembic migrations)

Source: `backend/app/models.py` (17 tables, lines 60 to 319), `backend/alembic/versions/0001_initial.py`, `0002_widen_role_columns.py`, `0003_project_tge_tbd.py`.

| Group | Table | Purpose | Key constraints | Rebuildable from the chain? |
|---|---|---|---|---|
| Identity | `users` | Wallet addresses seen (first and last seen) | unique `address` | No (operational) |
| | `admin_roles` | Admin rows (one level: any row means admin) | unique `(address, role)` | No |
| | `auth_nonces` | Single-use login nonces | PK `nonce`; `used`, `expires_at` | No (transient). Rows are never purged (repository audit L-1) |
| Listings | `projects` | Project record: name, token, category, links, supply and allocation text, TGE date or `tge_tbd`, token address, evidence, team wallet, review note, status | unique `slug` | **No** (editorial) |
| | `project_status_history` | Status transitions with actor and reason | FK to `projects` | No |
| | `verification_badges` | `verified_project`, `contract_verified`, `allocation_verified`, with expiry and revocation | FK | No |
| | `listing_requests` | Community requests (Open, Under Review, Declined, Duplicate, Converted) | | No |
| Market mirror | `markets` | Off-chain market draft plus mirror of the on-chain market; `metadata_ref` is `keccak256(slug)`; `delisted` flag is off-chain only | unique `slug`, unique `metadata_ref`, unique `onchain_id` | Partly: on-chain fields yes; draft, delisting and approvals no |
| | `orders`, `trades` | Mirror of on-chain orders and trades (id equals on-chain id) | index `ix_orders_book (market, side, status, price)` | **Yes** (replay) |
| | `chain_events` | Raw decoded events | unique `(tx_hash, log_index)` | Yes |
| | `claimable_credits` | Mirror of `claimable(address)` | PK `address` | Yes |
| | `indexer_state` | Chain id, contract address, last block, head | one row | Yes |
| Support | `notifications` | Per-address notices with a unique `dedupe_key` | | Partly |
| | `disputes` | Off-chain tickets ("can never move funds") | index on `trade_id` (no foreign key) | No |
| Governance | `audit_logs` | Actor, role, action, entity, before and after | **append-only at database level**: trigger `audit_logs_no_change` blocks UPDATE and DELETE (`0001_initial.py` lines 277 to 288) | No |
| | `settings` | Key-value settings edited from the dashboard | PK `key` | No |

Observations:

* **Money amounts** use a custom `Uint` type for 256-bit-safe integers; the API returns amounts as strings (for example `"volume_total":"36500000"`). Status: IMPLEMENTED.
* **Reset behaviour** (`worker.py` `_reset_for_new_contract` line 108): on a contract address change the indexer deletes events, orders, trades, claimable rows, disputes, trade notifications and old-contract markets, returns affected projects to Approved, and keeps projects, requests, users, admins, audit logs and settings. This is why v1 positions did not carry over to v2 (R-8 in `04`). Status: VERIFIED by reading; exercised in practice when v2 replaced v1.
* **Loss exposure:** only the market mirror, orders, trades and claimables can be rebuilt by replay. Projects, badges, requests, disputes, admins, audit logs and settings exist only in PostgreSQL. **No backup or restore procedure is documented** (a search of `docs/RUNBOOK.md`, `docs/OPERATIONS-PHASE-1.md` and `README.md` for backup, dump and restore found nothing). Status: MISSING.

## 2. API surface (FastAPI 0.115, prefix `/api`)

| Router | Routes (count) | Auth | Notes |
|---|---|---|---|
| `public.py` | `/config`, `/livez`, `/health`, `/markets`, `/stats`, `/trades/recent`, `/projects/upcoming`, `/markets/{key}` (+ `/orderbook`, `/match-plan`, `/trades`, `/stats`), `/portfolio/{address}/orders|trades|summary|positions` (16) | none | Public reads. Portfolio reads are by address, not private on-chain data |
| `auth.py` | `/auth/nonce`, `/auth/verify`, `/auth/me`, `/auth/logout` (4) | nonce and verify rate limited 30 per 60 s per IP | Logout is stateless (L-2) |
| `user.py` | projects (create, update, submit, mine), listing requests, notifications, disputes (13) | JWT; ownership checks (`_mine`, participant check for disputes) | Per-IP limits: project 20 per hour, submit 20 per hour, listing request 30 per hour, dispute 20 per hour |
| `admin.py` | overview, projects (list, get, transition, create, update, delete, badges), listing requests, markets (list, draft, get, verify-config, approve-activation, delist, update, delete), token-check, keeper, attention, settlement, note-action, disputes, users, roles, audit-logs, settings (33) | JWT plus a database role row read **per request** | Revoking an admin takes effect immediately; admin sessions last 2 h, others 12 h |

`/api/docs`, `/api/openapi.json` and `/api/redoc` return 404 on the live site (FastAPI mounts `/docs` and `/openapi.json` at the API's own root, and nginx forwards only `/api/*`; `https://avantdex.xyz/docs` returns the single-page app). The repository audit's note that the API serves docs in production is therefore not exposed through the web container. Status: VERIFIED (live).

## 3. Indexer and chain integrity

* `run_once` (line 142) fetches logs for the contract in batches of `INDEXER_BATCH_BLOCKS` (2000); on a provider range error it retries a quarter of the range.
* `_process` (line 190) sorts logs by `(blockNumber, logIndex)`, skips any `(tx_hash, log_index)` already stored, decodes, stores, calls `_on_<EventName>`, then `_sync` re-reads touched markets, orders, trades and claimables with `call(block_identifier=block)` (lines 369 to 387).
* Failure mode: any exception is logged, the loop sleeps 10 s, and the next pass starts from `last_block` (lines 182 to 184). No data is lost; a stuck RPC shows as growing lag in `/api/health` (`indexer.lag_blocks`).
* Single-writer assumption: one indexer process. Two concurrent indexers are not designed for (UNKNOWN behaviour). Status: IMPLEMENTED.
* Live state: `last_block` equals `chain_head` equals 73,366,759 (lag 0), `migrated: true`, `database: ok` (live `/api/health`, 2026-11-21).

## 4. Authentication and authorization

| Control | Implementation | Evidence | Status |
|---|---|---|---|
| Wallet login | Server issues a single-use nonce and a message; the user signs; the server verifies ECDSA, else ERC-1271 or ERC-6492 through an `eth_call` | `security.py` `issue_nonce` 58, `build_message` 43, `verify_signature` 83, `_smart_wallet_signed` 69; `smart_sig.py` | VERIFIED (18 + 7 recorded tests) |
| Login message | States that it authorizes no transaction | `build_message` | IMPLEMENTED |
| Session | HS256 JWT in `Authorization: Bearer`; 12 h (admin 2 h) | `security.py` `_decode` 137, `create_token` 110 | IMPLEMENTED |
| Secret handling | `JWT_SECRET` has no usable default; in production the API refuses to start if it is shorter than 32 characters; `ENV: production` is set in `docker-compose.yml` | `config.py` line 118; compose line 50 | VERIFIED by reading |
| Admin model | One level. A role row in `admin_roles` (from `BOOTSTRAP_ADMIN_ADDRESSES`, `ADMIN_ROLES`, or the dashboard) grants everything in `/admin`; every admin route depends on `require_roles` / `require_any_admin` | `security.py` lines 160 to 180; `admin.py` | IMPLEMENTED. **Note for reviewers:** there is no separation of duties inside the dashboard; the optional two-person rule for market activation is off by default (`REQUIRE_TWO_PERSON_APPROVAL`) |
| Audit log | `audit(...)` writes actor, role, action, before and after on each admin mutation; append-only trigger | `security.py` 187; migration 0001 | IMPLEMENTED. On-chain actions are logged from a transaction hash the browser reports (M-3) |
| Rate limiting | In-memory deque per `key_prefix:ip`, per API process; disabled when `ENV=test` | `security.py` `rate_limit` 206 | IMPLEMENTED, limited: counters reset on restart and are not shared across processes; the real client address depends on nginx `real_ip` handling (M-1 was fixed and tested with spoofed `X-Forwarded-For`, per `TEST-REPORT.md`) |
| Input validation | Pydantic models with `extra="forbid"` in admin bodies; length limits; https-only URLs; `arc_only` listing rule | `admin.py`, `user.py`, `utils.py` | IMPLEMENTED |
| Session storage in the browser | The token is kept in `sessionStorage` (`src/lib/api.ts` lines 19 to 21), readable by any script on the page | | IMPLEMENTED; see F-3 |

## 5. Security findings (new in this audit unless marked "repository")

| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| **F-1** | **Medium** | **The security headers configured in `nginx.conf` are not delivered.** The server block sets `X-Content-Type-Options`, `Referrer-Policy` and `X-Frame-Options` (lines 25 to 27), but nginx does not inherit `add_header` into a location that defines its own `add_header`, and all three locations (`/api/`, `/assets/`, `/`) do. The live response to `GET https://avantdex.xyz/` carries only `x-content-type-options: nosniff` (plus Cloudflare headers). There is also **no `Content-Security-Policy` and no `Strict-Transport-Security`**. The repository audit (M-4) says nginx sets the other two; that is not what the live response shows | `nginx.conf` lines 25 to 27 versus 44 to 58; live `curl -I` on 2026-11-21 | Repeat the headers inside each location (or use an include), add a strict CSP (self, the RPC host, Circle hosts only when needed) and HSTS (Cloudflare or nginx). Re-check with `curl -I` |
| **F-2** | **Medium** | **Scaffold instrumentation is active in the production bundle.** `src/main.tsx` imports `./tracing` and `./console-capture` first. They patch `globalThis.fetch`, `window.ethereum.request` and `console.*` and `postMessage` the captured events to `window.parent` (target origin from `ancestorOrigins` or `document.referrer`, falling back to `*`). The string `studio-trace-event` is present in the committed bundle `deploy/dist/assets/index-*.js`. Loaded top-level, the messages go to the window itself and are harmless; but with F-1 (the page is frameable) a third-party page could frame the app and receive RPC calls, HTTP traffic and console output. Whether request headers (including the bearer token) are captured was **not verified** | `src/main.tsx` lines 1 to 2; `src/tracing.ts` lines 1 to 10 and 150 to 173; `src/console-capture.ts` lines 1 to 12 and 62, 139; `grep` of `deploy/dist` | Remove both imports from production builds (or gate on a build flag), rebuild, redeploy |
| **F-3** | Medium | **Session token in `sessionStorage`, no CSP.** Any script injection (a dependency or a project logo host; logos load from any https host) can read an admin token valid for 2 hours. The repository audit found no `dangerouslySetInnerHTML` | `src/lib/api.ts` 19 to 21; F-1 | CSP (F-1); consider an HttpOnly cookie with SameSite for the session |
| **F-4** | Medium | **No backup or restore procedure; editorial data is not rebuildable** | section 1; search of the runbook | Scheduled `pg_dump`, tested restore, retention policy; document RPO and RTO |
| **F-5** | Medium | **No continuous integration and no automated dependency or secret scanning** | no `.github/` | A workflow for `forge test`, `pytest`, `tsc`, `oxlint`, plus dependency and secret scanners |
| **F-6** | Low | **Dev credentials are committed in `docker-compose.dev.yml`** (`POSTGRES_PASSWORD` at line 12, `JWT_SECRET` at line 49: dev values in a file labelled dev). `.env`, `.env.coolify` and `.env.production` are git-ignored and no env file other than `.env.example` is tracked. No production secret was found by pattern search of tracked files | `git ls-files`, pattern search (names only) | Keep the dev compose off any public host; add secret scanning to CI |
| **F-7** | Low | **No LICENSE file** at the repository root although the second remote is public; contract header says MIT | repository root | Add the intended license |
| **F-8** | Low | **Hot key in an environment variable** if the keeper is enabled (`KEEPER_PRIVATE_KEY`); the design limits damage (gas only, optional `MARKET_MANAGER` for `completeMarket`) but the key is a plain env secret | `docs/KEEPER.md`; `config.py` | Circle developer-controlled wallet or a secrets manager (see `06`, step 1c) |
| **F-9** | Low | **No metrics, alerting or tracing in the backend.** Logs and the health endpoint only; the admin webhook is optional | `main.py`; `ops.py` | Uptime and lag alerts, error tracking |
| **F-10** | Low | **Single process, in-memory rate limits** | `security.py` | Move counters to PostgreSQL or Redis before running replicas |
| **F-11** | Info | **Dependency pins are exact for the backend; frontend ranges use `^`** with a lockfile (`bun.lock`) | `requirements.txt`, `package.json` | Fine; add automated updates |
| **F-12** | Info | **Wallet coverage:** only injected wallets and the Circle passkey connector are configured in `src/config.ts`; the dialog text names WalletConnect and Coinbase Wallet. Mobile wallets are listed as not covered by tests | `src/config.ts` 17 to 19; `ConnectButton.tsx` 121 | Test, or configure WalletConnect with a project id, or reword the text |

Repository findings that remain open and are carried into this package unchanged (source: `docs/AUDIT-2026-11-ARC-CIRCLE.md`): **H-1** settlement token chosen by one manager signature (mainnet blocker), M-2 Arc-specific behaviour untested, M-3 self-reported on-chain audit entries, M-5 keeper does not claim defaults, M-6 frontend pinned to Arc Testnet, L-1 nonce rows never purged, L-2 stateless logout, L-3 legacy clutter, L-4 no explicit "no receipt" message, L-9 no duplicate guard for disputes. Fixed per that document: M-1 (real visitor address and spoofed `X-Forwarded-For`), H-2 decided as "Arc-only listings".

## 6. Privacy and data handling

* Personal data held: wallet addresses (public), project team text supplied by applicants (names, links, evidence), dispute text. No email, KYC document or government identifier is collected by the code (UNKNOWN for anything collected off-platform).
* No analytics or third-party tracker was found in `index.html` or `src/` by a search for common analytics names (not exhaustive). Project logos load from arbitrary https hosts, which exposes visitor IP addresses to those hosts (M-4 in the repository audit).
* Legal pages are placeholders marked "Draft, not legal advice" (`README.md`). No legal entity, jurisdiction list or compliance status is claimed. Status: MISSING (needs counsel).

## 7. Summary rating (opinion)

| Area | Rating | Reason |
|---|---|---|
| Data integrity (chain mirror) | **Good** | Idempotent, pinned reads, rebuildable |
| Authentication | **Good** | Single-use nonce, smart-account support, production secret guard |
| Authorization | **Adequate** | Role read per request; no separation of duties between admin actions |
| Transport and browser hardening | **Weak (fixable in a day)** | F-1, F-2, F-3 |
| Operations | **Weak** | No backups, no CI, no monitoring beyond health |
| Secrets hygiene | **Good** | Env-based, `.env` ignored, none found in tracked files |
