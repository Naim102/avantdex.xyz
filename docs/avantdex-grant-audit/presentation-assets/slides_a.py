"""Slides 01 to 06: cover, problem, solution, product walkthrough, testnet evidence, how it works."""

from __future__ import annotations

from pathlib import Path

from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt

from deck_lib import (C, FONT, H, MONO, MX, W, background, chip, chrome, label, line, pic, rect, rgb, tb)

IMG = Path(__file__).resolve().parent / "img"


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def pyramid(slide, cx, base_y, base_w, height, n=5, gap=0.08, colors=("28DF99", "1C9E6C")):
    """Brand pyramid built from native shapes: a triangle and stacked trapezoids with thin gaps."""
    for i in range(n):
        y0 = i * height / n + gap / 2
        y1 = (i + 1) * height / n - gap / 2
        top_w = base_w * y0 / height
        bot_w = base_w * y1 / height
        top_y = base_y - height + y0
        h = y1 - y0
        col = colors[i % 2]
        if i == 0:
            s = rect(slide, cx - bot_w / 2, top_y, bot_w, h, fill=col, shape=MSO_SHAPE.ISOSCELES_TRIANGLE)
        else:
            s = rect(slide, cx - bot_w / 2, top_y, bot_w, h, fill=col, shape=MSO_SHAPE.TRAPEZOID)
            s.adjustments[0] = ((bot_w - top_w) / 2) / min(bot_w, h)


# ----------------------------------------------------------------------------- 01 cover


def s01(prs):
    s = _blank(prs)
    background(s, C["ink"])
    pic(s, IMG / "logo-rounded.png", 0.9, 0.8, h=0.95, border=False, alt="AvantDex logo")
    tb(s, 2.05, 0.8, 4.0, 0.95, [{"text": "AvantDex", "size": 26, "bold": True, "color": C["white"]}], anchor="m")
    tb(s, 0.9, 2.45, 7.6, 1.9, [{"text": "Structured Pre-Market\nTrading on Arc", "size": 46, "bold": True,
                                 "color": C["white"]}], spacing=0.95)
    tb(s, 0.9, 4.4, 6.9, 0.9, [{"text": "An on-chain order book for tokens that have not launched yet. "
                                "Funds sit in USDC escrow until the token is delivered.", "size": 18,
                                "color": C["on_dark"]}])
    rect(s, 0.9, 5.55, 0.9, 0.05, fill=C["mint"])
    tb(s, 0.9, 5.75, 6, 0.35, [{"text": "Circle Grant Presentation", "size": 16, "bold": True, "color": C["mint"]}])
    tb(s, 0.9, 6.1, 6, 0.35, [{"text": "November 2026", "size": 16, "color": C["on_dark"]}])
    lk = tb(s, 0.9, 6.45, 2.2, 0.35, [{"runs": [("avantdex.xyz", {"underline": True})], "size": 16, "bold": True,
                                        "color": C["white"]}])
    lk.click_action.hyperlink.address = "https://avantdex.xyz/"
    pyramid(s, 10.3, 6.1, 3.9, 4.2)
    tb(s, 8.3, 6.45, 4.4, 0.6, [{"text": "Arc Testnet  ·  Not audited\nData snapshot dated 21 November 2026",
                                 "size": 10.5, "color": C["soft"], "align": "r"}])
    return s


# ----------------------------------------------------------------------------- 02 problem


