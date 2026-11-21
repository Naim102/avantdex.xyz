"""Speaker notes (also embedded in the PPTX), the 5-minute script, the 3-minute demo script and reviewer Q and A.

Every statement is backed by one of the audit documents in docs/avantdex-grant-audit/ (cited as "doc NN").
"""

from __future__ import annotations

NOTES: dict[int, str] = {
    1: """MESSAGE: AvantDex is a pre-launch trading venue on Arc that holds funds in USDC escrow. It is a testnet product and it is not audited.
SAY: "We are AvantDex. We built an on-chain order book for tokens that have not launched yet. Today it runs on Arc Testnet, and we will be clear throughout about what is verified, what is testnet, and what is still to do."
EVIDENCE: Site banner on every page says Arc Testnet and not audited (doc 03 F14, doc 08). Data in this deck is a snapshot dated 21 November 2026.
REVIEWER MAY ASK: Is it live? Answer: live on Arc Testnet at avantdex.xyz; not on mainnet; not audited (doc 00).""",
    2: """MESSAGE: Pre-launch trading today has no enforceable settlement.
SAY: "Before a token launches, people trade allocations in private chats and spreadsheets. Four things go wrong: prices are scattered, a seller can vanish or a buyer can refuse to pay, nobody can see who holds the funds or what happens if the launch is cancelled, and anyone can claim a token will exist."
EVIDENCE: R&D.md section 4 and doc 09 section 2. We do not quote market-size or volume statistics: the project did not collect them from primary sources (doc 09).
REVIEWER MAY ASK: How big is the market? Answer: not estimated; we will add first-party evidence (founder input) rather than guess.""",
    3: """MESSAGE: Lock both sides in USDC; release funds by rule.
SAY: "AvantDex lists a project, then a market opens. Buyers and sellers post orders and funds are locked at placement: the buyer locks the price plus a half-percent fee reserve, the seller locks collateral equal to the trade value. A trade holds 2V plus f. After the launch there is exactly one exit: settle, default or refund."
EVIDENCE: AvantdexExchange.sol placeOrder, _match, settleTrade, claimDefault, refundTrade (doc 04 sections 3 and 5).
REVIEWER MAY ASK: Who can move the funds? Answer: no role can; users keep cancel, settle, default and refund paths even when paused (doc 04 section 4).""",
    4: """MESSAGE: This is a complete product, not only a contract.
SAY: "Here is the product. A trader explores a market, opens it, reads the order book, approves USDC and places an order. The first two screens are the live site captured on 21 November. The trade panel is from our local dev stack with demo data, labelled as such."
EVIDENCE: Live screenshots from avantdex.xyz (2x capture, 21 Nov 2026); docs/screenshots/14 for the trade panel (demo data, earlier theme). Features F2 and F3 in doc 03.
REVIEWER MAY ASK: Is the trade panel screenshot live? Answer: no, it is the local dev stack; we label it. The live trade panel needs a connected wallet, which we show in the demo.""",
    5: """MESSAGE: The whole lifecycle has run on Arc Testnet.
SAY: "On 21 November the contract showed 4 markets, 15 orders and 4 trades. One trade settled, one was refunded, two are open. We verified the settlement event on chain at block 71,729,618. These are testnet numbers from four wallets. We show them as proof that the mechanism works, not as users or volume."
EVIDENCE: On-chain reads of marketCount, orderCount, tradeCount, getTrade; TradeSettled log in tx 0x8f64...3f2a at block 71,729,618; API /api/stats (doc 13 section 2). Fees 0.06 + 0.06 USDC on the settled trade. The default-claim path has not been observed on the real chain (doc 03 F7).
REVIEWER MAY ASK: Who traded? Answer: four distinct addresses, consistent with team and test activity; we claim no external users.""",
    6: """MESSAGE: One trade, from lock to exit.
SAY: "Both sides lock funds. A taker names resting orders and the contract fills them at the maker's price, escrowing 2V plus f. After the launch a manager opens settlement. The seller approves the token and settles, or after the deadline the buyer claims the default, or if the market is cancelled both sides are refunded. An indexer copies every event into PostgreSQL for the interface."
EVIDENCE: settleTrade line 479, claimDefault 509, refundTrade 525, cancelMarket 328 (doc 04 section 3). Indexer: worker.py _process and _sync (doc 02, doc 07 section 3).
REVIEWER MAY ASK: Who calls settle? Answer: anyone may call it, but the token is pulled from the seller's own balance and allowance (doc 04).""",
    7: """MESSAGE: The chain is canonical; everything else can be rebuilt or is editorial.
SAY: "Orders, trades and escrow live in one Solidity contract on Arc. A FastAPI service and a web3 indexer copy events into PostgreSQL. The indexer re-reads state at the block it processed, so a lagging node cannot write stale data. Order and trade tables can be rebuilt by replay. Projects, badges, disputes and audit logs exist only in the database."
EVIDENCE: Doc 02 sections 3, 5, 6; worker.py lines 369 to 387; Alembic and models (doc 07 section 1). Wallet connectors: injected and Circle passkey only.
REVIEWER MAY ASK: What if the database is lost? Answer: orders and trades replay; editorial data does not and there is no backup procedure yet (finding F-4, milestone M2).""",
    8: """MESSAGE: Escrow is 2V + f and every exit pays out exactly that, with stated limits.
SAY: "Take trade value V and a half-percent fee f. The trade escrows 2V plus f. Settled: the seller receives 2V minus f and the fee collector 2f. Defaulted: the buyer receives 2V plus f and no fee is charged. Refunded: the buyer gets V plus f and the seller V. The limits matter: buyer protection holds up to about a 2x rise in the token's value, there is no on-chain price-time priority, and the settlement token is chosen by one manager signature, which is a mainnet blocker we plan to fix."
EVIDENCE: Doc 04 sections 5 and 9 (R-1, R-3, R-7); invariant_solvency and fuzz tests (66 tests for v2 out of the 112 reported). This is a desk review, not an audit.
REVIEWER MAY ASK: Can an admin steal escrow? Answer: no function reaches escrow, but a manager can pick a bad settlement token (H-1) and one wallet holds all roles today (R-2).""",
    9: """MESSAGE: Arc is the settlement layer by design; the contract is portable.
SAY: "Arc fits because USDC is both the money and the gas, finality is deterministic so our indexer needs no reorg logic, and payouts handle USDC's blocklist behaviour. Arc is also a CCTP domain. We want to be transparent: the contract is generic EVM code and its only Arc-specific constant is the USDC address. Arc is our chosen settlement layer, not a technical lock-in."
EVIDENCE: Doc 05 sections 1 to 3; useTx.ts line 31 (20 gwei floor); _pay line 685; bridgeRoutes.ts (Arc first). Predictable-cost claims are not benchmarked by us.
REVIEWER MAY ASK: Why not another chain? Answer: Arc-only listing makes Arc the settlement layer for project tokens too, and Circle's stack (USDC, CCTP, wallets) is native there; we do not claim a technical necessity.""",
    10: """MESSAGE: No Circle product is in production; USDC and CCTP run on testnet.
SAY: "This is the honest status. USDC is implemented on testnet. CCTP V2 is implemented on testnet but we have verified it on forks, not yet with a complete public-testnet transfer using Circle's live signatures. The passkey wallet code exists and is disabled on the live site. Gas Station is planned. Gateway is an address in a generated file only. Nanopayments and EURC are not implemented."
EVIDENCE: Doc 06 section 1; live /api/config shows circle_wallet.enabled false; docs/CCTP.md limits; 5 of 8 @circle-fin packages are unused by the product (doc 06 section 2).
REVIEWER MAY ASK: Can I see an integration on video? Answer: the bridge and its live Circle fee quote today; the passkey wallet and a sponsored first trade after the near-term steps (doc 06 section 4).""",
    11: """MESSAGE: A short path from groundwork to working Circle integrations, each tied to a user gain.
SAY: "Before submission we switch on the passkey wallet, create a Gas Station policy and run real CCTP transfers in both directions. In the first funded milestone we batch approval and order into one passkey confirmation and connect the bridge to the order form. Gateway, hooks, EURC and a data API are options that need contract changes and are not committed."
EVIDENCE: Doc 06 section 3 (steps 0a to 3c), doc 11 work packages WP1 to WP5. The developer-controlled wallet for the keeper is optional and not in the budget lines of Scenarios A and B (doc 11).
REVIEWER MAY ASK: Why is Gateway not near-term? Answer: the exchange has no deposit function; Gateway or hook funding needs a new contract version and audit scope (doc 06 steps 2a, 2b).""",
    12: """MESSAGE: We publish our own blockers.
SAY: "Three things block mainnet: the settlement token is chosen by one manager signature, one wallet holds all three roles, and there is no independent audit. Three findings are quick fixes that we confirmed on the live site: the nginx security headers are not delivered, a tracing scaffold is in the production bundle, and the session token sits in session storage. Operations gaps are backups, CI and a licence file."
EVIDENCE: Doc 04 section 9, doc 07 section 5. F-1: live curl -I returned only x-content-type-options. F-2: string studio-trace-event found in the committed bundle. Unverified: whether tracing captures headers.
REVIEWER MAY ASK: Is it safe to use? Answer: it is unaudited testnet software with worthless USDC; do not use it with real value.""",
    13: """MESSAGE: Fees only on settled trades; demand is not yet evidenced.
SAY: "The model is half a percent from each side, only when a trade settles. A thousand USDC settled is ten USDC of fees; that is arithmetic, not a forecast. Versus the one competitor the project researched from public docs, our differences are atomic delivery, fees only on success, and no administrative path to escrow. We have not estimated market size and we have not researched other competitors."
EVIDENCE: Doc 09 sections 3 and 4; R&D.md 6.1 (read 2026-11-03, must be re-verified). Testnet fees of 0.12 USDC are not revenue.
REVIEWER MAY ASK: What are your costs and break-even? Answer: not in the repository; founder input (doc 13 section 5.4).""",
    14: """MESSAGE: Five milestones, and mainnet waits for the audit.
SAY: "M1 puts Circle integrations on testnet. M2 hardens security and delivery. M3 is contract v3 with the settlement-token fix, multisig, timelock and an audit freeze. M4 is the independent audit. M5 is mainnet and a controlled beta, and only if the audit is clean. Our published roadmap targets 28 February for the audit; under this plan it lands around mid-March, and if no auditor can start in early February everything slips. We will not go to mainnet unaudited."
EVIDENCE: Doc 11 sections 2, 3, 4, 7 (Plan A assumes a 7 December start); src/lib/roadmap.ts for published dates.
REVIEWER MAY ASK: Is the audit date realistic? Answer: only if an auditor is booked in December; auditor availability is unknown until quotes arrive.""",
    15: """MESSAGE: Recommended request is $20,000 to $25,000, released by milestone.
SAY: "Our recommended request is twenty to twenty-five thousand dollars. The upper end needs traction evidence that we do not have today, so we say so. The largest line is audit co-funding. These are proposed allocations, not vendor quotes; the full audit price is unknown and the founders cover any excess. A ten-thousand-dollar lean option and a larger expansion scenario exist as alternatives."
EVIDENCE: Doc 11 section 6 Scenario B: low case 6,000 + 5,000 + 5,000 + 1,500 + 2,000 + 500; high case 6,000 + 5,500 + 9,000 + 1,500 + 2,500 + 500. Tranches 20, 15, 30, 20, 15 percent (doc 10 section K). Circle's page: most grants 10,000 to 20,000; 25,000 or more needs traction.
REVIEWER MAY ASK: Why not ask for more? Answer: we have no traction yet, and Circle weights path to independence above reliance on grants.""",
    16: """MESSAGE: Execution is visible in the repository; team facts must come from the founders.
SAY: "What we can show is the build record: 34 commits in 18 days, a deployed contract, a web app, an indexer and an admin dashboard. Names, roles, prior work, legal entity and key custody are founder inputs and are marked as such. We will also state accurately how the code was produced and who owns and operates it."
EVIDENCE: git log and shortlog (34 commits, two contributors); on-chain hasRole reads; doc 13 section 5. The code carries AI-assistance and scaffold markers (src/tracing.ts).
REVIEWER MAY ASK: Who wrote the code? Answer: founder input; do not improvise.""",
    17: """MESSAGE: A working base, a concrete Circle plan, and funding tied to checks, with limits stated.
SAY: "To summarise: a working testnet product, a lifecycle verified on chain, a USDC-centred design with no admin path to funds, groundwork for Circle products, a concrete integration plan, security commitments and milestone-based funding. We do not claim an audit, mainnet, production Circle use, users or volume."
EVIDENCE: Docs 00, 03, 06, 10, 11.
REVIEWER MAY ASK: What is the single biggest risk? Answer: the settlement-token trust point and the lack of an audit; both are addressed by M3 and M4.""",
    18: """MESSAGE: Close with the ask and the invitation to see it.
SAY: "AvantDex is live on Arc Testnet at avantdex.xyz. We are asking for a milestone-based grant to put Circle products into running testnet use, fix the settlement-token blocker and fund an independent audit before mainnet. We would be glad to show a live demo."
EVIDENCE: Contract 0xb48935EeA3B7264a53098B1DB920C3fCa09C0283 on Arc Testnet (deployments/arc-testnet.json).
REVIEWER MAY ASK: How do we contact you? Answer: founder input; contact details are not documented in the repository.""",
}

