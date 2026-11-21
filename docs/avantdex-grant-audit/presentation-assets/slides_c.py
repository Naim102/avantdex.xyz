"""Slides 13 to 18: market and business model, milestones, funding, team, summary, closing."""

from __future__ import annotations

import datetime as dt

from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt

from deck_lib import (C, FONT, H, MONO, MX, W, background, chip, chrome, label, line, pic, rect, rgb, tb)
from slides_a import IMG, pyramid


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


# ----------------------------------------------------------------------------- 13 market and business model


def s13(prs):
    s = _blank(prs)
    chrome(s, 13, "Market and business model", "Fees come only from settled trades; demand is not yet evidenced",
           "Source: audit doc 09 (R&D.md section 6.1: competitor read from public docs on 2026-11-03, to be re-verified), AvantdexExchange.sol constants, README.md fee table. All business-model figures are proposals.")
    tb(s, MX, 1.7, 7.2, 0.28, [{"text": "AVANTDEX VS THE ONE COMPETITOR THE PROJECT RESEARCHED (WHALES MARKET, PUBLIC DOCS)",
                                "size": 9.5, "bold": True, "color": C["muted"]}])
    cols = [(MX, 1.55, ""), (2.25, 2.45, "Whales Market, per its docs"), (4.8, 3.05, "AvantDex, verified in the audit")]
    y = 2.0
    for x, w, t in cols:
        tb(s, x, y, w, 0.3, [{"text": t, "size": 10.5, "bold": True, "color": C["muted"]}])
    line(s, MX, 2.3, 7.85, 2.3, color=C["line_d"], w=1)
    rows = [
        ("Delivery proof", "Seller sends tokens and posts a transaction hash", "Atomic swap; buyer's balance change checked on chain"),
        ("Fees", "Percentage fees on settlement and resale (pages disagreed)", "0.5% + 0.5%, settled trades only; no resale"),
        ("Cross-chain", "Supported via LayerZero", "Not supported; Arc-only listings"),
        ("Admin power over funds", "Not assessed", "None by design: no function reaches escrow"),
    ]
    y = 2.38
    for a, b, c in rows:
        tb(s, MX, y, 1.55, 0.62, [{"text": a, "size": 12, "bold": True}], anchor="m")
        tb(s, 2.25, y, 2.45, 0.62, [{"text": b, "size": 11, "color": C["muted"]}], anchor="m")
        tb(s, 4.8, y, 3.05, 0.62, [{"text": c, "size": 11}], anchor="m")
        line(s, MX, y + 0.66, 7.85, y + 0.66, color=C["line"], w=0.75)
        y += 0.72
    tb(s, MX, 5.35, 3.4, 0.25, [{"text": "WHO IT SERVES", "size": 9.5, "bold": True, "color": C["muted"]}])
    tb(s, MX, 5.62, 7.2, 0.55, [{"text": "Pre-launch traders (buyers and early holders), project teams who list a token with a TGE date or TBD, "
                                 "community members who request listings, and admins.", "size": 11.5, "color": C["ink"]}])
    label(s, MX, 6.15, 7.2, 0.4, [{"runs": [("Market size: not estimated. ", {"bold": True}),
          ("The project collected no primary-source figures. [FOUNDER INPUT: first-party demand evidence]", {})], "size": 11}],
          fill=C["amber_t"], radius=0.06, align="l", margin=(0.15, 0.02, 0.1, 0.02))
    # right: revenue model
    rx = 8.35
    tb(s, rx, 1.7, 4.3, 0.28, [{"text": "REVENUE MODEL (PROPOSED)", "size": 9.5, "bold": True, "color": C["muted"]}])
    label(s, rx, 2.1, 1.9, 0.5, [{"text": "Buyer 0.5%", "size": 12.5, "bold": True}], fill=C["mint_t"], radius=0.08)
    label(s, rx, 2.7, 1.9, 0.5, [{"text": "Seller 0.5%", "size": 12.5, "bold": True}], fill=C["mint_t"], radius=0.08)
    line(s, rx + 1.9, 2.35, rx + 2.4, 2.7, color=C["mint_d"], w=1.5)
    line(s, rx + 1.9, 2.95, rx + 2.4, 2.7, color=C["mint_d"], w=1.5, head=True)
    label(s, rx + 2.4, 2.4, 1.93, 0.6, [{"text": "Fee collector", "size": 12.5, "bold": True, "color": C["white"]},
                                        {"text": "in USDC", "size": 10.5, "color": C["on_dark"]}], fill=C["ink"], radius=0.08)
    tb(s, rx, 3.4, 4.33, 0.95, [
        {"text": "Charged only when a trade settles.", "size": 12, "bold": True, "space_after": 3},
        {"text": "0% on listing, order cancellation, default, refund and failed transactions.", "size": 11.5, "color": C["muted"]},
    ])
    label(s, rx, 4.35, 4.33, 0.62, [{"text": "1,000 USDC settled gives 10 USDC in fees. Arithmetic, not a forecast.",
                                     "size": 11.5}], fill=C["grey_t"], radius=0.08, align="l", margin=(0.15, 0.02, 0.1, 0.02))
    tb(s, rx, 5.15, 4.33, 0.25, [{"text": "EXPANSION OPTIONS (NOT COMMITTED)", "size": 9.5, "bold": True, "color": C["muted"]}])
    tb(s, rx, 5.42, 4.33, 1.1, [
        {"text": "Deposit-balance contract: Gateway or CCTP-hook funding", "size": 11, "bullet": True, "space_after": 2},
        {"text": "EURC-priced markets; agent-facing data API", "size": 11, "bullet": True, "space_after": 2},
        {"text": "Running costs and break-even volume: [FOUNDER INPUT]", "size": 11, "bullet": True, "bold": True,
         "bullet_color": C["amber_d"], "color": C["amber_d"]},
    ])
    return s


