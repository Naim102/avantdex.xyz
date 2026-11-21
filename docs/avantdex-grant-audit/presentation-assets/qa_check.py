"""Automated checks for the grant deck (read-only).

1. Reloads the PPTX with python-pptx: slide count, speaker notes on every slide, pictures resolve, shapes inside the slide.
2. Cross-checks every number-like token in the deck text against the 14 audit documents and the generated notes.
Prints a report; exit code 1 if a hard check fails.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PPTX = ROOT / "AvantDex-Circle-Grant-Presentation.pptx"
SW, SH = 12192000, 6858000

prs = Presentation(PPTX)
hard = 0
print(f"slides: {len(prs.slides)} (expected 18), size {prs.slide_width}x{prs.slide_height}")
hard += len(prs.slides) != 18
hard += (prs.slide_width, prs.slide_height) != (SW, SH)

deck_text: list[str] = []
oob = 0
pics = 0
for i, s in enumerate(prs.slides, 1):
    notes = s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip()
    if not notes:
        print(f"  slide {i}: NO SPEAKER NOTES")
        hard += 1
    for sh in s.shapes:
        if sh.shape_type == 13:
            pics += 1
            assert len(sh.image.blob) > 1000, f"slide {i}: empty image"
        if sh.has_text_frame:
            deck_text.append(sh.text_frame.text)
        if sh.left is not None and (sh.left < -10000 or sh.top < -10000 or sh.left + sh.width > SW + 10000 or sh.top + sh.height > SH + 10000):
            oob += 1
            print(f"  slide {i}: shape outside the slide: {sh.name} ({Emu(sh.left).inches:.2f},{Emu(sh.top).inches:.2f})")
print(f"pictures: {pics}, shapes outside slide: {oob}")
hard += oob

docs = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ROOT.glob("[0-9][0-9]-*.md")))
docs += "\n" + (ROOT / "AvantDex-Presentation-Speaker-Notes.md").read_text(encoding="utf-8")
src = "\n".join(deck_text)
tokens = sorted(set(re.findall(r"\$?\d[\d,\.]*\d%?|\$?\d%?", src)))
missing = []
for t in tokens:
    core = t.lstrip("$").rstrip("%")
    if len(core) < 2:
        continue
    variants = {t, core, core.replace(",", "")}
    if not any(v in docs for v in variants):
        missing.append(t)
print(f"number-like tokens in deck: {len(tokens)}; not found verbatim in the audit documents: {missing}")
print("RESULT:", "FAIL" if hard else "PASS (structure)")
sys.exit(1 if hard else 0)