FIVE_MIN_SCRIPT = """\
**Target: 5 minutes, about 550 spoken words at a measured pace (leaves room for pauses and the demo cue). Slides 5 and 10 are the ones to slow down on.**

1. **(0:00, slide 1)** "We are AvantDex. We built an on-chain order book for tokens that have not launched yet, with funds held in USDC escrow. It runs on Arc Testnet today and it is not audited. I will be clear about what is verified, what is testnet and what is still to do."
2. **(0:20, slide 2)** "Before a token launches, trading happens in private chats and spreadsheets. Prices are scattered, a seller can vanish or a buyer can refuse to pay, nobody can see who holds the funds, and anyone can claim a token will exist."
3. **(0:40, slide 3)** "AvantDex lists a project, opens a market, and locks both sides in USDC when orders are placed. A trade escrows twice the trade value plus a half-percent fee. After the launch there is exactly one exit: settle, default or refund."
4. **(1:05, slide 4)** "This is the product: explore a market, read the order book, approve USDC and place an order. The first two screens are the live site; the trade panel is from our dev stack with demo data."
5. **(1:25, slide 5)** "On 21 November the contract on Arc Testnet showed four markets, fifteen orders and four trades. One settled, one refunded, two are open. We confirmed the settlement event on chain at block 71,729,618. This is testnet activity from four wallets: it proves the mechanism, not demand."
6. **(2:00, slides 6 and 7)** "A taker names resting orders; the contract fills them at the maker's price. An indexer copies events into PostgreSQL. The chain is canonical and order and trade tables can be rebuilt by replay."
7. **(2:20, slide 8)** "Settled: seller receives 2V minus f, collector 2f. Defaulted: buyer receives 2V plus f. Refunded: buyer V plus f, seller V. No role can move escrow. The limits: protection holds up to about a 2x rise in the token's value, there is no on-chain price priority, and the settlement token is chosen by one manager signature, which we will fix before mainnet."
8. **(3:00, slide 9)** "Arc is our settlement layer: USDC is money and gas, finality is deterministic, and it is a CCTP domain. The contract itself is portable EVM code, so Arc is a product choice, not a technical lock-in."
9. **(3:20, slides 10 and 11)** "Circle status, honestly: USDC and a CCTP bridge run on testnet. The bridge is verified on forks, not yet with a complete public-testnet transfer. Passkey wallets are built and switched off. Gas Station is planned. Nothing is in production. Next we switch on passkey wallets, create a Gas Station policy and run real CCTP transfers, then batch approval and order into one passkey confirmation."
10. **(4:00, slide 12)** "Our own blockers: the settlement token trust point, one wallet holding all roles, no independent audit, and some quick fixes we confirmed on the live site, such as missing security headers."
11. **(4:20, slides 14 and 15)** "Five milestones. Mainnet only after a clean audit. We request twenty to twenty-five thousand dollars, released by milestone. The biggest line is audit co-funding. These are proposed allocations, not quotes."
12. **(4:45, slides 16 to 18)** "Team details are founder inputs. We ask for support for a working base, a concrete Circle plan and checkable milestones. Try it at avantdex.xyz."
"""