# ----------------------------------------------------------------------------- 14 milestones


def s14(prs):
    s = _blank(prs)
    chrome(s, 14, "Roadmap and milestones", "Five milestones; mainnet only after the independent audit passes",
           "Source: audit doc 11 sections 2, 3, 4 and 7 (proposed Plan A, assumes work starts about 7 Dec 2026) and src/lib/roadmap.ts (published targets). Dates are plans and can move.")
    d0 = dt.date(2026, 12, 1)
    ax0, ax1 = 3.45, 12.68
    span = (dt.date(2027, 5, 1) - d0).days
    px = (ax1 - ax0) / span

    def X(d):
        return ax0 + (d - d0).days * px

    months = [(dt.date(2026, 12, 1), "Dec 2026"), (dt.date(2027, 1, 1), "Jan 2027"), (dt.date(2027, 2, 1), "Feb 2027"),
              (dt.date(2027, 3, 1), "Mar 2027"), (dt.date(2027, 4, 1), "Apr 2027")]
    for d, t in months:
        line(s, X(d), 2.1, X(d), 5.3, color=C["line"], w=0.75)
        tb(s, X(d) + 0.05, 1.75, 1.5, 0.28, [{"text": t, "size": 10.5, "bold": True, "color": C["muted"]}])
    line(s, X(dt.date(2027, 5, 1)), 2.1, X(dt.date(2027, 5, 1)), 5.3, color=C["line"], w=0.75)
    step = 0.52
    rows = [
        ("M1", "Circle integrations on testnet", dt.date(2026, 12, 7), dt.date(2026, 12, 28), C["mint"]),
        ("M2", "Security hardening, CI, backup, LICENSE", dt.date(2026, 12, 7), dt.date(2027, 1, 8), C["mint"]),
        ("M3", "Contract v3, H-1 fix, multisig, timelock, audit freeze", dt.date(2027, 1, 4), dt.date(2027, 1, 29), C["slate"]),
        ("M4", "Independent audit and fixes", dt.date(2027, 2, 1), dt.date(2027, 3, 19), C["slate"]),
        ("M5", "Mainnet deployment", None, None, C["amber"]),
        ("", "Controlled beta, then public beta", None, None, C["amber"]),
    ]
    ys = {}
    for i, (tag, name, a, b, col) in enumerate(rows):
        y = 2.2 + i * step
        ys[i] = y
        tb(s, MX, y - 0.05, 0.5, 0.46, [{"text": tag, "size": 13, "bold": True, "color": C["mint_d"]}], anchor="m", check=False)
        tb(s, MX + 0.5, y - 0.05, 2.3, 0.46, [{"text": name, "size": 10.5}], anchor="m")
        if a:
            label(s, X(a), y, X(b) - X(a), 0.36, "", fill=col, radius=0.18, check=False)
    # M5 rows
    dm = X(dt.date(2027, 3, 31))
    label(s, dm - 0.17, ys[4] + 0.01, 0.34, 0.34, "", fill=C["amber"], shape=MSO_SHAPE.DIAMOND, check=False)
    tb(s, dm + 0.25, ys[4], 2.2, 0.36, [{"text": "target 31 Mar 2027", "size": 10, "color": C["amber_d"]}], anchor="m", check=False)
    label(s, X(dt.date(2027, 4, 1)), ys[5], X(dt.date(2027, 4, 15)) - X(dt.date(2027, 4, 1)), 0.36, "", fill=C["amber"], radius=0.18, check=False)
    label(s, X(dt.date(2027, 4, 16)), ys[5], X(dt.date(2027, 4, 30)) - X(dt.date(2027, 4, 16)), 0.36, "", fill="F7D79A", radius=0.18, check=False)
    tb(s, X(dt.date(2027, 4, 1)) - 1.75, ys[5], 1.65, 0.36, [{"text": "15 Apr, then 30 Apr", "size": 10, "color": C["amber_d"], "align": "r"}],
       anchor="m", check=False)
    # gate: from the end of the audit down to mainnet
    gx = X(dt.date(2027, 3, 19))
    line(s, gx, ys[3] + 0.36, gx, ys[4] + 0.18, color=C["red_d"], w=1.5, dash=True)
    line(s, gx, ys[4] + 0.18, dm - 0.2, ys[4] + 0.18, color=C["red_d"], w=1.5, dash=True, head=True)
    chip(s, gx + 0.12, ys[3] + 0.05, 2.35, 0.27, "Gate: audit clean? No pass, no mainnet", fill=C["red_t"], color=C["red_d"], size=9.5)
    # published targets
    tb(s, MX, 5.42, 2.8, 0.26, [{"text": "PUBLISHED ROADMAP TARGETS", "size": 9.5, "bold": True, "color": C["muted"]}])
    line(s, ax0, 5.82, ax1, 5.82, color=C["line_d"], w=1)
    for d, t in [(dt.date(2027, 2, 28), "28 Feb\naudit"), (dt.date(2027, 3, 31), "31 Mar\nmainnet"),
                 (dt.date(2027, 4, 15), "15 Apr\ncontrolled beta"), (dt.date(2027, 4, 30), "30 Apr\npublic beta")]:
        label(s, X(d) - 0.07, 5.75, 0.14, 0.14, "", fill=C["slate"], shape=MSO_SHAPE.OVAL, check=False)
        tb(s, X(d) - 0.55, 5.92, 1.1, 0.4, [{"text": t, "size": 9.5, "color": C["slate"], "align": "c"}], check=False)
    tb(s, MX, 5.75, 2.7, 0.7, [{"text": "Plan A moves audit completion from 28 Feb to about mid-March.", "size": 10, "color": C["muted"]}])
    tb(s, ax0, 6.32, ax1 - ax0, 0.3, [{"text": "If no auditor can start in early February, every later date slips by the same delay.",
                                       "size": 10.5, "color": C["muted"], "align": "r"}], check=False)
    return s


