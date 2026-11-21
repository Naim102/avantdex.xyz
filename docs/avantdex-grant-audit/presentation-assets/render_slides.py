"""Exports every slide of the deck to PNG with the installed Microsoft PowerPoint (COM automation).

Usage: python render_slides.py [width]
Writes presentation-assets/render/slide-01.png ... and contact-sheet.png. Nothing is installed or changed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pythoncom  # noqa: F401  (ships with pywin32)
import win32com.client
from PIL import Image

HERE = Path(__file__).resolve().parent
PPTX = HERE.parent / "AvantDex-Circle-Grant-Presentation.pptx"
OUT = HERE / "render"
OUT.mkdir(exist_ok=True)
width = int(sys.argv[1]) if len(sys.argv) > 1 else 1920
height = round(width * 9 / 16)

app = win32com.client.Dispatch("PowerPoint.Application")
pres = app.Presentations.Open(str(PPTX), ReadOnly=True, Untitled=False, WithWindow=False)
try:
    n = pres.Slides.Count
    for i in range(1, n + 1):
        pres.Slides(i).Export(str(OUT / f"slide-{i:02d}.png"), "PNG", width, height)
    print("exported", n, "slides at", width, "x", height)
finally:
    pres.Close()
    app.Quit()

thumbs = [Image.open(OUT / f"slide-{i:02d}.png").convert("RGB").resize((640, 360)) for i in range(1, n + 1)]
cols = 3
rows = (n + cols - 1) // cols
sheet = Image.new("RGB", (cols * 650, rows * 370), "white")
for i, t in enumerate(thumbs):
    sheet.paste(t, ((i % cols) * 650 + 5, (i // cols) * 370 + 5))
sheet.save(OUT / "contact-sheet.png")
print("contact sheet saved")
