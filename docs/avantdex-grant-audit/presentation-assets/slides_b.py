"""Slides 07 to 12: architecture, contract and fund flow, Arc, Circle status, Circle roadmap, security."""

from __future__ import annotations

from pptx.enum.shapes import MSO_SHAPE

from deck_lib import (C, FONT, H, MONO, MX, W, chip, chrome, label, line, rect, status_style, tb)


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


# ----------------------------------------------------------------------------- 07 architecture


def s07(prs):
    s = _blank(prs)
    chrome(s, 7, "Technical architecture", "The chain is canonical; indexed state can be rebuilt by replaying events",
           "Source: audit docs 02 and 07 (backend/app/indexer/worker.py: run_once, _process, _sync; docker-compose.yml; deployments/arc-testnet.json). Contract not audited.")
    # containers
    rect(s, 4.3, 1.8, 4.3, 4.05, fill="EEF1F6", line=C["line_d"], lw=1, radius=0.1)
    tb(s, 4.5, 1.84, 4, 0.22, [{"text": "OFF-CHAIN  ·  derived or editorial", "size": 9.5, "bold": True, "color": C["muted"]}], check=False)
    rect(s, 9.4, 1.8, 3.28, 4.05, fill=C["mint_t"], line=C["mint"], lw=1, radius=0.1)
    tb(s, 9.55, 1.84, 3, 0.22, [{"text": "ON-CHAIN  ·  canonical", "size": 9.5, "bold": True, "color": C["mint_d"]}], check=False)
    # arrows first (boxes drawn on top)
    line(s, 3.5, 2.45, 4.55, 2.45, color=C["mint_d"], w=1.5, head=True)
    line(s, 2.07, 3.55, 2.07, 4.3, color=C["mint_d"], w=1.5, head=True)
    line(s, 6.47, 2.8, 6.47, 3.05, color=C["line_d"], w=1.25, head=True)
    line(s, 6.47, 4.4, 6.47, 4.15, color=C["line_d"], w=1.25, head=True)
    line(s, 8.4, 4.75, 9.55, 4.75, color=C["mint_d"], w=1.5, head=True)
    line(s, 2.07, 5.6, 2.07, 6.2, color=C["mint_d"], w=1.5)
    line(s, 2.07, 6.2, 11.05, 6.2, color=C["mint_d"], w=1.5)
    line(s, 11.05, 6.2, 11.05, 5.85, color=C["mint_d"], w=1.5, head=True)
    # left
    label(s, MX, 2.1, 2.85, 1.45, [{"text": "Web app", "size": 14, "bold": True},
                                   {"text": "React 18, Vite, wagmi, viem", "size": 11.5, "color": C["muted"]}],
          fill=C["white"], line=C["line"], radius=0.08)
    label(s, MX, 4.3, 2.85, 1.3, [{"text": "Wallet", "size": 14, "bold": True},
                                  {"text": "Injected wallet, or a Circle passkey account (built, disabled on the live site)",
                                   "size": 11, "color": C["muted"]}],
          fill=C["white"], line=C["line"], radius=0.08, margin=(0.12, 0.04, 0.12, 0.04))
    tb(s, 2.2, 3.68, 1.4, 0.4, [{"text": "asks it to sign", "size": 10, "color": C["muted"]}])
    tb(s, 3.52, 2.12, 1.0, 0.25, [{"text": "HTTPS", "size": 10, "color": C["muted"], "align": "c"}], check=False)
    # middle
    label(s, 4.55, 2.1, 3.85, 0.7, [{"text": "FastAPI + nginx", "size": 13, "bold": True},
                                    {"text": "read API, sign-in, listings, admin", "size": 11, "color": C["muted"]}],
          fill=C["white"], line=C["line"], radius=0.08)
    label(s, 4.55, 3.05, 3.85, 1.1, [{"text": "PostgreSQL 16", "size": 13, "bold": True},
                                     {"text": "Rebuilt by replay: orders, trades, markets, claimables", "size": 10.5, "color": C["mint_d"]},
                                     {"text": "Only here: projects, badges, disputes, admins, audit logs", "size": 10.5, "color": C["amber_d"]}],
          fill=C["white"], line=C["line"], radius=0.08, margin=(0.12, 0.04, 0.1, 0.04), space_after=2)
    label(s, 4.55, 4.4, 3.85, 0.7, [{"text": "Indexer (web3.py)", "size": 13, "bold": True},
                                    {"text": "idempotent; state read at the processed block", "size": 11, "color": C["muted"]}],
          fill=C["white"], line=C["line"], radius=0.08)
    tb(s, 8.42, 4.4, 1.05, 0.3, [{"text": "logs + reads", "size": 9.5, "color": C["muted"], "align": "c"}], check=False)
    # right
    rect(s, 9.55, 2.1, 2.98, 2.85, fill=C["white"], line=C["line"], radius=0.08)
    tb(s, 9.7, 2.2, 2.7, 0.3, [{"text": "AvantdexExchange v2", "size": 14, "bold": True}])
    tb(s, 9.7, 2.52, 2.7, 0.3, [{"text": "0xb489…0283", "size": 11.5, "font": MONO, "color": C["muted"]}])
    tb(s, 9.7, 2.95, 2.75, 1.9, [
        {"text": "Orders, trades and escrow", "size": 11.5, "bullet": True, "space_after": 3},
        {"text": "Roles, fees and pause", "size": 11.5, "bullet": True, "space_after": 3},
        {"text": "Solidity 0.8.28, OpenZeppelin 5.6.1", "size": 11.5, "bullet": True, "space_after": 3},
        {"text": "Blocklist-safe payouts (claimable fallback)", "size": 11.5, "bullet": True, "space_after": 3},
        {"text": "On Arc Testnet (5042002)", "size": 11.5, "bullet": True, "space_after": 3},
        {"text": "Not audited", "size": 11.5, "bullet": True, "bold": True, "color": C["red_d"], "bullet_color": C["red_d"]},
    ])
    label(s, 9.55, 5.05, 2.98, 0.65, [{"text": "USDC (ERC-20)", "size": 13, "bold": True},
                                      {"text": "0x3600…0000, 6 decimals", "size": 10.5, "color": C["muted"], "font": MONO}],
          fill=C["white"], line=C["line"], radius=0.08)
    tb(s, 3.6, 6.25, 6.8, 0.3, [{"text": "Signed transactions go straight to the contract (maxFeePerGas at least 20 gwei)",
                                 "size": 10.5, "color": C["muted"], "align": "c"}], check=False)
    return s