# ----------------------------------------------------------------------------- 15 funding


def s15(prs):
    s = _blank(prs)
    chrome(s, 15, "Funding request", "Recommended request: $20,000 to $25,000 USDC, released by milestone",
           "Source: audit doc 11 section 6 (Scenario B) and doc 10 section K. Proposed budget, not vendor quotes. The audit's full price is unknown: the grant co-funds it and the founders cover any excess. [FOUNDER INPUT: quotes]")
    cats = [
        ("Engineering: Circle integrations, hardening", 6000, 6000, C["mint"]),
        ("Contract v3, tests, Arc Foundry", 5000, 5500, C["slate"]),
        ("Independent audit co-funding", 5000, 9000, C["amber"]),
        ("Infrastructure, 6 months", 1500, 1500, C["grey_d"]),
        ("Legal: terms, risk text, jurisdictions", 2000, 2500, "7FA6D9"),
        ("Mainnet launch ops, contingency", 500, 500, C["line_d"]),
    ]
    cd = CategoryChartData()
    cd.categories = [c[0] for c in cats]
    cd.add_series("Proposed allocation, $25,000 case", [c[2] for c in cats])
    gf = s.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, Inches(MX), Inches(1.8), Inches(3.9), Inches(3.9), cd)
    ch = gf.chart
    ch.has_legend = False
    ch.has_title = False
    ch.font.name = FONT
    plot = ch.plots[0]
    plot.has_data_labels = False
    for i, c in enumerate(cats):
        pt = plot.series[0].points[i]
        pt.format.fill.solid()
        pt.format.fill.fore_color.rgb = rgb(c[3])
        pt.format.line.color.rgb = rgb(C["bg"])
        pt.format.line.width = Pt(1.5)
    hs = plot._element.find("{http://schemas.openxmlformats.org/drawingml/2006/chart}holeSize")
    if hs is not None:
        hs.set("val", "62")
    tb(s, MX + 1.0, 3.2, 1.9, 0.5, [{"text": "$25,000", "size": 22, "bold": True, "align": "c"}], anchor="m", check=False)
    tb(s, MX + 1.0, 3.68, 1.9, 0.3, [{"text": "upper case", "size": 10.5, "color": C["muted"], "align": "c"}], check=False)
    # table
    tx = 4.85
    tb(s, tx, 1.75, 2.9, 0.28, [{"text": "USE OF FUNDS (PROPOSED, USDC)", "size": 9.5, "bold": True, "color": C["muted"]}])
    tb(s, 7.75, 1.75, 0.9, 0.28, [{"text": "$20,000", "size": 10.5, "bold": True, "color": C["muted"], "align": "r"}])
    tb(s, 8.65, 1.75, 0.9, 0.28, [{"text": "$25,000", "size": 10.5, "bold": True, "color": C["muted"], "align": "r"}])
    line(s, tx, 2.05, 9.55, 2.05, color=C["line_d"], w=1)
    y = 2.12
    for name, lo, hi, col in cats:
        rect(s, tx, y + 0.16, 0.14, 0.14, fill=col, shape=MSO_SHAPE.OVAL)
        tb(s, tx + 0.25, y, 2.75, 0.46, [{"text": name, "size": 11}], anchor="m")
        tb(s, 7.75, y, 0.9, 0.46, [{"text": f"${lo:,}", "size": 11.5, "font": MONO, "align": "r"}], anchor="m")
        tb(s, 8.65, y, 0.9, 0.46, [{"text": f"${hi:,}", "size": 11.5, "font": MONO, "align": "r"}], anchor="m")
        line(s, tx, y + 0.49, 9.55, y + 0.49, color=C["line"], w=0.75)
        y += 0.53
    tb(s, tx + 0.25, y, 2.75, 0.4, [{"text": "Total", "size": 12, "bold": True}], anchor="m")
    tb(s, 7.75, y, 0.9, 0.4, [{"text": "$20,000", "size": 11.5, "font": MONO, "bold": True, "align": "r"}], anchor="m")
    tb(s, 8.65, y, 0.9, 0.4, [{"text": "$25,000", "size": 11.5, "font": MONO, "bold": True, "align": "r"}], anchor="m")
    # tranches
    px = 9.95
    tb(s, px, 1.75, 2.7, 0.28, [{"text": "RELEASED BY MILESTONE (PROPOSED)", "size": 9.5, "bold": True, "color": C["muted"]}])
    ty = 2.15
    for m, pct in (("M1", 20), ("M2", 15), ("M3", 30), ("M4", 20), ("M5", 15)):
        tb(s, px, ty, 0.5, 0.36, [{"text": m, "size": 12, "bold": True, "color": C["mint_d"]}], anchor="m")
        rect(s, px + 0.5, ty + 0.05, 1.55 * pct / 30, 0.26, fill=C["mint"], radius=0.05)
        tb(s, px + 0.58 + 1.55 * pct / 30, ty, 0.6, 0.36, [{"text": f"{pct}%", "size": 11.5, "font": MONO}], anchor="m")
        ty += 0.46
    tb(s, px, 4.55, 2.7, 0.95, [{"text": "Payments are released as milestones are met and approved, as Circle's process describes.",
                                 "size": 10.5, "color": C["muted"]}])
    label(s, MX, 5.78, W - 2 * MX, 0.78, [
        {"runs": [("Alternatives, not the primary ask.  ", {"bold": True}),
                  ("A, Lean MVP: $10,000 for M1 and M2 only.  C, Ecosystem expansion: $50,000 to $100,000, to apply for only after "
                   "external users and pilots exist; Circle says awards of $25,000 or more need demonstrated traction.", {})],
         "size": 11.5}], fill=C["grey_t"], radius=0.08, align="l", margin=(0.2, 0.04, 0.2, 0.04))
    return s


