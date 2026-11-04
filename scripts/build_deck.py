"""Builds docs/Avantdex-product-tour.pptx from the screenshots in docs/screenshots.

Needs: python-pptx and Pillow.   python scripts/build_deck.py
Every number on the slides comes from the product itself (fee constants) or is a plain statement of status.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
OUT = ROOT / "docs" / "Avantdex-product-tour.pptx"
TMP = Path(tempfile.mkdtemp(prefix="deck-"))

INK, GREEN, WHITE, PAPER, MUTED = "262627", "28DF99", "FFFFFF", "F2F2EE", "5A5A60"
FONT = "Arial"


def rgb(h: str) -> RGBColor:
    return RGBColor.from_string(h)


prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
BLANK = prs.slide_layouts[6]
N = 0


def new_slide(dark: bool = False):
    global N
    N += 1
    s = prs.slides.add_slide(BLANK)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = rgb(INK if dark else WHITE)
    return s


def text(slide, x, y, w, h, runs, size=16, color=INK, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, name="text"):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        parts = para if isinstance(para, list) else [(para, bold)]
        for t, b in parts:
            r = p.add_run()
            r.text = t
            r.font.name = FONT
            r.font.size = Pt(size)
            r.font.bold = b
            r.font.color.rgb = rgb(color)
        p.space_after = Pt(size * 0.55)
    return tb


def title(slide, t, sub=None, dark=False):
    text(slide, 0.6, 0.45, 12.1, 0.8, t, size=34, bold=True, color=WHITE if dark else INK, name="title")
    if sub:
        text(slide, 0.6, 1.2, 12.1, 0.5, sub, size=16, color="C9C9CE" if dark else MUTED, name="subtitle")


def footer(slide, dark=False):
    c = "9A9AA2" if dark else "7A7A82"
    text(slide, 0.6, 7.05, 8, 0.25, "Avantdex product tour. Arc Testnet, unaudited.", size=10, color=c, name="footer")
    text(slide, 12.0, 7.05, 0.75, 0.25, str(N), size=10, color=c, align=PP_ALIGN.RIGHT, name="slide number")


def crop(name: str, box: tuple[int, int, int, int]) -> Path:
    """box = (x, y, w, h) in screenshot pixels."""
    im = Image.open(SHOTS / f"{name}.png").convert("RGB")
    x, y, w, h = box
    out = TMP / f"{name}-{x}-{y}-{w}-{h}.png"
    im.crop((x, y, min(x + w, im.width), min(y + h, im.height))).save(out)
    return out


def framed(slide, name, box, x, y, w, shadow=GREEN, label=None):
    """Screenshot with a hard 2pt black frame and an offset solid shadow (the product's own look). Returns height."""
    path = crop(name, box)
    iw, ih = Image.open(path).size
    h = w * ih / iw
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x + 0.09), Inches(y + 0.09), Inches(w), Inches(h))
    sh.name = f"shadow {name}"
    sh.fill.solid()
    sh.fill.fore_color.rgb = rgb(shadow)
    sh.line.fill.background()
    pic = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    pic.name = f"screenshot {name}"
    pic._element.nvPicPr.cNvPr.set("descr", label or f"Screenshot: {name}")
    pic.line.color.rgb = rgb(INK)
    pic.line.width = Pt(2)
    return h


def caption(slide, x, y, w, t, dark=False):
    text(slide, x, y, w, 0.3, t, size=12, color="B8B8C0" if dark else MUTED, name="caption")


def points(slide, x, y, w, items, size=16, color=INK):
    paras = [[(lead + " ", True), (rest, False)] for lead, rest in items]
    return text(slide, x, y, w, 4.5, paras, size=size, color=color, name="points")


def notes(slide, t):
    slide.notes_slide.notes_text_frame.text = t


