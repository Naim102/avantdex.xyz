# Presentation QA report

Deck: `AvantDex-Circle-Grant-Presentation.pptx` (18 slides, 16:9, native editable shapes, charts and text; 5 pictures: 3 screenshots on slide 4 and the logo on slides 1 and 18). Speaker notes are embedded in every slide and repeated in `AvantDex-Presentation-Speaker-Notes.md`. Built on 2026-11-21 and 2026-11-22; all testnet figures are the **21 November 2026 snapshot** and are labelled as such. Nothing in the application source tree was changed; only new files were created under `docs/avantdex-grant-audit/`.

## 1. Final slide list

| # | Slide | Takeaway shown | Status vocabulary used |
|---|---|---|---|
| 01 | Cover | Structured Pre-Market Trading on Arc; Circle Grant Presentation, November 2026; avantdex.xyz; "Arc Testnet, not audited" | none |
| 02 | The problem | Four pain points of pre-launch trading, each paired with the AvantDex answer; no market statistics | none |
| 03 | The solution | List, post orders, match, escrow (2V + f), then exactly one exit (settle, default, refund) | none |
| 04 | Product walkthrough | Six user steps with three real screens; each screen labelled live or local demo | Live site, local dev stack (demo data) |
| 05 | Testnet evidence | 4 markets, 15 orders, 4 trades (1 settled, 1 refunded, 2 open); `TradeSettled` at block 71,729,618; native chart | Testnet snapshot, 21 Nov 2026 |
| 06 | How it works | Buyer, contract, seller swimlane plus indexer band | none |
| 07 | Technical architecture | On-chain (canonical) versus off-chain (rebuildable or editorial) | none |
| 08 | Smart contract and fund flow | Four functions; escrow bar and three exit bars drawn from V and f; limits of protection | Not audited |
| 09 | Why Arc | Four Arc properties, the "EVM-generic, not technically mandatory" statement, Arc and Circle integration map | Implemented, Partial, Planned |
| 10 | Circle integration, current status | Seven-row matrix; "No Circle product runs in production" | Implemented, Partial, Planned, Not implemented |
| 11 | Circle integration roadmap | Near-term, next (M1), future; each item with a user gain | Planned only |
| 12 | Security and risk | Blockers (H-1, R-2, no audit), confirmed quick fixes (F-1, F-2, F-3), operations gaps; unverified items separated | High, Medium, Low; Confirmed versus Not yet verified |
| 13 | Market and business model | Comparison with the one researched competitor; revenue model; expansion options; market size not estimated | Proposed |
| 14 | Roadmap and milestones | M1 to M5 timeline with the audit gate; published targets shown separately | Proposed Plan A |
| 15 | Funding request | $20,000 to $25,000 recommended; native doughnut and table; tranches; A and C only as alternatives | Proposed, not quotes |
| 16 | Team and execution | Documented facts; `[FOUNDER INPUT]` placeholders; technical-ownership note | Founder input |
| 17 | Why support AvantDex | Seven reasons plus "What we do not claim" | none |
| 18 | Closing and demo | Ask, link, demo invitation, contact placeholder | Founder input |

## 2. Source-document coverage

| Doc | Used for | Checked in this task |
|---|---|---|
| 00 executive summary | Readiness verdict, gap ranking | Re-scanned |
| 01 repository inventory | Coverage figures (not shown on slides) | Re-scanned |
| 02 system architecture | Slides 7, 6 | Re-scanned and used |
| 03 feature walkthrough | Slides 4, 5, 6 | Re-scanned and used |
| 04 smart contract analysis | Slides 3, 6, 8, 12 | Re-scanned and used (escrow formulas, R-1 to R-3, R-7) |
| 05 Arc integration | Slide 9 | Re-scanned and used |
| 06 Circle integration audit | Slides 9, 10, 11 | **Used line by line** for the status matrix and roadmap |
| 07 database, backend, security | Slides 7, 12 | Re-scanned and used (F-1 to F-7) |
| 08 testing and readiness | Slides 12, 16 | Re-scanned and used |
| 09 product and business analysis | Slides 2, 13 | Used (competitor, revenue, risks) |
| 10 grant proposal | Slides 15, 16, 17, 18 | **Used line by line** |
| 11 roadmap, milestones, budget | Slides 11, 14, 15 | **Used line by line** (Scenario B figures, Plan A dates, tranches) |
| 12 presentation and demo script | Demo script basis; outline superseded by the 18-slide structure requested | Used |
| 13 evidence and information gaps | Slides 5, 16, 18; claims to avoid | **Used line by line** |

All 14 files were written in the preceding audit task. In this task each was re-scanned (section headings and cross-document figure checks) and the five named priority documents (06, 10, 11, 12, 13) were used as the primary text sources. No document was changed in this task.