# ----------------------------------------------------------------------------- 16 team


def s16(prs):
    s = _blank(prs)
    chrome(s, 16, "Team and execution", "Team and ownership: what is documented, and what the founders must add",
           "Source: audit docs 10 section L and 13 section 5, git log (34 commits), on-chain role reads of 21 Nov 2026. No names, bios or credentials are invented.")
    tb(s, MX, 1.72, 5.8, 0.28, [{"text": "DOCUMENTED AND VERIFIABLE TODAY", "size": 9.5, "bold": True, "color": C["muted"]}])
    left = [
        ("Product", "AvantDex, avantdex.xyz, X account @AvantDex"),
        ("Build record", "34 commits from 1 to 18 Nov 2026, two git contributors"),
        ("Shipped", "Contract v2 on Arc Testnet, web app, API, indexer, admin dashboard, 15 documents"),
        ("Tests (recorded)", "66 contract and 88 backend tests, UI test 33 steps; not re-run in the audit"),
        ("On-chain control", "Admin, manager and pauser roles on one wallet, 0x3788…9baE9"),
    ]
    y = 2.05
    for a, b in left:
        tb(s, MX, y, 1.6, 0.6, [{"text": a, "size": 11.5, "bold": True}], anchor="m")
        tb(s, MX + 1.65, y, 4.2, 0.6, [{"text": b, "size": 11.5, "color": C["muted"]}], anchor="m")
        line(s, MX, y + 0.64, MX + 5.85, y + 0.64, color=C["line"], w=0.75)
        y += 0.7
    tb(s, 7.0, 1.72, 5.6, 0.28, [{"text": "FOUNDER INPUT REQUIRED", "size": 9.5, "bold": True, "color": C["amber_d"]}])
    right = ["Names, roles and time commitment of each person",
             "Relevant shipped work, with links",
             "Legal entity and jurisdiction",
             "Who designed, reviewed and operates the code, and how AI assistance was used",
             "Who controls the admin wallet, and the multisig plan",
             "Advisors, if any (with their consent)"]
    y = 2.05
    for t in right:
        label(s, 7.0, y, 5.68, 0.5, [{"runs": [("[FOUNDER INPUT]  ", {"bold": True, "color": C["amber_d"]}), (t, {})], "size": 11}],
              fill=C["amber_t"], radius=0.06, align="l", margin=(0.16, 0.02, 0.1, 0.02))
        y += 0.58
    label(s, MX, 5.75, W - 2 * MX, 0.78, [
        {"runs": [("Technical ownership.  ", {"bold": True}),
                  ("Circle asks for clear technical ownership. The code carries AI-assistance and scaffold markers "
                   "(for example src/tracing.ts, \"Built with Arc Studio\"). State accurately who designed, reviews and operates it.", {})],
         "size": 11.5}], fill=C["slate_t"], radius=0.08, align="l", margin=(0.2, 0.04, 0.2, 0.04))
    return s