# 1 ---------------------------------------------------------------- title
s = new_slide(dark=True)
text(s, 0.6, 1.5, 5.6, 1.2, "Avantdex", size=60, bold=True, color=WHITE, name="title")
text(s, 0.6, 2.75, 5.4, 1.4, "Pre-market trading on Arc. An order book for tokens that have not launched yet, settled in USDC with escrow.", size=20, color="DADADF", name="subtitle")
text(s, 0.6, 4.55, 5.4, 0.9, [[("Product tour", True)], "Every page of the running product, Arc Testnet"], size=16, color=GREEN, name="tagline")
framed(s, "01-home", (0, 0, 1440, 900), 6.75, 1.1, 6.0, shadow=GREEN, label="Avantdex home page")
text(s, 0.6, 6.55, 5.5, 0.5, "Testnet software, not audited.", size=14, color="B8B8C0", name="status")
notes(s, "Avantdex is a pre-TGE marketplace: users trade tokens before they exist. Orders are on-chain and funds are locked at placement. This deck walks through every page of the running product, captured from a local test stack running the same code as avantdex.xyz.")

# 2 ---------------------------------------------------------------- what it is
s = new_slide()
title(s, "Trade a token before it exists")
points(s, 0.6, 1.7, 5.9, [
    ("Order book.", "Buyers and sellers post resting orders. A trade fills at the maker's price."),
    ("Escrow.", "Funds are locked on-chain when an order is placed. The buyer locks payment plus a 0.5% fee reserve, the seller locks collateral equal to the trade value."),
    ("Atomic delivery.", "After launch the seller swaps token for USDC in one transaction. If they do not deliver, the buyer claims payment plus the collateral."),
    ("Live on Arc Testnet.", "Chain 5042002, USDC with 6 decimals. Not audited."),
], size=16)
framed(s, "01-home", (760, 80, 540, 450), 7.5, 1.8, 5.1, label="Platform ledger on the home page")
caption(s, 7.5, 6.35, 5.2, "The platform ledger is computed from on-chain orders and trades.")
footer(s)
notes(s, "Four ideas: order book, escrow, atomic delivery, and a testnet-only, unaudited contract. The ledger panel on the right is live data from the indexer.")

# 3 ---------------------------------------------------------------- home
s = new_slide()
title(s, "Home: the ledger and the market board", "Last price, both sides of the book, volume and liquidity for every market, on one screen")
framed(s, "01-home", (140, 90, 1160, 1040), 0.6, 1.85, 5.6, label="Home page: ledger and market board")
points(s, 6.9, 1.95, 5.8, [
    ("Platform ledger.", "Live markets, open orders, buy-side and sell-side liquidity, 24h and total volume, open interest, settled trades and fees paid."),
    ("Market board.", "Last price, best bid, best ask, 24h volume, open interest, a buy versus sell liquidity bar and TGE date. Buy and Sell buttons on every row."),
    ("Coming soon.", "Approved projects whose market is not open yet. Nothing there can be traded."),
], size=16)
footer(s)
notes(s, "Everything on this page is read from the API. Zeros are shown as zeros. Projects that are approved but have no market yet appear under Coming soon.")

# 4 ---------------------------------------------------------------- explore
s = new_slide()
title(s, "Explore: filter, sort and switch views", "Board for comparing numbers, Cards for browsing")
h = framed(s, "02-explore-board", (140, 60, 1160, 640), 0.6, 1.9, 6.0, label="Explore page, board view")
caption(s, 0.6, 1.9 + h + 0.2, 6.0, "Board view")
framed(s, "03-explore-cards", (140, 60, 1160, 640), 6.95, 1.9, 6.0, shadow=INK, label="Explore page, cards view")
caption(s, 6.95, 1.9 + h + 0.2, 6.0, "Cards view")
text(s, 0.6, 6.15, 12, 0.7, "Tabs: All, Trending, New, Upcoming TGE, Closing soon, Settled. Search by name or symbol, filter by category, status and verification badge.", size=14, color=INK, name="note")
footer(s)
notes(s, "Both views show the same data. The board is better for comparing; the cards show one market at a time with the liquidity split.")

