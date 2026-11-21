"""Prepares the cropped screenshots and the logo used by build_grant_deck.py.

Inputs (read only):
  presentation-assets/screens/live-*-2x.png   captured from https://avantdex.xyz on 2026-11-21 (headless Chrome, 2x)
  docs/screenshots/14-market-trade-panel.png   repository screenshot, local dev stack, demo data, earlier theme
  docs/screenshots/22-admin-settlement.png     repository screenshot, local dev stack, demo data, earlier theme
  avantdex-logo.png                            brand logo
Outputs: presentation-assets/img/*.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SCREENS = HERE / "screens"
OUT = HERE / "img"
OUT.mkdir(exist_ok=True)


def crop(src: Path, box: tuple[int, int, int, int], name: str) -> None:
    im = Image.open(src).convert("RGB").crop(box)
    im.save(OUT / name, optimize=True)
    print(name, im.size)


# live site, 2x (coordinates are in 2x pixels)
crop(SCREENS / "live-explore-2x.png", (300, 250, 2580, 1690), "live-explore.png")
crop(SCREENS / "live-market-buraq-2x.png", (300, 370, 2580, 1880), "live-market.png")
crop(SCREENS / "live-bridge-2x.png", (300, 250, 2580, 1800), "live-bridge.png")
crop(SCREENS / "live-home-2x.png", (300, 330, 2580, 1300), "live-home-hero.png")

# repository screenshots (1x), local dev stack with demo data
shots = ROOT / "docs" / "screenshots"
crop(shots / "14-market-trade-panel.png", (896, 463, 1280, 1005), "demo-trade-panel.png")
crop(shots / "14-market-trade-panel.png", (160, 1130, 872, 1358), "demo-open-orders.png")
crop(shots / "22-admin-settlement.png", (160, 100, 1280, 720), "demo-admin-settlement.png")

# logo: RGBA with rounded corners
logo = Image.open(ROOT / "avantdex-logo.png").convert("RGBA")
w, h = logo.size
mask = Image.new("L", (w, h), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=int(w * 0.18), fill=255)
logo.putalpha(mask)
logo.save(OUT / "logo-rounded.png")
print("logo-rounded.png", logo.size)