DEMO_SCRIPT = """\
**Target: 3 minutes. Use throw-away testnet wallets only. Record at 1080p with wallet pop-ups visible. Everything shown is Arc Testnet.**

**Prepare first:** two funded testnet wallets (about 10 test USDC each from faucet.circle.com); a Live market with an open book (check `https://avantdex.xyz/api/stats` for `markets_live`); tabs open for the home page, the market page, Portfolio, `/bridge`, and the explorer page of the settlement transaction `0x8f649c185a0e9f09d3fdb3b173792e70df255b20f80bc68382c1d3b796763f2a` (receipts for older transactions are not returned by the public RPC, so check the explorer page beforehand).

| Time | Screen | Say | Proof |
|---|---|---|---|
| 0:00 to 0:20 | Home page | "AvantDex on Arc Testnet. The banner says testnet and not audited." | Banner and header tag |
| 0:20 to 0:45 | Explore, then a Live market | "Every number comes from our indexer, which copies contract events." | Board matches `/api/stats` |
| 0:45 to 1:30 | Wallet A: approve USDC, place a limit sell | "Selling locks collateral equal to the trade value. Fees apply only if the trade settles." | Wallet prompts; order in My orders |
| 1:30 to 2:00 | Wallet B: market-style buy | "The taker fills at the maker's price." | New trade; portfolios update |
| 2:00 to 2:20 | Cancel the remaining order | "Cancel returns the full lock, no fee." | Status Cancelled |
| 2:20 to 2:45 | Explorer: the `TradeSettled` transaction | "This trade settled on Arc Testnet: block 71,729,618, fees 0.06 plus 0.06 USDC." | Explorer event |
| 2:45 to 3:00 | `/bridge` | "Circle CCTP V2: USDC is burned on one chain and minted on another. Here is Circle's live fee quote." | Fee quote |

**Fallback:** if no market is Live for orders, show the Explore board, the market page and the explorer evidence, and say that order placement was recorded earlier. **Do not say:** audited, mainnet, production, users, volume, partners.
"""