# 5 ---------------------------------------------------------------- market
s = new_slide()
title(s, "Market page: depth, order book, trade panel")
framed(s, "04-market-orderbook", (150, 140, 1140, 1000), 0.6, 1.4, 6.2, label="Market page with depth chart and order book")
points(s, 7.4, 1.5, 5.3, [
    ("Stats.", "Last price, best bid and ask, 24h and total volume, open interest, trade count and TGE."),
    ("Buy side versus sell side.", "A liquidity bar and a depth chart show how much size rests at each price."),
    ("Order book.", "Built from on-chain orders. Click a price to fill the trade panel."),
    ("Trade panel.", "Limit or market (IOC with a price cap), with approval and fee preview."),
], size=16)
footer(s)
notes(s, "The depth chart is built only from live resting orders whose funds are already locked. Market orders are fill-or-kill style with a price cap and a minimum fill.")

# 6 ---------------------------------------------------------------- market tabs
s = new_slide()
title(s, "Recent trades, About and Rules", "The same page explains the project and the rules of the market")
for i, (n, lab) in enumerate([("05-market-trades", "Recent trades"), ("06-market-about", "About the project"), ("07-market-rules", "Rules and fees")]):
    x = 0.6 + i * 4.2
    framed(s, n, (160, 455, 715, 560), x, 1.9, 3.8, shadow=GREEN if i != 1 else INK, label=lab)
    text(s, x, 4.95, 3.8, 0.4, lab, size=16, bold=True, name="label")
text(s, 0.6, 5.6, 12, 1.2, [
    [("Trades ", True), ("link to their on-chain transactions.", False)],
    [("Rules ", True), ("state the fee table and the market parameters (lot size, tick size, trading window, settlement deadline).", False)],
], size=15, name="note")
footer(s)
notes(s, "Each trade row links to the explorer. The Rules tab repeats the fee table so traders see it before placing an order.")

# 7 ---------------------------------------------------------------- trade panel
s = new_slide()
title(s, "Placing an order from a connected wallet")
framed(s, "14-market-trade-panel", (150, 440, 1140, 700), 0.6, 1.5, 7.0, label="Market page with the trade panel for a connected wallet")
points(s, 8.2, 1.6, 4.5, [
    ("Preview first.", "Value, fee reserve and what gets locked are shown before signing."),
    ("Simulate, then send.", "Every transaction is simulated before the wallet asks for a signature."),
    ("Readable errors.", "Contract errors are translated into plain sentences."),
], size=16)
footer(s)
notes(s, "Transactions use a max fee of at least 20 gwei, as Arc requires. The wallet is a local test wallet in these screenshots.")

# 8 ---------------------------------------------------------------- portfolio
s = new_slide()
title(s, "Portfolio: orders, trades and settlement", "Every row links to its on-chain transaction")
framed(s, "11-portfolio-overview", (140, 90, 1160, 480), 0.6, 1.85, 5.4, label="Portfolio overview")
framed(s, "12-portfolio-open-orders", (140, 90, 1160, 480), 6.6, 1.85, 5.4, shadow=INK, label="Portfolio open orders")
framed(s, "13-portfolio-trades", (140, 90, 1160, 480), 0.6, 4.45, 5.4, shadow=INK, label="Portfolio trade history")
points(s, 6.6, 4.55, 5.9, [
    ("Overview.", "Wallet balance, USDC locked in orders and in trades, claimable amounts."),
    ("Twelve tabs.", "Open, partly filled, filled, cancelled, expired, trade history, settlement status and notifications."),
], size=15)
footer(s)
notes(s, "Cancelling an open order refunds everything with no fee. Sellers settle from here after the token launches; buyers claim a default here if the seller does not deliver.")

# 9 ---------------------------------------------------------------- listing
s = new_slide()
title(s, "Create Listing is not Create Order", "Getting a project onto Avantdex is free and is a separate flow from trading")
framed(s, "08-create-listing", (150, 90, 1140, 470), 0.6, 1.95, 6.0, label="Create listing page")
framed(s, "15-submit-project", (150, 90, 1140, 470), 6.95, 1.95, 6.0, shadow=INK, label="Submit your project form with applications")
points(s, 0.6, 4.75, 12.1, [
    ("Submit your project.", "For owners and authorised team representatives. A reviewer approves it; trading starts only after a market is created on-chain and activated."),
    ("Request a listing.", "Anyone can ask for a token to be listed. Requests are counted per token and never create a market by themselves."),
], size=15)
footer(s)
notes(s, "Approval, verification and market activation are three separate steps. A listing request is not a listing, and a listing is not an order.")

