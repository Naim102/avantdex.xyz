# Admin dashboard

Everything under `/admin`. Code: `src/pages/admin/*`, `backend/app/routers/admin.py`, `backend/app/security.py`.

## Access model

* **One admin level.** Any wallet with an admin row can do everything in the dashboard. Old split role names found in the database or in `ADMIN_ROLES` are accepted and treated as admin. API routes use `require_any_admin`.
* **Ways to become an admin**: `BOOTSTRAP_ADMIN_ADDRESSES` and `ADMIN_ROLES` (applied at every API start; an entry removed from the environment is removed at the next start; the last admin is never removed), or **Admin -> Admins -> Add admin**. The Admins page shows one row per wallet and whether the wallet may start markets.
* **Signing in** is a wallet signature (a message that authorizes no transaction), then a JWT. Every mutation is written to the append-only `audit_logs` (the database rejects updates and deletes). The logged role is the short label `super_admin` (or `keeper` for the keeper).
* **On-chain permissions are separate**, because the contract enforces them: creating, activating, suspending, settling and cancelling markets needs `MARKET_MANAGER_ROLE` on the signing wallet; pausing needs `PAUSER_ROLE`; changing the fee collector needs `DEFAULT_ADMIN_ROLE`. The contract admin wallet gives a wallet market rights from the Admins page: **Add admin** with the "also allow this wallet to create and start markets" box, or **Allow markets** next to an existing admin. Both need the contract admin wallet connected.
* **What no admin can do**: move or redirect escrowed funds. The contract has no such function.

## Sections

| Page | What it is for |
|---|---|
| Overview | Needs attention list ([OPERATIONS-PHASE-1.md](OPERATIONS-PHASE-1.md)), counts, fees collected |
| Applications | review, approve, request changes, reject; **Add a project**, **Edit**, **Delete** (a project with no on-chain market) |
| Verification | badges with evidence and optional expiry |
| Approved Projects | **Configure market** (the draft form) |
| Live Markets / Market Management | create on-chain, verify configuration, approve, activate, suspend, resume, **Hide from site / Show on site** (off-chain visibility only), edit or discard a draft |
| Settlement Management | token pre-flight, open settlement, extend, complete, cancel (first hour only) |
| Disputes | support tickets (they never move funds) |
| Users | wallet list with order and trade counts |
| Admins | admin wallets and market rights |
| Audit Logs | filterable append-only log |
| Settings | platform notice, fee collector, pause / unpause, keeper status |

## Project and market flow

1. A project is submitted by its team (or added by an admin). Approval makes it visible as **Coming soon** (`GET /api/projects/upcoming`); it cannot be traded.
2. An admin configures a market draft. The draft can be edited or discarded until the market exists on-chain.
3. A wallet with `MARKET_MANAGER` creates it on-chain; the indexer binds the on-chain market to the draft through `metadataRef = keccak256(slug)`.
4. **Verify configuration** reads the market back and compares every parameter, including token decimals. A mismatch blocks activation. Optional two-person approval (`REQUIRE_TWO_PERSON_APPROVAL`).
5. **Activate** makes it Live and public. Approval, verification and activation are three separate steps.

## API summary (all require an admin JWT)

| Method and path | Purpose |
|---|---|
| `GET /api/admin/overview`, `/attention`, `/keeper`, `/settings`, `/audit-logs`, `/users`, `/disputes`, `/settlement` | read |
| `POST/PUT/DELETE /api/admin/projects` (`/{id}`) | add, edit, delete a project |
| `POST /api/admin/projects/{id}/transition`, `/badges` | review and badges |
| `POST /api/admin/markets`, `PUT/DELETE /api/admin/markets/{id}` | create, edit and discard a draft |
| `GET /api/admin/markets/{id}/verify-config`, `POST /approve-activation`, `POST /delist`, `POST /note-action` | configuration check, approval, visibility, audit note for wallet-signed actions |
| `GET /api/admin/token-check` | token pre-flight |
| `GET/POST/DELETE /api/admin/roles` | admin wallets (one row per wallet) |
| `PUT /api/admin/settings` | platform notice |

Chain actions (create, activate, settle, pause, role grants) are **signed in the admin's own wallet in the browser**; the API never holds a key. The only key anywhere in the system besides the admin wallets is the optional keeper's ([KEEPER.md](KEEPER.md)).