QA = [
    ("Is the contract audited?",
     "No. There is one internal desk review (docs/AUDIT-2026-11-ARC-CIRCLE.md) and our own tests. An independent audit is milestone M4 and mainnet waits for it (doc 00, doc 11)."),
    ("What stops an admin from taking user funds?",
     "No function lets any role withdraw or redirect escrow; tests and the invariant_solvency invariant cover it (doc 04 section 4). The residual trust point is that a manager chooses the settlement token (H-1), and one wallet holds all roles today (R-2). Contract v3 with a multisig and timelock addresses both (M3)."),
    ("Why Arc? Could this run on another chain?",
     "Arc is the chosen settlement layer: USDC is the gas token, finality is deterministic, CCTP is native, and listings are Arc-only. The contract is generic EVM code, so Arc is not technically mandatory; we do not claim it is (doc 05)."),
    ("Which Circle products are in production?",
     "None. USDC and the CCTP bridge run on testnet; the passkey wallet is built but disabled on the live site; Gas Station is planned; Gateway, Nanopayments and EURC are not implemented (doc 06)."),
    ("Has CCTP been used end to end?",
     "Verified on forks of Base Sepolia and Ethereum Sepolia against the real CCTP contracts with the test's own attester (11 checks), plus a read-only address check and a live Circle fee quote. A complete public-testnet transfer with Circle's live signatures is not yet recorded; it is a near-term step (doc 06, docs/CCTP.md)."),
    ("Who are your users and what is your volume?",
     "There are no external users to report. The testnet shows 4 trades among 4 wallets and 36.5 USDC of test volume; we present that as proof of the mechanism only (doc 09 section 5)."),
    ("What if the seller does not deliver and the token price doubles or more?",
     "The buyer receives payment plus the seller's collateral, 2V plus f. Because collateral equals V, protection holds up to about a 2x rise in the token's value; beyond that a seller may rationally default (R-3). We disclose this and may raise collateral for volatile tokens (doc 04)."),
    ("The audit price is unknown. Why is audit co-funding in the request?",
     "Because the audit is the gate to mainnet. We propose the grant co-funds it ($5,000 to $9,000 in Scenario B) and the founders cover any excess; firm quotes are a founder input before submission (doc 11 section 6)."),
    ("Is pre-TGE token trading legal?",
     "Not assessed. Legal pages are placeholders and restricted jurisdictions are undefined (PRD LEGAL-004). Counsel is part of every budget scenario and mainnet is blocked on it (doc 09 section 8)."),
    ("Who is the team and who owns the code?",
     "That is founder input and not in the repository. The code carries AI-assistance and scaffold markers, so the founders should state accurately who designed, reviews and operates it and who holds the keys (doc 13 section 5.1)."),
]