# 10 ---------------------------------------------------------------- admin 1
s = new_slide()
title(s, "Admin dashboard: one admin level", "Any admin wallet can review, approve and manage markets. Every action is written to an append-only audit log")
framed(s, "16-admin-overview", (140, 220, 1140, 640), 0.6, 2.0, 5.9, label="Admin overview")
framed(s, "17-admin-applications", (140, 220, 1140, 640), 6.85, 2.0, 5.9, shadow=INK, label="Admin applications list")
caption(s, 0.6, 5.5, 5.9, "Overview: applications and markets by status, open trades, fees")
caption(s, 6.85, 5.5, 5.9, "Applications: open a project and approve it in one click")
text(s, 0.6, 6.2, 12, 0.6, "Admins are set with BOOTSTRAP_ADMIN_ADDRESSES / ADMIN_ROLES in the environment or added in the dashboard. The last admin can never be removed.", size=14, name="note")
footer(s)
notes(s, "There is a single admin level now. Older split role names still parse and count as admin. Approving a project lists it as Coming soon; it does not open trading.")

# 11 ---------------------------------------------------------------- admin 2
s = new_slide()
title(s, "Market management: create, verify, activate, settle", "Separate steps, each signed on-chain by a wallet with the MARKET_MANAGER role")
framed(s, "20-admin-live-markets", (140, 220, 1140, 640), 0.6, 2.0, 5.9, label="Admin live markets with settlement controls")
framed(s, "22-admin-settlement", (140, 220, 1140, 640), 6.85, 2.0, 5.9, shadow=INK, label="Admin settlement management")
caption(s, 0.6, 5.5, 5.9, "Suspend, resume, cancel, or open settlement with the token address")
caption(s, 6.85, 5.5, 5.9, "Settlement management for markets past their trading window")
text(s, 0.6, 6.2, 12, 0.6, "Admins cannot move escrowed funds. Pause only blocks new orders; cancel, settle, claim and refund always work.", size=14, name="note")
footer(s)
notes(s, "Configuration is read back from the chain and compared with the draft before activation. Opening settlement fixes the token address sellers must deliver, so it deserves a second pair of eyes.")

# 12 ---------------------------------------------------------------- admin 3
s = new_slide()
title(s, "Admins, audit log and settings")
framed(s, "25-admin-admins", (140, 220, 1140, 700), 0.6, 1.6, 3.9, label="Admins page")
framed(s, "26-admin-audit-logs", (140, 220, 1140, 700), 4.7, 1.6, 3.9, shadow=INK, label="Audit logs")
framed(s, "27-admin-settings", (140, 220, 1140, 700), 8.8, 1.6, 3.9, label="Settings")
for x, lab, d in [(0.6, "Admins", "Add admins and grant the on-chain manager role"), (4.7, "Audit logs", "Append-only: the database rejects edits"), (8.8, "Settings", "Fee collector, notice banner")]:
    text(s, x, 4.55, 3.9, 0.4, lab, size=16, bold=True, name="label")
    text(s, x, 5.0, 3.9, 0.8, d, size=14, name="note")
text(s, 0.6, 6.0, 12, 0.8, "The fee collector can be changed only on-chain by the contract's DEFAULT_ADMIN wallet, and only affects fees from then on.", size=15, name="note")
footer(s)
notes(s, "The fee collector address is read live from the contract. Users and disputes pages complete the dashboard.")

# 13 ---------------------------------------------------------------- themes
s = new_slide(dark=True)
title(s, "Five themes, one brand", "Brand green 28DF99 and black 262627 stay constant. The Theme menu is in the footer", dark=True)
names = [("01-home", "Paper (default)"), ("28-theme-sky", "Sky"), ("28-theme-mint", "Mint"), ("28-theme-ink", "Ink"), ("28-theme-terminal", "Terminal")]
w = 3.5
for i, (n, lab) in enumerate(names):
    col, row = i % 3, i // 3
    x = 0.6 + col * 3.85
    y = 1.85 + row * 2.6
    framed(s, n, (0, 0, 1440, 820), x, y, w, shadow=GREEN, label=f"Home page in the {lab} theme")
    text(s, x, y + 2.15, w, 0.3, lab, size=14, bold=True, color=WHITE, name="label")
