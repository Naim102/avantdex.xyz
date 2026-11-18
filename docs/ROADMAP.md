# Public roadmap and the testnet notice

Pages: **Roadmap** (`/roadmap`, `src/pages/RoadmapPage.tsx`) and a block at the bottom of the Home page (`RoadmapSection`). Code: `src/components/Roadmap.tsx`, content and dates in `src/lib/roadmap.ts` (edit that file to change the text; no other file holds roadmap copy). Footer link: Trade -> Roadmap. Test: the "roadmap" step of `scripts/ui-feature-test.mjs`.

## Layout

Seven boxes in the order of the project's roadmap graphic: four in the first row, three in the second, joined by arrows, with a line that carries the eye from the end of the first row to the start of the second. Each box holds the step number, a status tag (Completed, Upcoming, Long-term vision), the topic, and an expandable **What is included** list with the milestone. The **date sits under the box**: "Completed: November 15, 2026" or "Target: February 28, 2027". Below the large-screen breakpoint the boxes stack in one column with a down arrow between them.

* On the Home page the boxes are collapsed to keep the page short; the **Roadmap page** opens every box.
* Completed boxes have an accent border and a filled number. Colors come from the theme variables, so Sky and Ink both work.

## Content (as supplied by the project)

| # | Topic | Status | Date under the box |
|---|---|---|---|
| 01 | Core Platform Development & Testnet Validation | Completed | Completed: November 15, 2026 |
| 02 | Core Smart Contract Implementation & Testing | Completed | Completed: November 17, 2026 |
| 03 | Security Hardening & Independent Audit | Upcoming | Target: February 28, 2027 |
| 04 | Arc Mainnet Deployment & USDC Settlement | Upcoming | Target: March 31, 2027 |
| 05 | Controlled Beta & Ecosystem Onboarding | Upcoming | Target: April 15, 2027 |
| 06 | Public Beta Launch & Community Growth | Upcoming | Target: April 30, 2027 |
| 07 | Ecosystem Expansion & Advanced Trading Infrastructure | Long-term vision | Target: September 30, 2027 and ongoing |

The bullet points and milestones for each step are in `src/lib/roadmap.ts`. The product name is written "Avantdex" everywhere, as on the rest of the site.

## Honesty rules kept

* The roadmap page states that dates marked Target are plans that can move, that the contract is **not audited**, and that mainnet follows the independent audit (step 03). It links to the risk disclosure.
* Step 06 contains adoption targets (100 wallets, 10 listings, 25 trades). They are goals, not claims about the present; live platform numbers stay on the Home page and come from the API.

## Testnet notice

The site says in four places that it runs on Arc Testnet, shown only when the API reports chain id 5042002 (so a future mainnet deployment drops them automatically):

1. a banner under the header on every page: "Avantdex is live on Arc Testnet (chain 5042002). Trades use test USDC with no real value and the contract is not audited. Get test USDC" (`NetworkBanner`, `data-testid="testnet-banner"`);
2. a **Testnet** tag next to the logo in the header;
3. a "Live on Arc Testnet, test USDC only" chip above the Home headline;
4. the footer's On-chain facts: "Arc Testnet, test USDC only".

The existing wrong-network warning (wallet on another chain) is hidden on `/bridge`, where the wallet is asked to use other networks on purpose.
