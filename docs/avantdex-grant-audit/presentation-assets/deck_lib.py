"""Small drawing helpers on top of python-pptx for the AvantDex grant deck.

Everything is a native, editable PowerPoint object (text boxes, shapes, connectors, charts). Pictures are only used
for screenshots and the logo. `warnings` collects possible text overflow found by a font-metrics estimate.
"""

from __future__ import annotations

from pathlib import Path

from lxml import etree
from PIL import Image, ImageFont
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

W, H = 13.333, 7.5
MX = 0.65  # horizontal page margin
FONT = "Calibri"
MONO = "Consolas"

C = {
    "ink": "262627",
    "mint": "28DF99",
    "mint_d": "0B7A4F",
    "mint_t": "DFF7EC",
    "bg": "F6F8FB",
    "white": "FFFFFF",
    "line": "DDE2EA",
    "line_d": "B9C1CF",
    "muted": "5A6070",
    "soft": "8A91A0",
    "slate": "3B5BA5",
    "slate_t": "E5ECFA",
    "amber": "F2B24A",
    "amber_d": "8A5A00",
    "amber_t": "FFF2D1",
    "red": "D9483B",
    "red_d": "B42318",
    "red_t": "FDE7E4",
    "grey_d": "4B5563",
    "grey_t": "ECEEF3",
    "on_dark": "C9CDD6",
}

warnings: list[str] = []

_FONT_FILES = {
    False: r"C:\Windows\Fonts\calibri.ttf",
    True: r"C:\Windows\Fonts\calibrib.ttf",
}
_fonts: dict[bool, ImageFont.FreeTypeFont] = {}


def rgb(h: str) -> RGBColor:
    return RGBColor.from_string(h)


# ----------------------------------------------------------------------------- text measurement (estimate)


def _font(bold: bool) -> ImageFont.FreeTypeFont:
    if bold not in _fonts:
        _fonts[bold] = ImageFont.truetype(_FONT_FILES[bold], 100)
    return _fonts[bold]


def _text_width_in(text: str, size: float, bold: bool) -> float:
    return _font(bold).getlength(text) / 100.0 * size / 72.0


def estimate_height(paras: list[dict], width: float) -> float:
    """Height in inches of the paragraphs when wrapped to `width` (Calibri metrics, 1.2 line height)."""
    total = 0.0
    for p in paras:
        size = p["size"]
        bold = p["bold"]
        avail = width - (0.18 if p.get("bullet") else 0.0)
        text = "".join(t for t, _ in p["runs"])
        lines = 0
        for hard in text.split("\n"):
            words = hard.split(" ")
            cur = ""
            n = 1
            for wd in words:
                trial = (cur + " " + wd).strip()
                if _text_width_in(trial, size, bold) <= avail or not cur:
                    cur = trial
                else:
                    n += 1
                    cur = wd
            lines += n
        total += lines * size * 1.2 * p.get("spacing", 1.0) / 72.0 + p.get("space_after", 0) / 72.0
    return total


# ----------------------------------------------------------------------------- text


def _norm(paras, size, bold, color, font, space_after, spacing, align):
    if isinstance(paras, (str, dict)):
        paras = [paras]
    out = []
    for p in paras:
        if isinstance(p, str):
            p = {"text": p}
        d = dict(p)
        runs = d.pop("runs", None)
        if runs is None:
            runs = [(d.pop("text", ""), {})]
        else:
            runs = [(r, {}) if isinstance(r, str) else r for r in runs]
        d.setdefault("size", size)
        d.setdefault("bold", bold)
        d.setdefault("color", color)
        d.setdefault("font", font)
        d.setdefault("space_after", space_after)
        d.setdefault("spacing", spacing)
        d.setdefault("align", align)
        d["runs"] = runs
        out.append(d)
    return out


_ALIGN = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}
_ANCHOR = {"t": MSO_ANCHOR.TOP, "m": MSO_ANCHOR.MIDDLE, "b": MSO_ANCHOR.BOTTOM}


