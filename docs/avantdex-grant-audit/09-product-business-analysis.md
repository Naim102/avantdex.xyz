# 09. Product and business analysis

Audit date: 2026-11-21. **Rule kept throughout: no market data, user numbers, volumes, partnerships or competitor facts are invented.** Where the repository has no evidence, this document says UNKNOWN and lists what to collect. Sources: `PRD.md`, `R&D.md`, `README.md`, `docs/ROADMAP.md`, `src/lib/roadmap.ts`, live read-only API and chain reads of 2026-11-21.

## 1. Product definition

Avantdex is an **order-book marketplace for tokens that have not launched yet (pre-TGE)**, settled in USDC on Arc with on-chain escrow. It is a trading venue plus a listing and admin layer, not a launchpad, a wallet or a bridge (the bridge and passkey wallet are onboarding aids). Only tokens deployed on Arc can be listed, because settlement pulls the real token on Arc.

| Who | What they do | Source |
|---|---|---|
| Trader (buyer or seller) | Connects a wallet, places limit or immediate-or-cancel orders, settles or claims | `PRD.md` section 4 and 5 (personas "pre-launch trader" and "early holder") |
| Project team | Submits a project for listing; provides a TGE date or "TBD" and a team wallet | `src/pages/Listing.tsx`; `projects` table |
| Community member | Files a listing request for a project they do not own | `listing_requests` |
| Admin | Reviews projects, verifies, configures and activates markets, runs settlement | `src/pages/admin/` |
| Visitor | Browses markets without a wallet | public API |

## 2. Problem statement (as stated by the project) and how the mechanism addresses it

From `R&D.md` section 4:

| Problem | Mechanism in the product | Residual weakness (from `04`) |
|---|---|---|
| Price discovery before launch is fragmented (OTC chats, spreadsheets, no enforceable settlement) | One public order book per market, on-chain orders, indexed depth and trade history | Liquidity is thin: the live platform has 6 open orders across 2 live markets (testnet) |
| Counterparty risk: seller may vanish, buyer may refuse to pay | Both sides lock funds at match: buyer payment plus fee reserve, seller collateral equal to the trade value; atomic delivery versus payment at settlement; default pays the buyer | Protection holds only up to a 2x price move (R-3); a manager-chosen token address is a trust point (R-1) |
| Opaque rules (who controls funds, what if launch is delayed or cancelled) | No role can reach escrow; refund path on cancel; extension window; 90-day abandonment refund; all rules public in the contract and docs | Refund timing depends on the manager acting (R-5) |
| Listing quality (anyone can claim a token will exist) | Approval, verification and activation are separate steps; badges; token pre-flight; Arc-only rule | Verification is a human process; no external verifier or evidence standard is documented |

**Evidence that the problem is real and sized: UNKNOWN.** `R&D.md` section 5 states that market-size and volume statistics were deliberately not collected ("intentionally omitted rather than estimated"). Before submission the founders should add first-party evidence (interviews, waitlist, project requests, Arc ecosystem demand) or leave the claim qualitative.

## 3. Competitive landscape (only what the repository verified)

The repository researched **one** competitor from primary documentation, on 2026-11-03 (`R&D.md` section 6.1, marked `[VERIFIED]`): Whales Market, a collateralised pre-market. Other platforms (exchange-run pre-markets, on-chain pre-launch perpetuals) are listed as `[OPEN]` with "no claims made". This audit did not research competitors beyond the repository, so the table below repeats the repository's own comparison and must be **re-verified against live competitor documentation before it is used in an application**.