Other assets used: `avantdex-logo.png` (rounded copy in `presentation-assets/img/`); live screenshots of `avantdex.xyz` captured on 2026-11-21 with headless Chrome at 2x (explore, market, bridge, home, roadmap; the first two are on slide 4); repository screenshot `docs/screenshots/14-market-trade-panel.png` (cropped, slide 4; local dev stack, demo data, earlier theme); brand colours (`#28DF99`, `#262627`) and the Sky theme from `README.md` and the live site; contract address and deployment facts from `deployments/arc-testnet.json`. **Not inspected:** the existing `docs/Avantdex-product-tour.pptx` (it is a feature tour; not opened), and no existing architecture diagram or chart exists in the repository other than the ASCII sketch in `README.md`, so all diagrams and charts were drawn from documents 02, 04 and 11.

## 3. QA checklist from the request

| # | Check | Result |
|---|---|---|
| 1 | All 14 source documents read | Yes, see section 2 |
| 2 | Major claims verified against documents | Done. `presentation-assets/qa_check.py` found 85 number-like tokens in the deck text; **all 85 appear verbatim in the audit documents or the notes**. Wording-level claims were checked by hand against docs 04, 06, 10, 11, 13 |
| 3 | Circle integration status honest | Yes. Slide 10 uses Implemented (testnet) for USDC, Partial for CCTP V2 and passkey wallets, Planned for Gas Station, Not implemented for Gateway, Nanopayments and EURC; the title says no Circle product is in production; slides 9, 11, 17 repeat this |
| 4 | Funding amounts match doc 11 | Yes. Scenario B low case 6,000 + 5,000 + 5,000 + 1,500 + 2,000 + 500 = 20,000; high case 6,000 + 5,500 + 9,000 + 1,500 + 2,500 + 500 = 25,000; tranches 20, 15, 30, 20, 15 percent; A $10,000 and C $50,000 to $100,000 shown only as alternatives |
| 5 | Roadmap milestones and dependencies | M1 to M5 as in docs 10 and 11; mainnet shown dependent on a clean audit (gate on slide 14); Plan A dates from doc 11 section 2; published targets shown separately |
| 6 | Testnet figures and snapshot date | 4 / 15 / 4, 1 settled, 1 refunded, 2 open, block 71,729,618, fees 0.06 + 0.06 USDC, 84.449 USDC held, lag 0 at block 73,366,759, all labelled "21 November 2026" |
| 7 | No placeholder silently replaced | Team, contact, costs, break-even, quotes, demand evidence stay as `[FOUNDER INPUT]` on slides 13, 15, 16, 18 |
| 8 | Every slide rendered to an image | Yes: Microsoft PowerPoint (installed on this machine) exported all 18 slides at 1920 x 1080 to `presentation-assets/render/` plus a contact sheet |
| 9 | Every slide inspected | Yes, each slide image was viewed; fixes below were re-rendered and re-viewed |
| 10 | Overflow, alignment, spacing, contrast, image issues fixed | See section 4 |
| 11 | Diagrams understandable without long explanation | Reviewed on slides 3, 6, 7, 8, 9, 14; each has a one-line takeaway title |
| 12 | PPTX opens and validates | Opened by PowerPoint without repair; reloaded with python-pptx: 18 slides, 16:9, notes on all slides, 5 pictures resolve, no shape outside the slide |
| 13 | File at the requested path | `docs/avantdex-grant-audit/AvantDex-Circle-Grant-Presentation.pptx` |

## 4. Visual QA: problems found and fixed

| Slide | Problem found | Fix |
|---|---|---|
| All | Connectors and rules showed a theme shadow (thick blurred lines) | Removed the theme style from every connector |
| 1, 18 | Hyperlink rendered in default blue on the dark background | Link moved to shape-level click action with explicit colour and underline |
| 3 | Outcome boxes clipped their text; step boxes had dead space | Re-proportioned boxes and outcome column |
| 4 | A rule struck through the step labels; third caption and chip ran past the right margin; chips crowded the footer note | Rule removed, chip widths limited, spacing adjusted; the script check also caught an oversized caption box and it was fixed |
| 7 | Contract box had empty space | Added the blocklist-safe payout bullet |
| 14 | "mainnet" and "controlled beta" labels overlapped; diamond touched the beta bar | M5 split into two rows with separate labels; gate arrow redrawn |
| 17 | Right-hand box far taller than its content | Box shortened |
| 18 | Gap between "Try it on Arc Testnet:" and the link | Link repositioned |

Residual visual notes (accepted): text inside screenshots is small by nature (illustrative, with captions); one-line titles leave about half an inch of space above the content on most slides; the contract and architecture diagrams use Calibri 10 to 12 pt inside boxes.

## 5. Known limitations