def _fill_tf(tf, paras: list[dict], anchor: str, margin: tuple[float, float, float, float]) -> None:
    tf.word_wrap = True
    tf.margin_left, tf.margin_top, tf.margin_right, tf.margin_bottom = (Inches(m) for m in margin)
    tf.vertical_anchor = _ANCHOR[anchor]
    first = True
    for p in paras:
        para = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        para.alignment = _ALIGN[p["align"]]
        if p["spacing"] != 1.0:
            para.line_spacing = p["spacing"]
        para.space_after = Pt(p["space_after"])
        para.space_before = Pt(0)
        if p.get("bullet"):
            pPr = para._p.get_or_add_pPr()
            pPr.set("marL", str(int(Inches(0.18))))
            pPr.set("indent", str(-int(Inches(0.18))))
            clr = etree.SubElement(pPr, qn("a:buClr"))
            etree.SubElement(clr, qn("a:srgbClr")).set("val", p.get("bullet_color", C["mint_d"]))
            etree.SubElement(pPr, qn("a:buFont")).set("typeface", "Arial")
            etree.SubElement(pPr, qn("a:buChar")).set("char", "\u2022")
        for text, o in p["runs"]:
            r = para.add_run()
            r.text = text
            f = r.font
            f.size = Pt(o.get("size", p["size"]))
            f.bold = o.get("bold", p["bold"])
            f.italic = o.get("italic", p.get("italic", False))
            if o.get("underline"):
                f.underline = True
            f.name = o.get("font", p["font"])
            f.color.rgb = rgb(o.get("color", p["color"]))
            if o.get("link"):
                r.hyperlink.address = o["link"]


def tb(slide, x, y, w, h, paras, size=14, color=None, bold=False, font=FONT, align="l", anchor="t",
       spacing=1.0, space_after=0, margin=(0, 0, 0, 0), check=True, name=None):
    color = color or C["ink"]
    paras = _norm(paras, size, bold, color, font, space_after, spacing, align)
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        box.name = name
    _fill_tf(box.text_frame, paras, anchor, margin)
    if check:
        need = estimate_height(paras, w - margin[0] - margin[2]) + margin[1] + margin[3]
        if need > h + 0.04:
            warnings.append(f"possible overflow ({need:.2f}in > {h:.2f}in): {''.join(t for t, _ in paras[0]['runs'])[:60]!r}")
    return box


# ----------------------------------------------------------------------------- shapes


def rect(slide, x, y, w, h, fill=None, line=None, lw=0.75, radius=None, shape=None, name=None):
    kind = shape or (MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE)
    s = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        s.name = name
    if radius and kind == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = min(0.5, radius / min(w, h))
    if fill:
        s.fill.solid()
        s.fill.fore_color.rgb = rgb(fill)
    else:
        s.fill.background()
    if line:
        s.line.color.rgb = rgb(line)
        s.line.width = Pt(lw)
    else:
        s.line.fill.background()
    s.shadow.inherit = False
    return s


def label(slide, x, y, w, h, paras, fill=None, line=None, lw=0.75, radius=None, size=12, color=None, bold=False,
          font=FONT, align="c", anchor="m", margin=(0.08, 0.04, 0.08, 0.04), space_after=0, spacing=1.0, shape=None,
          check=True):
    s = rect(slide, x, y, w, h, fill=fill, line=line, lw=lw, radius=radius, shape=shape)
    paras_n = _norm(paras, size, bold, color or C["ink"], font, space_after, spacing, align)
    _fill_tf(s.text_frame, paras_n, anchor, margin)
    if check:
        need = estimate_height(paras_n, w - margin[0] - margin[2]) + margin[1] + margin[3]
        if need > h + 0.04:
            warnings.append(f"possible overflow in shape ({need:.2f}in > {h:.2f}in): {''.join(t for t, _ in paras_n[0]['runs'])[:60]!r}")
    return s