| Aspect | Whales Market (per the repository's 2026-11-03 reading of its docs) | Avantdex (verified in this audit) |
|---|---|---|
| Collateral | Buyer and seller lock collateral in smart contracts | Same idea; seller collateral is 100% of trade value (`placeOrder`, `_match`) |
| Settlement window | Documented as 4 hours from activation | Per market, 1 hour to 14 days, extendable to 30 days (`openSettlement`, `extendSettlement`) |
| Delivery proof | Seller sends tokens and posts a transaction hash; status moves after confirmations | Atomic swap in one transaction, balance-delta verified (`settleTrade`) |
| Fees | Percentage fees on settlement and a resell fee (pages disagreed) | 0.5% buyer plus 0.5% seller, settled trades only; no resale feature |
| Cross-chain | Supported via LayerZero | Not supported; Arc-only listings; CCTP moves USDC only |
| Admin power over funds | not assessed | None by design (no function reaches escrow) |

**Defensible differentiators, each tied to code:** atomic delivery versus payment instead of seller-posted proof; fees charged only on successful settlement (zero on default, refund, cancel); no administrative path to escrow; push-with-fallback payouts for USDC blocklisting; Arc-native design; rebuildable indexer. **Not differentiators until proven:** liquidity, listings, users, speed, cost.

**Not known:** competitor volumes, listing counts, default rates, fee levels today, regulatory posture. Collect these from primary sources before claiming advantage.

## 4. Business model

| Revenue source | Mechanism | Evidence |
|---|---|---|
| Settlement fee | 0.5% of trade value from the buyer plus 0.5% from the seller, in USDC, to the fee collector `0x136a...Ebd6`, **only when a trade settles** | `AvantdexExchange.sol` constants and `settleTrade`; `/api/config` |
| Listing | 0% (project listing and community requests are free) | `README.md` fee table |
| Everything else (cancel, expiry, default, refund, failed transaction) | 0% | contract tests |

* **Unit arithmetic (not a forecast):** fees equal 1% of settled trade value. 1,000 USDC of settled trades yields 10 USDC; 100,000 USDC yields 1,000 USDC. Revenue is **zero** for volume that defaults, is refunded or is cancelled, and it arrives only after the token launches and sellers deliver, so it lags trading activity by the time to TGE.
* **Observed today (testnet, test USDC):** 1 settled trade of 12.0 USDC, fees 0.12 USDC (API `fees_paid`, on-chain trade 2). This is **not revenue** and not evidence of demand.
* **Costs: UNKNOWN.** The repository contains no cost model (hosting, RPC, audit, legal, support). Circle weights "a credible path to financial independence" above continued reliance on grants, so a simple monthly cost and break-even volume (settled volume needed so that 1% covers costs) should be added by the founders.
* **Incentive note:** the platform earns nothing on defaults, which aligns it with successful delivery rather than with forfeited collateral.

## 5. Traction: what exists, and what it does and does not show

| Metric | Value (live, 2026-11-21) | Interpretation |
|---|---|---|
| On-chain markets, orders, trades | 4, 15, 4 (chain reads) | The contract has been used end to end on Arc Testnet |
| Trades by distinct wallets | 4 trades among 4 distinct addresses, on 2026-11-10 and 2026-11-17 | Consistent with team or test activity; **no evidence of external users** |
| Settled and refunded trades | 1 Settled (12.0 USDC), 1 Refunded (10.5 USDC), 2 Open | Settlement and refund paths work on the real chain |
| Volume, open interest, fees | 36.5 USDC total, 14.0 USDC open interest, 0.12 USDC fees | Testnet tokens without value |
| Listed projects | 1 "Coming soon" project and 4 market records (two Cancelled, one SettlementOpen, one Live) | A demo-scale catalogue; the repository's seed script labels demo markets and uses a worthless open-mint demo token (`scripts/seed_demo_markets.py`) |
| Users, partners, pilots, revenue | **None evidenced** | |

* **Roadmap targets are goals:** step 06 of `src/lib/roadmap.ts` names 100 wallets, 10 listings and 25 trades for the public beta (target 30 April 2027). `docs/ROADMAP.md` states these "are goals, not claims about the present".
* **What would count as traction for Circle:** named Arc-ecosystem projects that agree to list or to test, trading wallets that are not the team's, repeat usage, settled value on mainnet after the audit, or letters of intent. None exists in the repository. Do not present testnet numbers as users or volume.

## 6. Go-to-market (UNKNOWN beyond the roadmap)

The roadmap names "Controlled Beta & Ecosystem Onboarding" (target 15 April 2027) and "Public Beta Launch & Community Growth" (target 30 April 2027). The repository contains no channel plan, partner list, budget or community metrics. Founders should supply: first target projects (pre-TGE tokens that plan to launch on Arc), why they would list, how liquidity will be seeded (market makers, incentives), and the support model for disputes. The X account `@AvantDex` is referenced in the docs; its audience size is not in the repository and is not claimed here.

## 7. Ecosystem-impact hypotheses (to be measured, not asserted)

| Hypothesis | Metric to track | Today |
|---|---|---|
| Pre-TGE markets create USDC settlement volume on Arc | Settled USDC value per month on Arc mainnet | 0 on mainnet |
| Arc-only listing pulls projects to deploy on Arc | Number of listed projects that deployed their token on Arc | 1 test token (symbol "ARC", 18 decimals, the token of the SettlementOpen market) deployed for the testnet demonstration; no external project evidenced |
| CCTP funding brings new USDC to Arc | USDC bridged into Arc through the Bridge page | No public-testnet transfer recorded |
| Passkey wallets with gas sponsorship lower the barrier for new users | New wallets created and first trades completed with zero gas | Feature off in production |

## 8. Product and business risks

| Risk | Type | Note |
|---|---|---|
| **Two-sided cold start:** buyers need sellers with collateral and listed projects; sellers need buyers | Market | Liquidity on the live platform is thin; no market-maker plan evidenced |
| **Collateral bound:** a 2x price move makes default rational (R-3) | Product | Needs clear disclosure and possibly higher collateral for volatile tokens |
| **Settlement-token trust (H-1)** | Trust | A mainnet blocker per the repository's own audit |
| **Listing quality and brand risk:** a fake or never-launching token harms users | Operational | Verification is manual; "token may never launch" is in the PRD's risk list |
| **Regulatory:** trading claims on tokens before they exist may be treated as securities, derivatives or commodities trading in some jurisdictions; KYC, AML, sanctions and restricted jurisdictions are undefined (`PRD.md` LEGAL-004 `[LEGAL]`); legal pages are placeholders | Legal | **Needs qualified counsel before mainnet.** This document is not legal advice |
| **Dependency on Circle and Arc:** USDC blocklist or pause, Arc outages, testnet resets | Platform | Inherent to a USDC-on-Arc design (R-6) |
| **Competition:** at least one established pre-market exists; others unresearched | Market | Re-verify; differentiate on safety and Arc-native settlement, not on volume |
| **Team and bus factor:** no team information in the repository; code carries AI-assistance and scaffold markers | Execution | Founders must state ownership and roles accurately (see `13`) |
| **Sustainability:** fee revenue only on settled trades with unknown costs | Financial | Add a cost model and break-even |

## 9. What a reviewer will still ask (prepare answers)

1. Who are the founders, what have they shipped before, and who owns the code and the keys?
2. Which Arc-ecosystem projects will list first, and have any agreed?
3. Who provides liquidity in the first 90 days?
4. What is the legal structure, and which jurisdictions are excluded?
5. How much of the grant goes to the audit, and who is the auditor (a quote is needed; this package does not invent one)?
6. What are the monthly running costs and the break-even settled volume?
