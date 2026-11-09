# Test report

Run on 2026-11-10 against the local dev stack (anvil with Arc Testnet's chain id, PostgreSQL, API, indexer). Nothing here touched a real network.

| Suite | Result |
|---|---|
| Contracts (`forge test`, unit, fuzz and invariants) | 104 passed |
| Backend (`pytest`, includes chain integration) | 58 passed |
| UI feature test (`scripts/ui-feature-test.mjs`, headless Chrome), run again after the soft redesign | 23 of 23 passed |
| Typecheck (`tsc`) and lint (`oxlint --type-aware`) | clean |

## UI feature test, step by step

**Public:** home loads with the market board, ledger and both 3D canvases and no page errors; home search leads to Explore with the query applied; Explore tabs, category filter and cards view; market page stats, depth chart and all four tabs; legal and listing pages and the 404 state; all five themes switch and are remembered.

**Trader wallet:** connect and sign in; place a limit buy (USDC approval then order) and see it in the portfolio; cancel it (status Cancelled); market buy (immediate-or-cancel) fills against resting sell orders; portfolio overview, trade history and settlement tabs; submit a listing request (counted per token).

**Admin wallet:** every dashboard section opens; add a project (appears under Coming soon); edit it; configure a market draft, create it on-chain, verify the configuration, activate it (it appears on the public board); hide the market from the site and show it again; delete a project that has no market; grant the on-chain manager role to another wallet; add a second admin and remove it.

**Settlement:** open settlement on a market, the seller approves the token and settles, the trade shows Settled and the fee collector total rises; on another market the seller does not deliver, the chain clock is moved past the deadline, and the buyer claims the default (status Defaulted).

**Phone width (375 px):** home, explore, market and listing pages have no sideways overflow.

## Not covered

Real-network behaviour (the same flows were run on Arc Testnet earlier with `scripts/testnet_e2e.py`), mobile wallets, and a cold start of the production Docker images on Coolify.
