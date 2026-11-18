# Test report

Run on 2026-11-10 and again on 2026-11-18 against the local dev stack (anvil with Arc Testnet's chain id, PostgreSQL, API, indexer). Nothing here touched a real network.

| Suite | Result |
|---|---|
| Contracts v2 (`forge test`, unit, fuzz and invariants) | 112 passed |
| Backend (`pytest`, includes chain integration, the keeper, the v2 contract, the portfolio positions endpoint, smart-wallet sign-in, the Circle config, the CCTP API URL and the Arc-only rule, the TBD TGE date and migration 0003) | 88 passed |
| UI feature test (`scripts/ui-feature-test.mjs`, headless Chrome), final run on a fresh stack, includes the attention list, token pre-flight, draft edit/discard, pause, the portfolio token allocation, and (2026-11-18) the testnet notice, the Circle Wallet connect dialog, the roadmap and the bridge | 33 steps, all passed (full run on a fresh stack: 31 first time; the phone-bar step had a test-side check that counted a hidden desktop link and then read the active tab one render too early, and the TBD step timed out once while the machine was short of memory; each passed on rerun after the test was corrected) |
| Circle provider unit test (`node scripts/test-circle-provider.mjs`, fake smart account and bundler) | 12 passed |
| Smart-wallet sign-in (`backend/tests/test_smart_wallet.py`, real ERC-1271 and ERC-6492 accounts on a local chain), Circle config, Arc-only listing rule | 7 + 1 + 1 passed |
| nginx visitor address (spoofed `X-Forwarded-For` through the real `nginx.conf`) | real address passed on |
| CCTP library unit test (`node scripts/test-cctp.mjs`: messages, Iris polling, attestation check, network list) | 9 passed |
| **Direct CCTP transfer against the real contracts** (`node scripts/test-bridge-fork.mjs`: Base Sepolia fork to Ethereum Sepolia fork, approve, burn, polling, attestation check, mint, resume, refusals) | 11 passed |
| CCTP data check (`node scripts/verify-cctp.mjs`, read-only: contracts, every USDC and contract address against Circle's tables, attester keys on chain) | all OK (HyperEVM Testnet excluded because Circle's tables do not list it) |
| Contract v2 on Arc Testnet (`0xb489…0283`): roles, fee constants, runtime code vs local build, and the production compose stack indexing it with lag 0 | verified |
| Typecheck (`tsc`) and lint (`oxlint --type-aware`) | clean |

## UI feature test, step by step

**Public:** home loads with the market board, ledger and both 3D canvases and no page errors; home search leads to Explore with the query applied; Explore tabs, category filter and cards view; market page stats, depth chart and all four tabs; legal and listing pages and the 404 state; both themes (Sky and Ink) switch and are remembered.

**Trader wallet:** connect and sign in; place a limit buy (USDC approval then order) and see it in the portfolio; cancel it (status Cancelled); market buy (immediate-or-cancel) fills against resting sell orders; portfolio overview, trade history and settlement tabs; submit a listing request (counted per token).

**Admin wallet:** every dashboard section opens; add a project (appears under Coming soon); edit it; configure a market draft, create it on-chain, verify the configuration, activate it (it appears on the public board); hide the market from the site and show it again; delete a project that has no market; grant the on-chain manager role to another wallet; add a second admin and remove it.

**Settlement:** open settlement on a market, the seller approves the token and settles, the trade shows Settled and the fee collector total rises; on another market the seller does not deliver, the chain clock is moved past the deadline, and the buyer claims the default (status Defaulted).

**Project application TGE date (2026-11-18):** ticking "TBD (to be determined)" clears and locks the date field, the draft is saved with `tge_tbd` true and no date, and editing it again shows the box ticked; unticking frees the date.

**Circle Wallet and Arc only (2026-11-18):** without a Client Key the card says passkey sign-in is not set up and hides the buttons; with a (dummy) key it shows Sign in with passkey and Create (Create stays disabled until a valid username), loads the Circle SDK, contacts Circle and explains the rejected key in plain words, and the dialog stays open with another wallet one click away; a remembered passkey record is retried after a reload and a failure leaves the visitor signed out; the listing form shows Arc as a fixed value, the API answers `arc_only` for another chain, and the listing policy page says so.

**Site additions (2026-11-18):** the testnet banner, header tag, hero chip and footer line; the connect dialog shows the Circle Wallet recommendation and still reaches the wallet list; the roadmap has seven boxes with the right dates and two completed, on Home and on `/roadmap`, expanded on the page, linked from the footer; the bridge validates the amount (minimum, number format), shows a live Circle fee quote for Arc to Ethereum Sepolia, enables the button, and keeps the wrong-network banner hidden.

**Phone width (375 px):** a header of at most 52 px with no menu button; a fixed bottom bar with Home, Explore, Portfolio, Bridge and List that navigates, marks the current page and leaves the footer clear; no bottom bar on desktop; home, explore, market, listing, roadmap and bridge pages have no sideways overflow.

## Not covered

The CCTP burn and mint transactions (they need public-testnet funds; see [CCTP.md](CCTP.md)), a real Circle passkey registration and login (needs the operator's Client Key and the registered Passkey Domain; acceptance checklist in [CIRCLE-WALLET.md](CIRCLE-WALLET.md)), real-network behaviour (the same flows were run on Arc Testnet earlier with `scripts/testnet_e2e.py`), mobile wallets, and a cold start of the production Docker images on Coolify.