# ----------------------------------------------------------------------------- 17 why support


def s17(prs):
    s = _blank(prs)
    chrome(s, 17, "Why support AvantDex", "A working base, a concrete Circle plan, and funding tied to checks",
           "Source: audit docs 00, 03, 06, 10, 11. Testnet figures are the 21 Nov 2026 snapshot. Nothing on this slide claims audit, mainnet, production Circle use, users or volume.")
    items = [
        ("A working product on Arc Testnet", "Web app, API, indexer and admin dashboard live at avantdex.xyz."),
        ("A lifecycle verified on chain", "4 markets, 15 orders, 4 trades; one settled, one refunded."),
        ("USDC-centred, no admin path to funds", "USDC is the only money. No role can move escrowed funds."),
        ("Circle groundwork in place", "CCTP V2 bridge on testnet; passkey wallet code ready to switch on."),
        ("A concrete Circle roadmap", "Passkey wallet, Gas Station, real CCTP transfers, one-confirmation first trade."),
        ("Security commitments", "Contract v3 to fix H-1, multisig and timelock, independent audit before mainnet."),
        ("Milestone-based funding", "$20,000 to $25,000, released against five verifiable milestones."),
    ]
    y = 1.78
    for i, (a, b) in enumerate(items):
        tb(s, MX, y, 0.5, 0.6, [{"text": f"{i + 1}", "size": 20, "bold": True, "color": C["mint_d"]}], anchor="m")
        tb(s, MX + 0.55, y, 7.6, 0.62, [{"text": a, "size": 13.5, "bold": True, "space_after": 1},
                                        {"text": b, "size": 11.5, "color": C["muted"]}], anchor="m")
        if i < 6:
            line(s, MX, y + 0.66, 8.8, y + 0.66, color=C["line"], w=0.75)
        y += 0.69
    rect(s, 9.3, 1.78, 3.38, 3.75, fill=C["amber_t"], radius=0.1)
    tb(s, 9.55, 1.95, 3.0, 0.3, [{"text": "What we do not claim", "size": 14, "bold": True, "color": C["amber_d"]}])
    tb(s, 9.55, 2.4, 2.95, 3.0, [
        {"text": "No independent audit", "size": 12.5, "bullet": True, "bullet_color": C["amber_d"], "space_after": 8},
        {"text": "No mainnet deployment", "size": 12.5, "bullet": True, "bullet_color": C["amber_d"], "space_after": 8},
        {"text": "No Circle product in production", "size": 12.5, "bullet": True, "bullet_color": C["amber_d"], "space_after": 8},
        {"text": "No external users, volume or partnerships", "size": 12.5, "bullet": True, "bullet_color": C["amber_d"], "space_after": 8},
        {"text": "Testnet figures are proof of the mechanism, not traction", "size": 12.5, "bullet": True, "bullet_color": C["amber_d"]},
    ])
    return s