# ----------------------------------------------------------------------------- 08 contract and fund flow


def s08(prs):
    s = _blank(prs)
    chrome(s, 8, "Smart contract and fund flow", "Escrow is 2V + f per trade, and every exit pays out exactly that",
           "Source: contracts/AvantdexExchange.sol (placeOrder 396, settleTrade 479, claimDefault 509, refundTrade 525, _pay 685); audit doc 04 sections 5 and 9. Desk review, not an audit.")
    cards = [
        ("placeOrder", "Validates the order, fills against the maker orders the caller names at the maker's price, then locks or pulls USDC once."),
        ("settleTrade", "Moves the token from seller to buyer and checks the buyer's balance change. Seller gets 2V − f, fee collector 2f. Anyone may call it."),
        ("claimDefault", "After the deadline the buyer receives 2V + f: payment, fee reserve and the seller's collateral. No platform fee."),
        ("refundTrade", "Cancelled or abandoned market: buyer gets V + f, seller gets V. No fee."),
    ]
    y = 1.8
    for fn, text in cards:
        rect(s, MX, y, 5.2, 0.98, fill=C["white"], line=C["line"], radius=0.08)
        label(s, MX + 0.15, y + 0.14, 1.5, 0.3, [{"text": fn, "size": 11, "font": MONO, "bold": True, "color": C["mint_d"]}],
              fill=C["mint_t"], radius=0.15, margin=(0.04, 0, 0.04, 0), check=False)
        tb(s, MX + 0.15, y + 0.5, 4.9, 0.46, [{"text": text, "size": 10.5, "color": C["muted"]}], check=True)
        y += 1.08
    # escrow bars
    x0, V, f = 7.55, 2.45, 0.19
    tb(s, 6.2, 1.72, 6.4, 0.25, [{"text": "PER TRADE  ·  V = trade value, f = 0.5% of V (f not to scale)", "size": 9.5, "bold": True,
                                  "color": C["muted"]}])

    def seg(x, w, fill, txt, color=C["ink"], y=0.0, size=11):
        label(s, x, y, w, 0.46, [{"text": txt, "size": size, "bold": True, "color": color}], fill=fill, margin=(0.03, 0, 0.03, 0),
              check=False)

    rows = {"esc": 2.15, "set": 3.1, "def": 3.7, "ref": 4.3}
    tb(s, 6.2, rows["esc"], 1.3, 0.46, [{"text": "Escrowed", "size": 12, "bold": True}], anchor="m")
    seg(x0, V, C["mint"], "Buyer payment V", y=rows["esc"])
    seg(x0 + V, f, C["amber"], "", y=rows["esc"])
    seg(x0 + V + f, V, C["slate"], "Seller collateral V", color=C["white"], y=rows["esc"])
    tb(s, x0 + V - 0.35, rows["esc"] - 0.22, 0.9, 0.2, [{"text": "fee reserve f", "size": 9, "color": C["amber_d"], "align": "c"}], check=False)
    tb(s, 7.55, 2.77, 3, 0.25, [{"text": "then exactly one exit", "size": 10, "color": C["muted"]}], check=False)
    tb(s, 6.2, rows["set"], 1.3, 0.46, [{"text": "Settled", "size": 12, "bold": True}], anchor="m")
    seg(x0, 2 * V - f, C["slate"], "Seller receives 2V − f", color=C["white"], y=rows["set"])
    seg(x0 + 2 * V - f, 2 * f, C["amber"], "", y=rows["set"])
    tb(s, 10.3, rows["set"] - 0.22, 2.4, 0.2, [{"text": "fee collector 2f", "size": 9, "color": C["amber_d"], "align": "r"}], check=False)
    tb(s, 6.2, rows["def"], 1.3, 0.46, [{"text": "Defaulted", "size": 12, "bold": True}], anchor="m")
    seg(x0, 2 * V + f, C["mint"], "Buyer receives 2V + f  (no fee)", y=rows["def"])
    tb(s, 6.2, rows["ref"], 1.3, 0.46, [{"text": "Refunded", "size": 12, "bold": True}], anchor="m")
    seg(x0, V + f, C["mint"], "Buyer V + f", y=rows["ref"])
    seg(x0 + V + f, V, C["slate"], "Seller V", color=C["white"], y=rows["ref"])
    # limits
    rect(s, 6.2, 4.95, 6.48, 1.58, fill=C["amber_t"], radius=0.08)
    tb(s, 6.4, 5.03, 6.1, 0.28, [{"text": "Protection and its limits", "size": 12.5, "bold": True, "color": C["amber_d"]}])
    tb(s, 6.4, 5.32, 6.1, 1.2, [
        {"text": "Buyer protection holds up to about a 2x rise in the token's value, because seller collateral equals V.",
         "size": 11, "bullet": True, "bullet_color": C["amber_d"], "space_after": 2},
        {"text": "No on-chain price-time priority: the taker names the orders to fill.", "size": 11, "bullet": True,
         "bullet_color": C["amber_d"], "space_after": 2},
        {"text": "The settlement token is chosen by one manager signature (H-1), a mainnet blocker. Not audited.",
         "size": 11, "bullet": True, "bullet_color": C["amber_d"]},
    ])
    return s