def s02(prs):
    s = _blank(prs)
    chrome(s, 2, "The problem", "Before a token launches, trading has no enforceable settlement",
           "Source: R&D.md section 4, audit docs 09 and 10. No market-size or volume statistics are claimed; the project did not collect any from primary sources.")
    # left: how it works today
    tb(s, MX, 1.75, 5.4, 0.3, [{"text": "HOW PRE-LAUNCH TRADES HAPPEN TODAY", "size": 10.5, "bold": True,
                                "color": C["muted"]}])
    for x, name in ((0.8, "Buyer"), (4.75, "Seller")):
        label(s, x, 2.75, 1.15, 1.15, name, fill=C["white"], line=C["line_d"], lw=1.25, size=14, bold=True,
              shape=MSO_SHAPE.OVAL)
    label(s, 2.2, 2.45, 2.35, 1.75, [{"text": "Private chats and spreadsheets", "size": 13, "bold": True},
                                     {"text": "Promises, screenshots, trust", "size": 11.5, "color": C["muted"]}],
          fill=C["grey_t"], line=C["line_d"], radius=0.12)
    line(s, 1.95, 3.32, 2.2, 3.32, color=C["line_d"], w=1.5, head=True)
    line(s, 4.55, 3.32, 4.75, 3.32, color=C["line_d"], w=1.5, head=True)
    for i, t in enumerate(("No escrow", "No delivery guarantee", "No public price", "No listing check")):
        label(s, 0.8 + (i % 2) * 2.5, 4.55 + (i // 2) * 0.55, 2.35, 0.42, [{"text": t, "size": 12, "bold": True,
              "color": C["red_d"]}], fill=C["red_t"], radius=0.21)
    # right: four problems and the answer
    items = [
        ("Fragmented price discovery", "Prices are agreed in OTC chats and spreadsheets, so there is no shared reference.",
         "AvantDex: one public on-chain order book per market"),
        ("Counterparty risk", "A seller can promise tokens and vanish. A buyer can refuse to pay.",
         "AvantDex: both sides lock USDC when a trade is matched"),
        ("Opaque rules", "Nobody can verify who holds the funds or what happens if a launch is delayed or cancelled.",
         "AvantDex: exits are written in the contract: settle, default, refund"),
        ("Listing quality", "Anyone can claim that a token will exist.",
         "AvantDex: approval, verification and activation are separate steps"),
    ]
    y = 1.75
    for i, (lead, text, ans) in enumerate(items):
        tb(s, 6.75, y, 0.45, 0.45, [{"text": f"{i + 1}", "size": 20, "bold": True, "color": C["mint_d"]}])
        tb(s, 7.25, y + 0.02, 5.4, 1.1, [
            {"text": lead, "size": 15, "bold": True, "space_after": 2},
            {"text": text, "size": 12.5, "color": C["muted"], "space_after": 3},
            {"text": ans, "size": 12, "bold": True, "color": C["mint_d"]},
        ])
        if i < 3:
            line(s, 6.75, y + 1.12, 12.68, y + 1.12, color=C["line"], w=0.75)
        y += 1.2
    return s


# ----------------------------------------------------------------------------- 03 solution


def s03(prs):
    s = _blank(prs)
    chrome(s, 3, "The solution", "AvantDex locks both sides in USDC and releases funds by rule",
           "Source: contracts/AvantdexExchange.sol (placeOrder, _match, settleTrade, claimDefault, refundTrade); audit docs 03 and 04. V = trade value, f = 0.5% fee.")
    steps = [
        ("1", "List and activate", "A project is reviewed. A manager creates the market on-chain and activates it."),
        ("2", "Post orders", "Buyer locks price × lots plus a 0.5% fee reserve. Seller locks collateral equal to the value."),
        ("3", "Match", "A taker names resting orders. Trades fill at the maker's price, partial fills allowed."),
        ("4", "Escrow", "Each trade holds 2V + f in USDC. No role can move it."),
    ]
    x = MX
    bw, gap = 2.15, 0.3
    for n, head, body in steps:
        rect(s, x, 1.9, bw, 2.25, fill=C["white"], line=C["line"], radius=0.1)
        label(s, x + 0.2, 2.1, 0.44, 0.44, n, fill=C["mint"], size=14, bold=True, shape=MSO_SHAPE.OVAL)
        tb(s, x + 0.2, 2.65, bw - 0.4, 0.4, [{"text": head, "size": 16, "bold": True}])
        tb(s, x + 0.2, 3.05, bw - 0.4, 1.05, [{"text": body, "size": 12, "color": C["muted"]}])
        line(s, x + bw, 3.02, x + bw + gap, 3.02, color=C["mint_d"], w=1.75, head=True)
        x += bw + gap
    # outcomes
    tb(s, x, 1.62, 2.3, 0.26, [{"text": "THEN, EXACTLY ONE EXIT", "size": 10, "bold": True, "color": C["muted"]}])
    outs = [("Settle", "Token for USDC, in one transaction", "implemented"),
            ("Default", "Buyer claims payment and collateral", "risk"),
            ("Refund", "Market cancelled: both sides get funds back", "planned")]
    oy = 1.9
    for head, body, kind in outs:
        fill = {"implemented": C["mint_t"], "risk": C["amber_t"], "planned": C["slate_t"]}[kind]
        txt = {"implemented": C["mint_d"], "risk": C["amber_d"], "planned": C["slate"]}[kind]
        label(s, x, oy, 12.68 - x, 0.69, [{"text": head, "size": 13, "bold": True, "color": txt},
                                         {"text": body, "size": 10.5, "color": C["ink"]}],
              fill=fill, radius=0.08, align="l", margin=(0.12, 0.02, 0.06, 0.02))
        oy += 0.78
    # actors band
    tb(s, MX, 4.5, 3, 0.26, [{"text": "WHO ACTS", "size": 10, "bold": True, "color": C["muted"]}])
    who = ["Project team, manager", "Buyers and sellers", "Either side as taker", "Exchange contract on Arc"]
    x = MX
    for t in who:
        label(s, x, 4.8, bw, 0.4, [{"text": t, "size": 11.5, "color": C["ink"]}], fill=C["grey_t"], radius=0.2)
        x += bw + gap
    label(s, MX, 5.55, W - 2 * MX, 0.8, [{"runs": [("Rules enforced by the contract:  ", {"bold": True}),
          ("fees are charged only when a trade settles (0.5% buyer, 0.5% seller). Orders can be cancelled at any time. "
           "Cancel, settle, default and refund stay open even when the contract is paused.", {})], "size": 12.5}],
          fill=C["mint_t"], radius=0.08, align="l", margin=(0.2, 0.05, 0.2, 0.05))
    return s