# ----------------------------------------------------------------------------- 18 closing


def s18(prs):
    s = _blank(prs)
    background(s, C["ink"])
    pic(s, IMG / "logo-rounded.png", 0.9, 0.8, h=0.95, border=False, alt="AvantDex logo")
    tb(s, 2.05, 0.8, 4.0, 0.95, [{"text": "AvantDex", "size": 26, "bold": True, "color": C["white"]}], anchor="m")
    tb(s, 0.9, 2.35, 7.4, 1.7, [{"text": "Trade tokens before they launch,\nwith funds held in USDC escrow.", "size": 34,
                                 "bold": True, "color": C["white"]}], spacing=0.98)
    tb(s, 0.9, 4.2, 7.0, 0.8, [{"text": "We ask for a milestone-based grant to put Circle products into running testnet use, "
                                "fix the settlement-token blocker, and fund an independent audit before mainnet.",
                                "size": 16, "color": C["on_dark"]}])
    rect(s, 0.9, 5.25, 0.9, 0.05, fill=C["mint"])
    tb(s, 0.9, 5.45, 3.4, 0.4, [{"text": "Try it on Arc Testnet:", "size": 17, "color": C["on_dark"]}])
    lk = tb(s, 3.2, 5.45, 2.2, 0.4, [{"runs": [("avantdex.xyz", {"underline": True})], "size": 17, "bold": True, "color": C["mint"]}])
    lk.click_action.hyperlink.address = "https://avantdex.xyz/"
    tb(s, 0.9, 5.85, 7, 0.4, [{"text": "A live demo is available on request.", "size": 17, "color": C["on_dark"]}])
    tb(s, 0.9, 6.25, 7, 0.4, [{"runs": [("Contact:  ", {"color": C["on_dark"]}), ("[FOUNDER INPUT]", {"color": C["amber"], "bold": True}),
                                        ("   X: @AvantDex", {"color": C["on_dark"]})], "size": 15}])
    pyramid(s, 10.4, 5.7, 3.1, 3.4)
    tb(s, 0.9, 6.95, 11.5, 0.3, [{"text": "Arc Testnet  ·  Not audited  ·  Exchange v2 0xb48935EeA3B7264a53098B1DB920C3fCa09C0283",
                                  "size": 10, "color": C["soft"]}], check=False)
    return s