# ----------------------------------------------------------------------------- 09 why Arc


def s09(prs):
    s = _blank(prs)
    chrome(s, 9, "Why Arc", "Arc is the settlement layer by design; the contract itself is portable EVM code",
           "Source: audit doc 05 (Arc integration), doc 06; backend/app/config.py, src/hooks/useTx.ts line 31, AvantdexExchange.sol _pay. Arc claims follow Arc documentation as recorded in docs/AUDIT-2026-11-ARC-CIRCLE.md.")
    items = [
        ("USDC is the money and the gas", "Escrow, collateral, fees and payouts are USDC. Arc's gas token is USDC too, so a user needs one asset."),
        ("Deterministic finality", "The indexer has no reorg logic and a trade appears in seconds. Taken from Arc documentation, not benchmarked by us."),
        ("Compliance-aware payouts", "USDC on Arc reverts for blocklisted accounts, so every payout falls back to a claimable balance and no one can block others."),
        ("Native route for Circle CCTP", "Arc is CCTP domain 26. The Bridge lists Arc first and handles Arc's 20 gwei fee floor in the wallet, bridge and keeper."),
    ]
    y = 1.75
    for head, body in items:
        tb(s, MX, y, 5.75, 0.85, [{"text": head, "size": 13.5, "bold": True, "space_after": 2},
                                  {"text": body, "size": 11.5, "color": C["muted"]}])
        line(s, MX, y + 0.88, MX + 5.75, y + 0.88, color=C["line"], w=0.75)
        y += 0.95
    label(s, MX, 5.6, 5.75, 0.93, [{"runs": [("Where Arc is not required today:  ", {"bold": True}),
          ("the contract is generic Solidity 0.8.28 for the EVM. Its only Arc-specific constant is the USDC address. "
           "Arc is the chosen settlement layer and ecosystem, not a technical lock-in.", {})], "size": 11.5}],
          fill=C["amber_t"], radius=0.08, align="l", margin=(0.18, 0.04, 0.14, 0.04))
    # map
    tb(s, 6.9, 1.62, 5.7, 0.25, [{"text": "ARC AND CIRCLE INTEGRATION MAP  ·  STATUS TODAY", "size": 9.5, "bold": True, "color": C["muted"]}])
    cx, cy = 9.8, 3.9
    nodes = [
        (6.9, 1.95, "USDC", "settlement and gas", "implemented", "Testnet"),
        (10.38, 1.95, "CCTP V2", "Arc = domain 26", "partial", "Testnet, partial"),
        (6.9, 5.0, "Circle Wallet", "passkey smart account", "partial", "Built, off on live site"),
        (10.38, 5.0, "Gas Station", "sponsored gas", "planned", "Planned"),
    ]
    nw, nh = 2.3, 0.85
    for x, y, *_ in nodes:
        line(s, cx, cy, x + nw / 2, y + nh / 2, color=C["line_d"], w=1.5)
    label(s, cx - 1.15, cy - 0.5, 2.3, 1.0, [{"text": "AvantDex exchange v2", "size": 13, "bold": True, "color": C["white"]},
                                              {"text": "Arc Testnet 5042002", "size": 11, "color": C["on_dark"]}],
          fill=C["ink"], radius=0.1)
    for x, y, head, sub, kind, tag in nodes:
        label(s, x, y, nw, nh, [{"text": head, "size": 13, "bold": True}, {"text": sub, "size": 11, "color": C["muted"]}],
              fill=C["white"], line=C["line_d"], radius=0.08)
        chip(s, x + 0.02, y + nh + 0.06, 2.15, 0.27, tag, kind=kind, size=9.5)
    return s