text(s, 8.45, 4.5, 4.2, 1.9, "All text pairs were checked against WCAG AA contrast. Terminal is square and monospaced; Mint flips actions to black so they stay visible on green.", size=14, color="DADADF", name="note")
footer(s, dark=True)
notes(s, "Themes are CSS variables, so every component follows them. The choice is remembered per browser.")

# 14 ---------------------------------------------------------------- mobile
s = new_slide()
title(s, "Built to hold up on a phone", "No sideways scrolling at 375 px and 320 px; tables become cards")
for i, n in enumerate(["29-mobile-home", "30-mobile-explore", "31-mobile-market"]):
    framed(s, n, (0, 0, 780, 1500), 0.8 + i * 2.75, 1.85, 2.45, shadow=GREEN if i != 1 else INK, label=f"Phone layout: {n}")
points(s, 9.1, 2.0, 3.7, [
    ("Compact header.", "Logo, four links and the wallet button."),
    ("Board rows.", "Each market becomes a card with price, bid, ask and a liquidity bar."),
    ("Tap targets.", "At least 44 px."),
], size=15)
footer(s)
notes(s, "Screenshots were taken at 390 px wide with a 2x pixel ratio.")

# 15 ---------------------------------------------------------------- money rules
s = new_slide()
title(s, "Fees and the rules that cannot change")
stats = [("0.5%", "buyer fee"), ("0.5%", "seller fee"), ("0%", "cancel, listing, request, failed tx")]
for i, (big, lab) in enumerate(stats):
    x = 0.6 + i * 4.15
    box = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(1.5), Inches(3.9), Inches(1.7))
    box.name = f"stat {lab}"
    box.fill.solid()
    box.fill.fore_color.rgb = rgb(GREEN if i < 2 else PAPER)
    box.line.color.rgb = rgb(INK)
    box.line.width = Pt(2)
    text(s, x + 0.25, 1.65, 3.4, 0.9, big, size=48, bold=True, name="stat value")
    text(s, x + 0.25, 2.6, 3.4, 0.5, lab, size=14, name="stat label")
points(s, 0.6, 3.6, 12.1, [
    ("Fees are charged only on settled trades,", "in USDC, to 0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6. The rates are constants in the contract."),
    ("No role can withdraw or redirect escrow.", "Users always keep cancel, settle, default claim and refund paths."),
    ("Blocklisted wallets cannot block anyone else.", "Payouts that fail are held as claimable instead of reverting."),
    ("The chain is canonical.", "The database is rebuilt from events at any time."),
], size=16)
footer(s)
notes(s, "The fee collector can be changed only by the contract's DEFAULT_ADMIN, and the change affects future fees only.")

# 16 ---------------------------------------------------------------- status
s = new_slide(dark=True)
title(s, "Where it stands", dark=True)
text(s, 0.6, 1.5, 5.8, 0.4, "Working today", size=20, bold=True, color=GREEN, name="heading")
text(s, 0.6, 2.1, 5.8, 4.5, [
    "Contract deployed on Arc Testnet, with a settled end-to-end trade on the real chain",
    "API, indexer and PostgreSQL running at avantdex.xyz",
    "Five themes, market board, depth chart, admin dashboard",
    "All 55 backend tests pass",
], size=16, color=WHITE, name="done")
text(s, 6.9, 1.5, 5.8, 0.4, "Next", size=20, bold=True, color=GREEN, name="heading")
text(s, 6.9, 2.1, 5.8, 4.5, [
    "Grant the admin wallet the on-chain MARKET_MANAGER role so approved projects can open markets",
    "Seed labelled demo markets on testnet",
    "Independent audit and legal review before any mainnet use",
    "Mainnet deployment by the owner with their own wallet",
], size=16, color=WHITE, name="next")
text(s, 0.6, 6.45, 12, 0.4, "Follow @AvantDex on X: x.com/AvantDex", size=14, color="B8B8C0", name="contact")
footer(s, dark=True)
notes(s, "Mainnet is deliberately not configured. The contract is testnet software and has not been audited.")

prs.save(OUT)
print("saved", OUT, "slides:", N)