# ----------------------------------------------------------------------------- 04 walkthrough


def s04(prs):
    s = _blank(prs)
    chrome(s, 4, "Product walkthrough", "A working product: explore, order, escrow, settle",
           "Screens 1 and 2: avantdex.xyz captured 21 Nov 2026 (Arc Testnet). Screen 3: repository screenshot from the local dev stack with demo data (docs/screenshots/14), earlier theme; not live data.")
    names = ["Explore a market", "Select an order", "Approve USDC", "Place an order", "Wait for matching", "Settle or refund"]
    cw = (W - 2 * MX) / 6
    for i, nm in enumerate(names):
        x = MX + i * cw
        label(s, x, 1.75, 0.44, 0.44, str(i + 1), fill=C["mint"], size=13, bold=True, shape=MSO_SHAPE.OVAL)
        tb(s, x + 0.52, 1.75, cw - 0.6, 0.44, [{"text": nm, "size": 12.5, "bold": True}], anchor="m")
    ih = 2.8
    y = 2.45
    x = MX
    specs = [
        ("live-explore.png", "1   Explore markets", "Live site, 21 Nov 2026", "implemented",
         "Explore page on avantdex.xyz: board of four testnet markets"),
        ("live-market.png", "2   Open a market, read the book", "Live site, 21 Nov 2026", "implemented",
         "Market page with order book, depth chart and trade panel"),
        ("demo-trade-panel.png", "3 + 4   Approve, then order", "Local dev stack, demo data", "partial",
         "Trade panel: limit or market order, price, quantity and expiry"),
    ]
    for fname, cap, tag, kind, alt in specs:
        _, w, _h = pic(s, IMG / fname, x, y, h=ih, alt=alt)
        tb(s, x, y + ih + 0.1, min(max(w, 3.2), 12.68 - x), 0.3, [{"text": cap, "size": 12.5, "bold": True}])
        chip(s, x, y + ih + 0.46, min(2.15, w), 0.28, tag, kind=kind, size=9.5)
        x += w + 0.5
    tb(s, MX, 6.1, W - 2 * MX, 0.4, [{"runs": [("5 + 6  ", {"bold": True, "color": C["mint_d"]}),
       ("Matching and the outcome show up as trade statuses (Open, Settled, Defaulted, Refunded) on the market page "
        "and in the Portfolio.", {})], "size": 12, "color": C["muted"]}])
    return s


# ----------------------------------------------------------------------------- 05 evidence