def line(slide, x1, y1, x2, y2, color=None, w=1.25, dash=False, head=False):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = rgb(color or C["line_d"])
    c.line.width = Pt(w)
    st = c._element.find(qn("p:style"))
    if st is not None:
        c._element.remove(st)  # the theme style adds a shadow to connectors
    if dash:
        c.line.dash_style = MSO_LINE.DASH
    if head:
        ln = c.line._get_or_add_ln()
        t = etree.SubElement(ln, qn("a:tailEnd"))
        t.set("type", "triangle")
        t.set("w", "med")
        t.set("len", "med")
    return c


def pic(slide, path, x, y, w=None, h=None, border=True, alt=""):
    iw, ih = Image.open(path).size
    if w is not None and h is None:
        h = w * ih / iw
    elif h is not None and w is None:
        w = h * iw / ih
    p = slide.shapes.add_picture(str(path), Inches(x), Inches(y), Inches(w), Inches(h))
    if border:
        p.line.color.rgb = rgb(C["line"])
        p.line.width = Pt(0.75)
    p._element.nvPicPr.cNvPr.set("descr", alt)
    return p, w, h


def set_notes(slide, text: str) -> None:
    slide.notes_slide.notes_text_frame.text = text


def fade(slide) -> None:
    """Adds a medium fade transition (inserted after clrMapOvr, as the schema requires)."""
    el = slide._element
    ns = "http://schemas.openxmlformats.org/presentationml/2006/main"
    tr = etree.fromstring(f'<p:transition xmlns:p="{ns}" spd="med"><p:fade/></p:transition>')
    cm = el.find(qn("p:clrMapOvr"))
    (cm if cm is not None else el.find(qn("p:cSld"))).addnext(tr)


def background(slide, hex_color: str) -> None:
    f = slide.background.fill
    f.solid()
    f.fore_color.rgb = rgb(hex_color)


# ----------------------------------------------------------------------------- page chrome

TOTAL = 18
FOOT = "AvantDex  \u00b7  Circle Developer Grant  \u00b7  Arc Testnet, not audited"


def chrome(slide, num: int, section: str, title: str, source: str | None = None, title_size: int = 26) -> None:
    background(slide, C["bg"])
    rect(slide, 0, 0, 0.14, H, fill=C["mint"])  # slim brand edge
    tb(slide, MX, 0.36, 8, 0.3, [{"text": f"{num:02d}   {section.upper()}", "size": 10.5, "bold": True,
                                  "color": C["mint_d"], "font": FONT}], check=False)
    tb(slide, MX, 0.64, W - 2 * MX, 0.95, [{"text": title, "size": title_size, "bold": True}], anchor="t", spacing=0.95)
    if source:
        tb(slide, MX, 6.62, W - 2 * MX, 0.32, [{"text": source, "size": 9, "color": C["muted"]}], anchor="b")
    line(slide, MX, 7.02, W - MX, 7.02, color=C["line"], w=0.75)
    tb(slide, MX, 7.08, 9, 0.25, [{"text": FOOT, "size": 9, "color": C["soft"]}], check=False)
    tb(slide, W - MX - 1.2, 7.08, 1.2, 0.25, [{"text": f"{num} / {TOTAL}", "size": 9, "color": C["soft"], "align": "r"}],
       check=False)


def status_style(kind: str) -> tuple[str, str, str]:
    """(fill, text colour, label) for the status vocabulary used in the deck."""
    return {
        "implemented": (C["mint_t"], C["mint_d"], "Implemented"),
        "partial": (C["amber_t"], C["amber_d"], "Partial"),
        "planned": (C["slate_t"], C["slate"], "Planned"),
        "none": (C["grey_t"], C["grey_d"], "Not implemented"),
        "risk": (C["red_t"], C["red_d"], "Risk"),
    }[kind]


def chip(slide, x, y, w, h, text, kind=None, fill=None, color=None, size=10, bold=True):
    if kind:
        f, c, _ = status_style(kind)
        fill, color = fill or f, color or c
    return label(slide, x, y, w, h, [{"text": text, "size": size, "bold": bold, "color": color or C["ink"]}],
                 fill=fill, radius=h / 2, margin=(0.06, 0.0, 0.06, 0.0), check=False)
