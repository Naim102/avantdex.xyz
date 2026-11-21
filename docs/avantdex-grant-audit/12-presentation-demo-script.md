# 12. Presentation outline and demo script

Prepared 2026-11-21. Source material: documents 00 to 11 in this folder. Rule for every slide and every spoken line: say only what the evidence supports; show testnet as testnet; never say "audited", "mainnet", "users" or "volume" for the current state. Items marked `[FOUNDER INPUT]` are left for the presenters.

There is an existing product-tour deck in the repository (`docs/Avantdex-product-tour.pptx`, built by `scripts/build_deck.py` from screenshots in `docs/screenshots/`, captured from a local dev stack with demo data). It is a feature tour, not a grant pitch; the 15 slides below are written for Circle's reviewers.

## 1. Fifteen-slide outline

| # | Slide | Key message | Content | Evidence to show |
|---|---|---|---|---|
| 1 | **Title** | Avantdex: pre-TGE trading on Arc, settled in USDC | Logo, one-line description, "Arc Testnet, not audited" strip, team names `[FOUNDER INPUT]` | `avantdex.xyz` header with the Testnet tag |
| 2 | **The problem** | Before launch, trading is private chats with no enforceable settlement | Four problems: fragmented price discovery, counterparty risk, opaque rules, listing quality | `R&D.md` section 4 |
| 3 | **Why now, why Arc** | Arc is built for USDC settlement: USDC as gas, deterministic finality, CCTP | Three Arc properties and how the design uses each (no reorg logic, blocklist-safe payouts, USDC-only) | `05-arc-integration.md` section 1 |
| 4 | **The solution in one picture** | Lock funds at order time; deliver atomically; pay or refund, no admin path to funds | Lifecycle strip: order, match (escrow `2V + f`), settle or default or refund | `04` section 5 and the three state diagrams |
| 5 | **How a trade settles** | Token for USDC in one transaction, verified by balance change | Sequence diagram of `settleTrade`, `claimDefault`, `refundTrade`; fee only on settle | `03` "Pipeline map" |
| 6 | **Trust model** | No role can move escrowed funds; every exit stays open when paused | Table of roles and what none can do; `invariant_solvency`; push-with-fallback payouts | `04` sections 4 and 8 |
| 7 | **Product tour** | A complete product, not a contract | Four screenshots: market board with depth, trade panel, portfolio, admin settlement | `docs/screenshots/`, live site |
| 8 | **Architecture** | Chain is canonical; everything else is rebuildable | System diagram; indexer pinned reads; Docker on Coolify | `02` sections 3 and 6 |
| 9 | **Circle in the product (today, honest)** | USDC settlement; CCTP bridge (testnet); passkey wallet built, switch-on pending | The status table with Testnet, Configuration only, Not present labels | `06` section 1 |
| 10 | **What we built and verified** | Real chain evidence plus tests | 4 markets, 15 orders, 4 trades on Arc Testnet; 1 settled, 1 refunded; tests: 66 contract, 88 backend, 33 UI steps, CCTP fork 11 | `03` header, `08` section 1 |
| 11 | **What is not done (and when)** | We publish our own blockers | No audit; H-1; single-EOA roles; no complete real CCTP run; no CI | `00` section 5, `04` R-1 to R-3 |
| 12 | **Circle integration roadmap** | Three days of work make Circle products real in production; then deeper integrations | Steps 0a to 1c as a timeline; expansion options greyed | `06` section 3 |
| 13 | **Business model and path to independence** | Fees only on settled trades; 1% of settled value | Fee table; arithmetic example; cost and break-even `[FOUNDER INPUT]` | `09` section 4 |
| 14 | **Milestones and ask** | $20,000 to $25,000 recommended; $10,000 lean option; milestone-based | Milestones M1 to M5 with acceptance criteria and tranche split | `11` sections 6 and 7 |
| 15 | **Team and next steps** | Who we are and what we will ship first | Verifiable team facts only `[FOUNDER INPUT]`; links: site, repo, X, contract on explorer | `10` section L |

Design notes for the deck: use the product's own theme colours and the Archivo and IBM Plex Mono fonts (`README.md` "Interface"); one diagram per slide; no stock claims; put the source file name in the slide footer for every number.

## 2. Demo script (target 4 minutes 30 seconds; limit 5)

Two variants. **Variant 1 can be recorded today.** **Variant 2** adds the Circle Wallet and sponsored-gas segments and requires pre-submission actions P0 (`11` section 3): a Client Key and Passkey Domain, then a Gas Station policy.

### Preparation checklist (do before recording)

* Two browser profiles with two wallets funded with testnet USDC from `faucet.circle.com` (a trader to place and a second to match). Roughly 10 USDC each is enough (the minimum order value is 1 USDC).
* A Live market with an open book: today the live market is "Buraq" (status Live; it has two open trades). Check `/api/stats` for `markets_live` before recording. If none is Live, create one from `/admin` with a funded admin wallet (steps in `docs/RUNBOOK.md` section 4).
* Have these links ready in tabs: the home page, the market page, the portfolio, `/bridge`, the contract on `explorer.testnet.arc.io` (`0xb48935EeA3B7264a53098B1DB920C3fCa09C0283`), and the explorer page of the settled trade's closing transaction `0x8f649c185a0e9f09d3fdb3b173792e70df255b20f80bc68382c1d3b796763f2a` (the `TradeSettled` event for trade 2 is on chain at block 71,729,618; the public RPC did not return the receipt for this older transaction, so check the explorer page in advance).
* For the bridge segment: testnet USDC and a little native gas on a fast source network (Avalanche Fuji or Polygon Amoy attest in about 8 seconds per `docs/CCTP.md`), or use Arc as the source (under a second). Ethereum, Base, Arbitrum and OP take 15 to 19 minutes: do not film those live.
* Close wallet pop-ups that show real balances. Use throw-away testnet wallets only; never show a seed phrase or key.