def s05(prs):
    s = _blank(prs)
    chrome(s, 5, "Product execution", "The full order lifecycle has run on Arc Testnet",
           "Sources: on-chain reads and avantdex.xyz/api/stats and /api/trades/recent, 21 Nov 2026; audit docs 03 and 13 section 2. Amounts are test USDC.")
    chip(s, MX, 1.72, 3.6, 0.32, "Arc Testnet snapshot · 21 November 2026", fill=C["ink"], color=C["white"], size=11)
    tiles = [("4", "markets"), ("15", "orders"), ("4", "trades")]
    x = MX
    for big, small in tiles:
        rect(s, x, 2.25, 1.9, 1.15, fill=C["white"], line=C["line"], radius=0.08)
        tb(s, x + 0.2, 2.3, 1.5, 0.7, [{"text": big, "size": 34, "bold": True}], anchor="m")
        tb(s, x + 0.2, 2.98, 1.5, 0.3, [{"text": small, "size": 12, "color": C["muted"]}])
        x += 2.1
    tb(s, MX, 3.6, 6.1, 0.3, [{"text": "Trades by on-chain status", "size": 12, "bold": True}])
    cd = CategoryChartData()
    cd.categories = ["Settled", "Refunded", "Open"]
    cd.add_series("Trades", (1, 1, 2))
    gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(MX), Inches(3.9), Inches(6.1), Inches(2.6), cd)
    ch = gf.chart
    ch.has_legend = False
    ch.has_title = False
    ch.font.size = Pt(12)
    ch.font.name = FONT
    ch.font.color.rgb = rgb(C["ink"])
    va = ch.value_axis
    va.visible = False
    va.has_major_gridlines = False
    va.minimum_scale = 0
    va.maximum_scale = 3
    ca = ch.category_axis
    ca.format.line.color.rgb = rgb(C["line_d"])
    ca.tick_labels.font.size = Pt(12)
    plot = ch.plots[0]
    plot.gap_width = 90
    plot.has_data_labels = True
    dl = plot.data_labels
    dl.font.size = Pt(16)
    dl.font.bold = True
    dl.position = XL_LABEL_POSITION.OUTSIDE_END
    dl.number_format = "0"
    dl.number_format_is_linked = False
    for i, col in enumerate((C["mint"], C["slate"], C["amber"])):
        pt = plot.series[0].points[i]
        pt.format.fill.solid()
        pt.format.fill.fore_color.rgb = rgb(col)
    # right: evidence rows
    rx, rw = 7.25, W - MX - 7.25
    rows = [
        ("Exchange contract (v2)", "0xb48935EeA3B7264a53098B1DB920C3fCa09C0283", True),
        ("Deployed at block", "71,711,143", True),
        ("Settlement proof", "TradeSettled for trade 2, block 71,729,618", False),
        ("Values", "Settled 12.0 USDC, refunded 10.5 USDC, fees 0.06 + 0.06 USDC", False),
        ("Escrow held by the contract", "84.449 USDC (testnet)", False),
        ("Indexer", "Lag 0 at block 73,366,759", False),
    ]
    y = 1.75
    for lab, val, mono in rows:
        tb(s, rx, y, rw, 0.25, [{"text": lab.upper(), "size": 9.5, "bold": True, "color": C["muted"]}])
        tb(s, rx, y + 0.24, rw, 0.4, [{"text": val, "size": 11.5 if mono and len(val) > 30 else 13,
                                       "font": MONO if mono else FONT, "color": C["ink"]}])
        line(s, rx, y + 0.68, rx + rw, y + 0.68, color=C["line"], w=0.75)
        y += 0.72
    label(s, rx, 6.12, rw, 0.45, [{"runs": [("Testnet activity, 4 trades among 4 wallets. ", {"bold": True}),
          ("Not production traction or external-user adoption.", {})], "size": 11.5}],
          fill=C["amber_t"], radius=0.06, align="l", margin=(0.15, 0.02, 0.1, 0.02))
    return s


# ----------------------------------------------------------------------------- 06 how it works