# ----------------------------------------------------------------------------- 10 Circle status matrix


def s10(prs):
    s = _blank(prs)
    chrome(s, 10, "Circle integration, current status",
           "No Circle product runs in production; USDC and CCTP run on testnet",
           "Source: audit doc 06 section 1 (code search of src/, backend/, scripts/, package.json), live /api/config on 21 Nov 2026, docs/CCTP.md, docs/CIRCLE-WALLET.md.")
    cols = [(MX, 2.55, "Circle product"), (3.3, 1.75, "Status"), (5.2, 5.35, "What exists"), (10.7, 1.98, "Evidence")]
    for x, w, t in cols:
        tb(s, x, 1.72, w, 0.28, [{"text": t.upper(), "size": 9.5, "bold": True, "color": C["muted"]}])
    line(s, MX, 2.03, W - MX, 2.03, color=C["line_d"], w=1)
    rows = [
        ("USDC", "implemented", "Testnet", "Sole currency of escrow, collateral, fees and gas. Arc USDC, 6 decimals. Test USDC only.", "contract usdc() read on chain", 0.58),
        ("CCTP V2", "partial", "Testnet", "Own Standard flow plus Circle's Forwarding Service (Bridge Kit), 24 testnet routes. Verified on forks. No complete public-testnet transfer with Circle's live signatures yet.", "docs/CCTP.md, fork test 11 checks", 0.86),
        ("Passkey wallets", "partial", "Code only", "Sign-in and provider are built and tested with fake and local accounts. Disabled on the live site: no Client Key is set.", "/api/config: circle_wallet.enabled false", 0.72),
        ("Gas Station", "planned", "Planned", "Sponsorship request is coded with a fallback to the wallet's own USDC. No policy is created.", "circleProvider.ts, config.py", 0.58),
        ("Gateway", "none", "", "Contract addresses appear only in a generated registry. No code path.", "src/onchain-facts.ts", 0.5),
        ("Nanopayments", "none", "", "Not present.", "code search", 0.4),
        ("EURC", "none", "", "Not present. The exchange contract is USDC-only.", "contract", 0.4),
    ]
    y = 2.12
    for name, kind, tag, what, ev, h in rows:
        tb(s, MX, y, 2.55, h, [{"text": name, "size": 13.5, "bold": True}], anchor="m")
        fill, col, lab = status_style(kind)
        chip(s, 3.3, y + h / 2 - 0.15, 1.7, 0.3, lab + (f" · {tag}" if tag and kind != "planned" else ""), fill=fill, color=col, size=10)
        tb(s, 5.2, y, 5.35, h, [{"text": what, "size": 11, "color": C["ink"]}], anchor="m")
        tb(s, 10.7, y, 1.98, h, [{"text": ev, "size": 9.5, "color": C["muted"]}], anchor="m")
        line(s, MX, y + h + 0.03, W - MX, y + h + 0.03, color=C["line"], w=0.75)
        y += h + 0.07
    return s


