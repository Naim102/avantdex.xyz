"""Builds docs/avantdex-grant-audit/AvantDex-Circle-Grant-Presentation.pptx and the companion speaker-notes file.

Run from anywhere:  python docs/avantdex-grant-audit/presentation-assets/build_grant_deck.py
Needs only python-pptx, lxml and Pillow (already installed). Images are prepared first by prep_images.py.
Nothing in the application source tree is read or changed.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from pptx import Presentation  # noqa: E402
from pptx.util import Emu  # noqa: E402

import deck_lib  # noqa: E402
import slides_a  # noqa: E402
import slides_b  # noqa: E402
import slides_c  # noqa: E402
from notes_data import DEMO_SCRIPT, FIVE_MIN_SCRIPT, NOTES, QA  # noqa: E402

OUT_DIR = HERE.parent
PPTX = OUT_DIR / "AvantDex-Circle-Grant-Presentation.pptx"
NOTES_MD = OUT_DIR / "AvantDex-Presentation-Speaker-Notes.md"

SLIDES = [
    (1, "Cover", slides_a.s01), (2, "The problem", slides_a.s02), (3, "The solution", slides_a.s03),
    (4, "Product walkthrough", slides_a.s04), (5, "Product execution and testnet evidence", slides_a.s05),
    (6, "How it works", slides_a.s06), (7, "Technical architecture", slides_b.s07),
    (8, "Smart contract and fund flow", slides_b.s08), (9, "Why Arc", slides_b.s09),
    (10, "Circle integration: current status", slides_b.s10), (11, "Circle integration roadmap", slides_b.s11),
    (12, "Security and risk", slides_b.s12), (13, "Market and business model", slides_c.s13),
    (14, "Roadmap and milestones", slides_c.s14), (15, "Funding request", slides_c.s15),
    (16, "Team and execution", slides_c.s16), (17, "Why support AvantDex", slides_c.s17),
    (18, "Closing and demo", slides_c.s18),
]


def build() -> None:
    prs = Presentation()
    prs.slide_width = Emu(12192000)
    prs.slide_height = Emu(6858000)
    for n, _title, fn in SLIDES:
        slide = fn(prs)
        deck_lib.set_notes(slide, NOTES[n])
        deck_lib.fade(slide)
    cp = prs.core_properties
    cp.title = "AvantDex: Structured Pre-Market Trading on Arc (Circle Grant Presentation)"
    cp.author = "AvantDex"
    cp.subject = "Circle Developer Grant presentation, November 2026"
    cp.keywords = "AvantDex, Arc, Circle, USDC, CCTP, pre-market"
    cp.comments = "Arc Testnet data snapshot dated 21 November 2026. Not audited."
    prs.save(PPTX)
    print("saved", PPTX, f"({len(prs.slides)} slides)")
    if deck_lib.warnings:
        print(f"{len(deck_lib.warnings)} possible text overflow warning(s):")
        for w in deck_lib.warnings:
            print("  -", w)
    else:
        print("no overflow warnings from the metric estimate")


def write_notes() -> None:
    lines = [
        "# AvantDex: speaker notes, scripts and reviewer Q and A",
        "",
        "Companion to `AvantDex-Circle-Grant-Presentation.pptx` (18 slides). The same notes are embedded in the PPTX speaker-notes pane.",
        "All facts come from the audit documents in this folder (cited as doc NN). Testnet figures are a snapshot dated 21 November 2026.",
        "Items marked `[FOUNDER INPUT]` are not documented anywhere and must be supplied by the founders.",
        "",
        "## 1. Slide-by-slide notes",
        "",
    ]
    for n, title, _ in SLIDES:
        lines += [f"### Slide {n:02d}: {title}", ""]
        for para in NOTES[n].split("\n"):
            head, _, rest = para.partition(": ")
            if head in ("MESSAGE", "SAY", "EVIDENCE", "REVIEWER MAY ASK"):
                lines.append(f"- **{head.title()}:** {rest}")
            else:
                lines.append(para)
        lines.append("")
    lines += ["## 2. Five-minute presentation script", "", FIVE_MIN_SCRIPT, "## 3. Three-minute product demo script", "",
              DEMO_SCRIPT, "## 4. Ten likely Circle reviewer questions", ""]
    for i, (q, a) in enumerate(QA, 1):
        lines += [f"**{i}. {q}**", "", a, ""]
    NOTES_MD.write_text("\n".join(lines), encoding="utf-8")
    print("saved", NOTES_MD)


if __name__ == "__main__":
    build()
    write_notes()