def s06(prs):
    s = _blank(prs)
    chrome(s, 6, "How it works", "One trade, end to end: lock, match, escrow, then exactly one exit",
           "Source: AvantdexExchange.sol (placeOrder 396, settleTrade 479, claimDefault 509, refundTrade 525); indexer in backend/app/indexer/worker.py. V = value, f = 0.5% fee.")
    cols = {"buyer": (MX, 3.7), "contract": (4.85, 3.65), "seller": (9.0, 3.68)}
    heads = {"buyer": "Buyer", "contract": "Exchange contract on Arc", "seller": "Seller"}
    for k, (x, w) in cols.items():
        label(s, x, 1.72, w, 0.38, [{"text": heads[k], "size": 12.5, "bold": True,
                                     "color": C["white"] if k != "contract" else C["ink"]}],
              fill=C["ink"] if k != "contract" else C["mint"], radius=0.19)
    rows_y = [2.3, 3.2, 4.1, 5.0]
    bh = 0.78

    def box(col, r, num, text, kind="plain"):
        x, w = cols[col]
        fill = C["white"] if kind == "plain" else C["mint_t"]
        runs = [(num + "  ", {"bold": True, "color": C["mint_d"]})] if num else []
        runs.append((text, {}))
        label(s, x, rows_y[r], w, bh, [{"runs": runs, "size": 11.5}], fill=fill, line=C["line"], radius=0.08,
              align="l", margin=(0.14, 0.03, 0.1, 0.03))

    def note(col, r, text):
        x, w = cols[col]
        tb(s, x, rows_y[r], w, bh, [{"text": text, "size": 11, "color": C["soft"], "align": "c"}], anchor="m")

    box("buyer", 0, "1", "Places a buy order. Locks price × lots plus a 0.5% fee reserve.")
    box("contract", 0, "", "Holds both locks. Resting orders live on-chain.", "key")
    box("seller", 0, "1", "Places a sell order. Locks collateral equal to the trade value.")
    note("buyer", 1, "Buyer or seller can be the taker")
    box("contract", 1, "2", "Taker names resting orders. Fills at the maker's price. Each trade escrows 2V + f.", "key")
    note("seller", 1, "Partial fills are supported")
    note("buyer", 2, "Waits for the deadline")
    box("contract", 2, "3", "After the launch a manager opens settlement: token address and a 1 hour to 14 day window.", "key")
    box("seller", 2, "", "Approves the token for the exchange.")
    box("buyer", 3, "4a", "After the deadline: claimDefault pays 2V + f (payment, fee reserve, collateral).")
    box("contract", 3, "4", "One exit per trade: Settled, Defaulted or Refunded. No role can move escrow.", "key")
    box("seller", 3, "4b", "settleTrade: token goes to the buyer, checked by balance change. Seller receives 2V − f.")
    # arrows
    cx = cols["contract"][0] + cols["contract"][1] / 2
    line(s, cols["buyer"][0] + cols["buyer"][1], rows_y[0] + bh / 2, cols["contract"][0], rows_y[0] + bh / 2, color=C["mint_d"], w=1.5, head=True)
    line(s, cols["seller"][0], rows_y[0] + bh / 2, cols["contract"][0] + cols["contract"][1], rows_y[0] + bh / 2, color=C["mint_d"], w=1.5, head=True)
    for r in range(3):
        line(s, cx, rows_y[r] + bh, cx, rows_y[r + 1], color=C["mint_d"], w=1.5, head=True)
    sx = cols["seller"][0] + cols["seller"][1] / 2
    line(s, sx, rows_y[2] + bh, sx, rows_y[3], color=C["line_d"], w=1.25, head=True)
    bx = cols["buyer"][0] + cols["buyer"][1] / 2
    line(s, bx, rows_y[2] + bh, bx, rows_y[3], color=C["line_d"], w=1.25, head=True)
    line(s, cols["buyer"][0] + cols["buyer"][1], rows_y[3] + bh / 2, cols["contract"][0], rows_y[3] + bh / 2, color=C["mint_d"], w=1.5, head=True)
    line(s, cols["seller"][0], rows_y[3] + bh / 2, cols["contract"][0] + cols["contract"][1], rows_y[3] + bh / 2, color=C["mint_d"], w=1.5, head=True)
    label(s, MX, 5.98, W - 2 * MX, 0.55, [{"runs": [("Indexer (off-chain):  ", {"bold": True}),
          ("copies every contract event into PostgreSQL, re-reads state at the processed block, and feeds the order book, "
           "portfolio and notifications. The chain stays canonical.", {})], "size": 11.5}],
          fill=C["slate_t"], radius=0.08, align="l", margin=(0.2, 0.03, 0.2, 0.03))
    return s