### Variant 1 timeline (works today)

| Time | Screen | Say | Proof shown |
|---|---|---|---|
| 0:00 to 0:20 | Home page with the Testnet banner | "Avantdex is a pre-launch token marketplace on Arc. USDC is the only money. This is Arc Testnet and the contract is not audited; the site says so on every page." | Banner, header tag, footer |
| 0:20 to 0:50 | Market board, then a market page: order book and depth chart | "Orders live on-chain. Every number you see comes from our indexer, which copies contract events and re-reads state from the chain." | `/api/stats` values match the board |
| 0:50 to 1:40 | Wallet A on a Live market: Place limit sell | "Selling locks collateral equal to the trade value. The fee is 0.5% and is charged only if the trade settles." Click approve (exact amount), then place the order | Wallet prompts; order appears in "My orders" |
| 1:40 to 2:20 | Wallet B: market-style buy that fills against the sell | "The taker fills at the maker's price. The match plan is advisory; the contract validates every maker." | New trade appears; both portfolios update |
| 2:20 to 2:50 | Cancel the remaining order | "Cancelling returns the full lock with no fee, even if the market is paused." | Status Cancelled; balance restored |
| 2:50 to 3:30 | Explorer: the contract, then the `TradeSettled` transaction for trade 2 | "After the token launches the seller settles in one transaction; the buyer's balance change is checked on chain. This trade settled on Arc Testnet; fees were 0.06 plus 0.06 USDC." | Explorer event; `/api/stats` `fees_paid` 120000 |
| 3:30 to 4:15 | `/bridge`: Arc to another testnet, amount 1 USDC, mode "I finish it myself" | "This is Circle CCTP V2: USDC is burned on one chain and minted on the other. We call Circle's contracts and poll Circle's attestation service; we never hold the funds." Show the live Circle fee quote in the other mode | Fee quote; transfer steps; (if recorded) transaction hashes |
| 4:15 to 4:30 | Closing slide | "Everything shown is testnet. Next: switch on passkey wallets, run the bridge on public testnets, fix the settlement-token blocker, audit." | Roadmap link |

### Variant 2 additions (after P0 is done)

| Insert | Where | Say | Proof |
|---|---|---|---|
| Passkey sign-up | before the Wallet A segment | "No seed phrase: the user creates a Circle Wallet with a passkey." Create wallet, show the smart account address | `/api/config` shows `circle_wallet.enabled: true` |
| Zero-gas first trade | in the Wallet A segment | "Circle Gas Station pays the network fee, so a new user does not need USDC for gas." Place a trade from a wallet with no USDC for gas | The sponsored user operation on the explorer |
| One confirmation | same | "Approval and order go in one passkey confirmation." (needs WP4) | One prompt instead of two |
| Complete CCTP transfer | in the bridge segment | Show the transfer reaching "Delivered" with Circle's live attestation | Both transaction hashes |

### Things not to say or show

* "Audited", "secure", "production", "mainnet", "live users", "volume", "TVL", "partners", "regulated".
* Any Circle product that is not running (Gateway, Nanopayments, StableFX, developer-controlled wallets in the product).
* The testnet fee total as revenue.
* Admin-only screens with real wallet addresses of team members unless the founders approve.

### Recording tips

* Use a 1080p screen capture, wallet pop-ups visible, narration over a script, and one retake allowance per segment.
* Add on-screen lower-third captions with the source of each number (for example "Arc Testnet, test USDC").
* End with the contract address and the `/api/health` response on screen.

## 3. Q and A preparation (answers backed by the audit)

| Likely question | Answer, with source |
|---|---|
| Is it audited? | No. One internal desk review (`docs/AUDIT-2026-11-ARC-CIRCLE.md`); an independent audit is milestone M4 |
| What stops an admin from taking funds? | No function reaches escrow; tests and an invariant (`04` section 4). The residual trust point is the settlement token address (R-1), which v3 addresses |
| What if the token never launches? | The market is cancelled and trades refund with no fee; abandoned markets refund 90 days after trading ends (`04` section 6) |
| What if a seller does not deliver? | After the deadline the buyer claims payment plus the seller's collateral; protection holds to a 2x price move (R-3) |
| What if USDC blocks someone? | Payouts fall back to `claimable`; a blocklisted contract address would freeze escrow (R-6) |
| Why Arc? | Settlement layer by design; the code uses USDC-as-gas and deterministic finality; the contract itself is portable EVM (`05`) |
| Where is Circle in production? | Nowhere yet; after M1 on testnet: passkey wallets, Gas Station, CCTP (`06`) |
| Who is the team? | `[FOUNDER INPUT]` |
| Who are your first users or projects? | `[FOUNDER INPUT]`; none are evidenced in the repository |
| Is pre-TGE trading legal? | Not assessed; counsel is part of every budget scenario (`09` section 8) |