# ----------------------------------------------------------------------------- 11 Circle roadmap


def s11(prs):
    s = _blank(prs)
    chrome(s, 11, "Circle integration roadmap", "Next Circle integrations, each tied to a gain for the user",
           "Source: audit doc 06 section 3 (steps 0a to 3c), doc 11 section 5 (work packages WP1 to WP5). Effort figures are estimates; none of this is built or budgeted beyond what doc 11 lists.")
    cols = [
        ("Near-term: before submission", "About 2 days of work (P0)", C["mint"], C["ink"], [
            ("Passkey wallet switched on", "Create a testnet Client Key, register avantdex.xyz as Passkey Domain, run the 5-step checklist.", "New users sign up with a passkey and no seed phrase."),
            ("Gas Station policy", "A policy limited to the exchange and USDC.", "A first trade with no USDC for gas."),
            ("Real public-testnet CCTP transfers", "Both directions, with Circle's live attestation and recorded hashes.", "A fork-verified bridge becomes a proven one."),
        ]),
        ("Next: funded milestone M1", "Work packages WP4, WP5 and one option", C["slate"], C["white"], [
            ("One passkey confirmation per first trade", "Batch approve and placeOrder in one user operation (WP4).", "Half the confirmations."),
            ("Bridge-to-trade flow", "Continue from the bridge to the order form (WP5).", "Fund Arc and trade without losing context."),
            ("Developer-controlled wallet for the keeper", "Optional. Not in the budget lines of Scenarios A and B.", "No raw private key in an environment variable."),
        ]),
        ("Future expansion: not committed", "Needs contract changes and a new audit", C["grey_d"], C["white"], [
            ("Gateway and CCTP hooks", "Needs a contract version with a deposit balance.", "One-step cross-chain deposit into escrow."),
            ("EURC-priced markets", "Needs a second quote token in a new contract version.", "Euro-priced pre-markets."),
            ("Agent-facing data API", "Only if demand is shown; product decision first.", "A paid data line for agents."),
        ]),
    ]
    cw, gap = 3.85, 0.215
    x = MX
    for head, sub, hfill, hcol, items in cols:
        label(s, x, 1.72, cw, 0.62, [{"text": head, "size": 13.5, "bold": True, "color": hcol},
                                     {"text": sub, "size": 10.5, "color": hcol}], fill=hfill, radius=0.08, align="l",
              margin=(0.16, 0.03, 0.1, 0.03))
        y = 2.48
        for name, body, gain in items:
            rect(s, x, y, cw, 1.3, fill=C["white"], line=C["line"], radius=0.08)
            tb(s, x + 0.16, y + 0.08, cw - 0.3, 1.2, [
                {"text": name, "size": 12.5, "bold": True, "space_after": 2},
                {"text": body, "size": 10.5, "color": C["muted"], "space_after": 3},
                {"runs": [("User gain:  ", {"bold": True, "color": C["mint_d"]}), (gain, {})], "size": 10.5},
            ])
            y += 1.38
        x += cw + gap
    return s