* **Fonts:** Calibri (text) and Consolas (addresses and amounts) were chosen because they ship with Office. The product itself uses Archivo and IBM Plex Mono, which are not installed here and are not embedded. Rendering was checked only in Microsoft PowerPoint on Windows, not in Keynote or Google Slides.
* **Screenshots:** slide 4 uses two live captures (21 Nov 2026) and one repository screenshot from the local dev stack with demo data and an earlier theme (labelled on the slide). Live pages will keep changing. Two screens show the listed testnet project "Buraq" (name, logo and a "Contract Verified" badge): confirm the project is comfortable being shown or swap the capture.
* **Transitions:** a medium fade is set on every slide (PowerPoint feature); other viewers may ignore it.
* **Charts and tables:** the funding doughnut and the trade-status chart are native, editable PowerPoint charts. Tables are built from text boxes and lines (editable, but not PowerPoint table objects).
* **Not re-verified in this task:** tests were not re-run; the on-chain and API figures are those read on 2026-11-21 (the date has since moved on); Circle's program page was read on 2026-11-21.

## 6. Cross-document inconsistencies and how the deck handles them

| Topic | Inconsistency | Deck choice |
|---|---|---|
| Audit date | Published roadmap says audit by 28 Feb 2027; doc 11 Plan A completes it about mid-March | Slide 14 shows both and says the audit date moves |
| Gas Station status | Doc 06 classes it "Configuration only"; the request asks for "Planned" | Labelled **Planned**, with "request is coded, no policy created" in the detail |
| Keeper wallet | Doc 06 lists a developer-controlled wallet for the keeper as step 1c; doc 11 has no work package or budget line for it | Slide 11 marks it "Optional, not in the budget lines of Scenarios A and B" |
| Grant size | Doc 00 section 7 speaks of "about $10,000 to $25,000"; docs 10 and 11 recommend Scenario B, $20,000 to $25,000 | Deck uses B as the primary ask, A and C as alternatives |
| Test counts | `TEST-REPORT.md` headline "112 passed" includes 46 legacy tests | Deck says 66 contract tests for v2 |
| "Predictable transaction costs" (requested for slide 9) | The audit documents do not evidence cost predictability | Not claimed; slide 9 says fees are paid in USDC and that finality and fee floor handling come from Arc documentation and were not benchmarked |
| Slide structure | Doc 12 has a 15-slide outline | The 18-slide structure from the request was followed; doc 12 remains the earlier outline |

## 7. Remaining founder inputs

Contact details (slide 18); team names, roles, prior work, entity and jurisdiction, technical-ownership statement, key custody and multisig plan, advisors (slide 16); running costs and break-even volume, first-party demand evidence (slide 13); audit quotes, engineering rates, legal budget (slide 15); consent to show the "Buraq" testnet listing (slide 4); target pilot count for M5 (doc 11). The full list is in `13-evidence-and-information-gaps.md` section 5.

## 7b. Claims that need additional verification before the deck is used

* Competitor comparison (slide 13): taken from the project's own reading of public documentation on 2026-11-03; re-verify against current documents.
* Arc properties (slide 9: finality, USDC as gas, 20 gwei floor, blocklist behaviour, CCTP domain 26): as recorded in `docs/AUDIT-2026-11-ARC-CIRCLE.md`; this task did not re-fetch Arc documentation.
* Circle program terms (slide 15 footnote: grant range, traction guidance): from `circle.com/grant` read on 2026-11-21; re-read before submission.
* Slide 12, F-2: whether the tracing code captures request headers or tokens was not verified; it is shown as unverified.
* Recorded test results (slide 16 and the notes): the project's own claims, corroborated by static counts, not re-run.
* CCTP and passkey: fork-level and local-account verification only; the slides say so.

## 8. Items intentionally excluded (unsupported)

Market size, TAM or volume statistics; users, partnerships, revenue forecasts or traction beyond the testnet snapshot; competitor figures beyond the one researched competitor; audit firm names, prices or dates; team names, bios or credentials; any claim of audit, mainnet, production Circle integration, Gateway or Nanopayments use; Circle approval likelihood; "predictable fees" as a measured property.

## 9. Files and how to regenerate

| File | Purpose |
|---|---|
| `AvantDex-Circle-Grant-Presentation.pptx` | The deck |
| `AvantDex-Presentation-Speaker-Notes.md` | Slide notes, 5-minute script, 3-minute demo script, 10 reviewer questions |
| `PRESENTATION-QA.md` | This report |
| `presentation-assets/build_grant_deck.py`, `deck_lib.py`, `slides_a.py`, `slides_b.py`, `slides_c.py`, `notes_data.py` | Deck generator (python-pptx) |
| `presentation-assets/prep_images.py`, `img/`, `screens/` | Screenshot crops, logo, raw live captures |
| `presentation-assets/render_slides.py`, `render/` | PowerPoint export to PNG and contact sheet |
| `presentation-assets/qa_check.py` | Structure and number cross-check |

Regenerate: `python docs/avantdex-grant-audit/presentation-assets/build_grant_deck.py`, then `python docs/avantdex-grant-audit/presentation-assets/render_slides.py` and `python docs/avantdex-grant-audit/presentation-assets/qa_check.py`. Only python-pptx, lxml, Pillow and (for rendering) pywin32 with PowerPoint are needed; nothing was installed.