# ----------------------------------------------------------------------------- 12 security


def s12(prs):
    s = _blank(prs)
    chrome(s, 12, "Security and risk", "We publish our own blockers: not audited, and mainnet waits for the fixes",
           "Source: audit docs 04 section 9 (R-1 to R-13), 07 section 5 (F-1 to F-12), 08. Confirmed = read in code, read on chain, or observed on the live site on 21 Nov 2026. Severity is the author's opinion, not an audit rating.")
    sev = {"High": (C["red_t"], C["red_d"]), "Medium": (C["amber_t"], C["amber_d"]), "Low": (C["grey_t"], C["grey_d"])}
    cols = [
        ("Blocks mainnet", C["red_d"], C["white"], [
            ("High", "H-1  Settlement token set by one manager signature", "A manager can name a token sellers do not hold, and defaults then pay the buyer. Fix planned in contract v3 (M3)."),
            ("High", "R-2  Three on-chain roles on one wallet", "Admin, manager and pauser are one externally owned account, read on chain. Multisig and timelock planned (M3)."),
            ("High", "No independent audit", "One internal desk review only. The audit is milestone M4."),
        ]),
        ("Fix in days: confirmed", C["amber_d"], C["white"], [
            ("Medium", "F-1  Security headers not delivered", "nginx add_header inheritance: the live response carries only X-Content-Type-Options. No CSP, no HSTS."),
            ("Medium", "F-2  Tracing scaffold in the production bundle", "tracing.ts and console-capture.ts patch fetch and the wallet provider and post to the parent frame."),
            ("Medium", "F-3  Session token in sessionStorage", "Readable by any script on the page; no CSP yet. Admin tokens last 2 hours."),
        ]),
        ("Operations gaps", C["grey_d"], C["white"], [
            ("Medium", "F-4  No backups for editorial data", "Projects, badges, disputes, admins and audit logs exist only in PostgreSQL."),
            ("Medium", "F-5  No continuous integration", "Tests are run by hand. No secret or dependency scanning."),
            ("Low", "F-7  No LICENSE file", "The second remote repository is public."),
        ]),
    ]
    cw, gap = 3.85, 0.215
    x = MX
    for head, hfill, hcol, items in cols:
        label(s, x, 1.72, cw, 0.4, [{"text": head, "size": 13, "bold": True, "color": hcol}], fill=hfill, radius=0.2, align="l",
              margin=(0.18, 0, 0.1, 0))
        y = 2.25
        for level, title, body in items:
            rect(s, x, y, cw, 1.08, fill=C["white"], line=C["line"], radius=0.08)
            f, c = sev[level]
            chip(s, x + 0.14, y + 0.1, 0.72, 0.22, level, fill=f, color=c, size=9)
            tb(s, x + 0.95, y + 0.07, cw - 1.05, 0.3, [{"text": title, "size": 11, "bold": True}], anchor="m", check=False)
            tb(s, x + 0.14, y + 0.4, cw - 0.26, 0.66, [{"text": body, "size": 10, "color": C["muted"]}])
            y += 1.16
        x += cw + gap
    label(s, MX, 5.8, W - 2 * MX, 0.74, [
        {"runs": [("Not yet verified:  ", {"bold": True}),
                  ("whether the tracing code captures request headers or tokens  ·  Arc blocklist payout paths on the real chain "
                   "(tests use a mock USDC)  ·  WalletConnect and mobile wallet support  ·  the keeper running on the live site.", {})],
         "size": 11}], fill=C["slate_t"], radius=0.08, align="l", margin=(0.2, 0.04, 0.2, 0.04))
    return s
