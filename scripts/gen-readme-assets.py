#!/usr/bin/env python3
"""Generate README visuals for dsh-ar-collection (docs/assets/).

Outputs (idempotent overwrite):
  dsh-ar-collection-hero-{zh,en}-{light,dark}.webp   1440x576 raster hero
  dsh-ar-collection-flow-v5-{light,dark}.svg         1100x660 SVG structure

Design notes
------------
* Hero: left column is prose (kicker / title / two value lines / one subtitle /
  one meta / footer). The right column is this plugin's own semantic graphic:
  a three-rung dunning ladder (提醒 7-14d / 催告 15-29d / 升级 >=30d) drawn as
  ascending stage cards, plus the resulting priority queue (#1..#4). Amounts,
  customer counts and next-action dates are the real quickstart fixture values
  (samples/quickstart/expected/result.json, as_of 2026-06-30): 4 chased
  customers / 7 invoices / 1,008,000.00 CNY, 1-1-2 customers per stage, and
  priority #2 (154,000) outranks #3 (330,000) because stage comes first.
* Flow: a stage-board grammar, not a row of five boxes: the read-only CSV and
  the policy converge on collection_plan, whose 7/15/30-day ladder places each
  overdue invoice into one of three stage columns (提醒 / 催告 / 升级); the
  customer cards inside those columns are ordered by the real priority rule
  (stage > amount > days past due > name). Only then do the three local
  artefacts fan out: the R0 plan report, the R1 Chinese letter drafts and the
  R1 collection-list CSV. Text is command-surface tokens plus the real stage
  labels, so all five README languages share one pair.

Run once:  python scripts/gen-readme-assets.py
Requires:  Python 3.10+ with Pillow; Windows fonts msyh.ttc / msyhbd.ttc /
           consola.ttf / segoeui.ttf / segoeuib.ttf.
"""
from __future__ import annotations

import html
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"

for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_EN, FONT_EN_BOLD):
    if not os.path.exists(_p):
        raise SystemExit(f"FATAL: font missing: {_p}")

WARNINGS: list[str] = []

# ------------------------------------------------------------------ palette
SKIN = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
        card_edge="#e4e1ee", zone="#f5f2fb", zone_edge="#e3def1",
        text="#141419", sub="#4d5261", faint="#8f94a4",
        accent="#4B67B4", warm="#b0470f",
        pill="#ece7f9", track="#eae6f3", grid="#e7e4f0",
        shadow=(32, 26, 64),
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
        card_edge="#2e374b", zone="#171e2d", zone_edge="#2b3448",
        text="#f0f3f9", sub="#a8b1c4", faint="#737b8d",
        accent="#8496f5", warm="#d9a03c",
        pill="#242d42", track="#243049", grid="#1e2636",
        shadow=(0, 0, 0),
    ),
}

# --------------------------------------------------------------- primitives


def font(size: int, kind: str = "cjk") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(
        {"cjk": FONT_CJK, "cjk_bold": FONT_CJK_BOLD, "mono": FONT_MONO,
         "en": FONT_EN, "en_bold": FONT_EN_BOLD}[kind], max(8, int(size)))


def hx(value: str):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = 0.25 * (y / h) + 0.75 * (y / h) ** 1.6
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(hx(c1), hx(c2))))
    return img


def glow(img: Image.Image, cx, cy, r, color, alpha=40) -> Image.Image:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(10, 0, -1):
        rr = r * i / 10
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 11)),))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def card(img: Image.Image, box, skin, radius=20, shadow=26) -> Image.Image:
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for i in range(shadow, 0, -3):
        sd.rounded_rectangle([x0 - i // 5, y0 + i // 2, x1 + i // 5, y1 + i],
                             radius=radius + i // 5,
                             fill=skin["shadow"] + (int(7 * (1 - i / shadow)),))
    base = Image.alpha_composite(
        img.convert("RGBA"), sh.filter(ImageFilter.GaussianBlur(12)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=hx(skin["card"]),
                        outline=hx(skin["card_edge"]), width=2)
    return base.convert("RGB")


def pill(img: Image.Image, xy, text, skin, size=20, kind="cjk_bold",
         fg=None, bg=None) -> Image.Image:
    d = ImageDraw.Draw(img)
    f = font(size, kind)
    tw = d.textlength(text, font=f)
    x, y = xy
    h = size + 22
    d.rounded_rectangle([x, y, x + tw + 36, y + h], radius=h // 2,
                        fill=hx(bg or skin["pill"]))
    d.text((x + 18, y + 10), text, font=f, fill=hx(fg or skin["accent"]))
    return img


def fit(d: ImageDraw.ImageDraw, text: str, kind: str, max_w: int,
        size: int, min_size: int = 14) -> int:
    size = int(size)
    while size > min_size:
        if d.textlength(text, font=font(size, kind)) <= max_w:
            return size
        size -= 2
    return max(min_size, size)


def write(img: Image.Image, xy, text, skin, size, kind="cjk", color="text",
          max_w=None, min_size=14, tag="") -> int:
    d = ImageDraw.Draw(img)
    if max_w is not None:
        size = fit(d, text, kind, max_w, size, min_size)
        if d.textlength(text, font=font(size, kind)) > max_w:
            WARNINGS.append(f"{tag}: {text!r} exceeds {max_w}px at {size}px")
            print(f"WARN {tag}: {text!r} exceeds {max_w}px at {size}px")
    d.text(xy, text, font=font(size, kind), fill=hx(skin[color]))
    return size


# --------------------------------------------------------------- hero model
# Real quickstart fixture (samples/quickstart/expected/result.json):
# 8 rows / 4 customers / 1 settled; 7 chased invoices; 1,008,000.00 CNY;
# stages remind 1 / notice 1 / escalate 2; priority #2 before #3.
HERO = {
    "zh": dict(
        kicker="DeepSeek Harness · 应收催收插件",
        title="dsh-ar-collection",
        value=["7 / 15 / 30 天，三档催收阶梯",
               "按优先级排出计划、函稿与清单"],
        sub="本地 CSV → 阶梯与优先级 → 中文函稿 + 清单 CSV",
        meta="R0 只读 / R1 本地写 · 不发送 · 不联网 · 不调模型",
        foot="Apache-2.0 · PerryLink DSH plugin family",
        ladder_title="催收阶梯 · 7 / 15 / 30 天",
        ladder_sub="as_of 2026-06-30 · 4 户应催 · ¥1,008,000",
        stages=[
            ("提醒", "7–14d · remind", "1 户 · 2 票", "next due+15"),
            ("催告", "15–29d · notice", "1 户 · 2 票", "next due+30"),
            ("升级", "≥30d · escalate", "2 户 · 3 票", "next as_of+7"),
        ],
        prio_title="优先级 1 → 4",
        prio_note="阶梯 > 金额 > 逾期天数",
        rows=[
            ("#1", "深圳蓝海电子有限公司", "升级", "¥320,000", "07-07"),
            ("#2", "江南纺织, 苏州", "升级", "¥154,000", "07-07"),
            ("#3", "北方重工设备有限公司", "催告", "¥330,000", "07-08"),
            ("#4", "华东精密制造有限公司", "提醒", "¥204,000", "07-03"),
        ],
    ),
    "en": dict(
        kicker="DeepSeek Harness · AR collections plugin",
        title="dsh-ar-collection",
        value=["A 7 / 15 / 30-day dunning ladder",
               "Priority queue, letter drafts, list CSV"],
        sub="Local CSV → ladder + priority → letters and list CSV",
        meta="R0 read-only / R1 local write · no send · no network · no model",
        foot="Apache-2.0 · PerryLink DSH plugin family",
        ladder_title="dunning ladder · 7 / 15 / 30 days",
        ladder_sub="as_of 2026-06-30 · 4 customers · ¥1,008,000",
        stages=[
            ("remind", "7–14d · 2 inv", "1 customer", "next due+15"),
            ("notice", "15–29d · 2 inv", "1 customer", "next due+30"),
            ("escalate", "≥30d · 3 inv", "2 customers", "next as_of+7"),
        ],
        prio_title="priority 1 → 4",
        prio_note="stage > amount > days",
        rows=[
            ("#1", "深圳蓝海电子有限公司", "escalate", "¥320,000", "07-07"),
            ("#2", "江南纺织, 苏州", "escalate", "¥154,000", "07-07"),
            ("#3", "北方重工设备有限公司", "notice", "¥330,000", "07-08"),
            ("#4", "华东精密制造有限公司", "remind", "¥204,000", "07-03"),
        ],
    ),
}


def hero(lang: str, skin_name: str) -> None:
    s = SKIN[skin_name]
    model = HERO[lang]
    w, h = 1440, 576
    img = gradient(w, h, s["bg_from"], s["bg_to"])
    img = glow(img, 1220, 40, 430, hx(s["accent"]),
               22 if skin_name == "light" else 38)
    img = glow(img, 120, 560, 300, hx(s["accent"]),
               10 if skin_name == "light" else 16)

    left_w = 800
    m = 60

    # ------------------------------------------------------------- left column
    img = pill(img, (m, 62), model["kicker"], s,
               size=20 if lang == "zh" else 19,
               kind="cjk_bold" if lang == "zh" else "en_bold")
    d = ImageDraw.Draw(img)
    tsize = fit(d, model["title"], "mono", left_w, 84, 72)
    d.text((m, 124), model["title"], font=font(tsize, "mono"),
           fill=hx(s["text"]))

    vkind = "cjk_bold" if lang == "zh" else "en_bold"
    vsize = 34 if lang == "zh" else 32
    for line in model["value"]:
        vsize = min(vsize, fit(d, line, vkind, left_w, vsize, 28))
    for i, line in enumerate(model["value"]):
        write(img, (m, 252 + i * (vsize + 14)), line, s, vsize, vkind,
              "text", left_w, 28, f"hero.{lang}.value{i}")

    write(img, (m + 2, 384), model["sub"], s, 26,
          "cjk" if lang == "zh" else "en", "sub", left_w, 24,
          f"hero.{lang}.sub")
    write(img, (m + 2, 442), model["meta"], s, 20,
          "cjk" if lang == "zh" else "en", "faint", left_w, 17,
          f"hero.{lang}.meta")

    d = ImageDraw.Draw(img)
    d.line([m + 2, 482, m + 760, 482], fill=hx(s["grid"]), width=2)
    write(img, (m + 2, 496), model["foot"], s, 17, "en", "faint", 760, 14,
          f"hero.{lang}.foot")

    # ------------------------------------------------ card A: dunning ladder
    img = card(img, (880, 48, 1380, 336), s, radius=22)
    write(img, (904, 68), model["ladder_title"], s, 24 if lang == "zh" else 22,
          "cjk_bold" if lang == "zh" else "en_bold", "text", 452, 18,
          f"hero.{lang}.ladder_title")
    write(img, (904, 100), model["ladder_sub"], s, 16,
          "cjk" if lang == "zh" else "en", "sub", 452, 14,
          f"hero.{lang}.ladder_sub")

    step_boxes = [(904, 196, 1044, 332), (1060, 160, 1200, 296),
                  (1216, 124, 1356, 260)]
    for i, ((x0, y0, x1, y1), (label, meta, count, rule)) in enumerate(
            zip(step_boxes, model["stages"])):
        img = card(img, (x0, y0, x1, y1), s, radius=16, shadow=18)
        d = ImageDraw.Draw(img)
        last = i == len(step_boxes) - 1
        d.rounded_rectangle([x0, y0, x1, y1], radius=16,
                            outline=hx(s["accent"] if last else s["card_edge"]),
                            width=2 if last else 1)
        write(img, (x0 + 14, y0 + 28), label, s, 20 if lang == "zh" else 19,
              "cjk_bold" if lang == "zh" else "en_bold", "text", 112, 15,
              f"hero.{lang}.stage{i}")
        write(img, (x0 + 14, y0 + 64), meta, s, 12, "mono", "sub", 112, 10,
              f"hero.{lang}.stage{i}.meta")
        write(img, (x0 + 14, y0 + 92), count, s, 13,
              "cjk" if lang == "zh" else "en", "sub", 112, 11,
              f"hero.{lang}.stage{i}.count")
        write(img, (x0 + 14, y0 + 118), rule, s, 12, "mono", "accent",
              112, 10, f"hero.{lang}.stage{i}.rule")

    # ---------------------------------------------- card B: priority queue
    img = card(img, (880, 352, 1380, 516), s, radius=20)
    write(img, (904, 372), model["prio_title"], s, 22,
          "cjk_bold" if lang == "zh" else "en_bold", "text", 240, 16,
          f"hero.{lang}.prio_title")
    d = ImageDraw.Draw(img)
    d.text((1356, 376), model["prio_note"], font=font(14, "cjk" if lang == "zh"
                                                     else "en"),
           fill=hx(s["faint"]), anchor="ra")
    d.line([904, 396, 1356, 396], fill=hx(s["grid"]), width=2)
    for i, (rank, name, stage, amount, date) in enumerate(model["rows"]):
        y = 406 + i * 28
        d = ImageDraw.Draw(img)
        d.text((904, y), rank, font=font(14, "mono"), fill=hx(s["faint"]))
        write(img, (930, y - 2), name, s, 16, "cjk_bold", "text", 168, 13,
              f"hero.{lang}.row{i}.name")
        write(img, (1112, y), stage, s, 14,
              "cjk" if lang == "zh" else "en", "accent", 66, 11,
              f"hero.{lang}.row{i}.stage")
        d.text((1250, y - 1), amount, font=font(14, "mono"),
               fill=hx(s["text"]), anchor="ra")
        d.text((1356, y - 1), date, font=font(14, "mono"),
               fill=hx(s["faint"]), anchor="ra")
        if i < 3:
            d.line([904, y + 20, 1356, y + 20], fill=hx(s["grid"]), width=1)

    img.save(os.path.join(OUT, f"dsh-ar-collection-hero-{lang}-{skin_name}.webp"),
             "WEBP", quality=92)
    print(f"wrote dsh-ar-collection-hero-{lang}-{skin_name}.webp")


# -------------------------------------------------------------- SVG helpers
MONO = "Consolas, ui-monospace, SFMono-Regular, Menlo, monospace"
SANS = ("'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Segoe UI', "
        "system-ui, sans-serif")


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def text(x, y, body, size, fill, kind="mono", bold=False, anchor=None,
         opacity=None, spacing=None) -> str:
    attrs = [f'x="{x}"', f'y="{y}"', f'fill="{fill}"',
             f'font-family="{MONO if kind == "mono" else SANS}"',
             f'font-size="{size}"']
    if bold:
        attrs.append('font-weight="700"')
    if anchor:
        attrs.append(f'text-anchor="{anchor}"')
    if opacity is not None:
        attrs.append(f'opacity="{opacity}"')
    if spacing is not None:
        attrs.append(f'letter-spacing="{spacing}"')
    return f'<text {" ".join(attrs)}>{esc(body)}</text>'


def rect(x, y, w, h, fill, stroke=None, width=1.5, radius=18,
         filt=None) -> str:
    attrs = [f'x="{x}"', f'y="{y}"', f'width="{w}"', f'height="{h}"',
             f'rx="{radius}"', f'fill="{fill}"']
    if stroke:
        attrs += [f'stroke="{stroke}"', f'stroke-width="{width}"']
    if filt:
        attrs.append(f'filter="url(#{filt})"')
    return f'<rect {" ".join(attrs)}/>'


def line(x1, y1, x2, y2, stroke, width=1.5, dash=None) -> str:
    attrs = [f'x1="{x1}"', f'y1="{y1}"', f'x2="{x2}"', f'y2="{y2}"',
             f'stroke="{stroke}"', f'stroke-width="{width}"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    return f'<line {" ".join(attrs)}/>'


def path(d, stroke, width=2, fill="none", dash=None, linecap="round") -> str:
    attrs = [f'd="{d}"', f'fill="{fill}"', f'stroke="{stroke}"',
             f'stroke-width="{width}"', f'stroke-linecap="{linecap}"',
             'stroke-linejoin="round"']
    if dash:
        attrs.append(f'stroke-dasharray="{dash}"')
    return f'<path {" ".join(attrs)}/>'


# ------------------------------------------------------------- flow diagram
FLOW = {
    "light": dict(bg_from="#f9f6fd", bg_to="#e4eaf8", card="#ffffff",
                  edge="#e4e1ee", zone="#f4f1fb", zone_edge="#e3def1",
                  text="#141419", sub="#4d5261", faint="#8f94a4",
                  accent="#4B67B4", warm="#b0470f", pill="#ece7f9",
                  track="#eae6f3", grid="#e7e4f0", dot="#d9d3ea"),
    "dark": dict(bg_from="#131a2a", bg_to="#0c1016", card="#1b2231",
                 edge="#2e374b", zone="#171e2d", zone_edge="#2b3448",
                 text="#f0f3f9", sub="#a8b1c4", faint="#737b8d",
                 accent="#8496f5", warm="#d9a03c", pill="#242d42",
                 track="#243049", grid="#1e2636", dot="#26314a"),
}

STAGES = [
    dict(label="提醒", key="remind", range="7–14d", next_rule="due+15",
         pay_by="as_of+10", customers=1, invoices=2, amount="¥204,000"),
    dict(label="催告", key="notice", range="15–29d", next_rule="due+30",
         pay_by="as_of+7", customers=1, invoices=2, amount="¥330,000"),
    dict(label="升级", key="escalate", range="≥30d", next_rule="as_of+7",
         pay_by="as_of+3", customers=2, invoices=3, amount="¥474,000"),
]

CUSTOMERS = [
    dict(rank="#1", name="深圳蓝海电子有限公司", stage=2, count=1,
         amount="¥320,000", next="07-07",
         invoices=[("INV-2026-0041", "41d")]),
    dict(rank="#2", name="江南纺织, 苏州", stage=2, count=2,
         amount="¥154,000", next="07-07",
         invoices=[("INV-2026-0032", "46d"), ("INV-2026-0031", "36d")]),
    dict(rank="#3", name="北方重工设备有限公司", stage=1, count=2,
         amount="¥330,000", next="07-08",
         invoices=[("INV-2026-0022", "22d"), ("INV-2026-0021", "20d")]),
    dict(rank="#4", name="华东精密制造有限公司", stage=0, count=2,
         amount="¥204,000", next="07-03",
         invoices=[("INV-2026-0002", "12d"), ("INV-2026-0001", "10d")]),
]

COL_X = [288, 552, 816]
COL_W = 240
COL_TOP = 210
COL_H = 260
CARD_X_OFF = 16
CARD_W = 208
CARD_TOP = 296


def flow_svg(skin_name: str) -> str:
    s = FLOW[skin_name]
    w, h = 1100, 660
    p: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" aria-label="dsh-ar-collection '
        f'structure: one read-only receivables CSV plus a policy feed '
        f'collection_plan; the 7/15/30-day ladder places 7 overdue invoices '
        f'into remind / notice / escalate columns and customers are ranked by '
        f'stage, amount and days past due; three local artefacts follow - the '
        f'plan report, 4 Chinese letter drafts and a 7-row collection-list CSV">',
        '<title>dsh-ar-collection: one plan snapshot, three local artefacts</title>',
        '<defs>',
        '<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">',
        f'<stop offset="0" stop-color="{s["bg_from"]}"/>',
        f'<stop offset="1" stop-color="{s["bg_to"]}"/>',
        '</linearGradient>',
        '<filter id="soft" x="-30%" y="-30%" width="160%" height="180%">',
        '<feDropShadow dx="0" dy="8" stdDeviation="11" flood-color="#1b1735" '
        'flood-opacity="0.10"/></filter>',
        '<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">',
        f'<circle cx="1.4" cy="1.4" r="1.4" fill="{s["dot"]}"/></pattern>',
        '</defs>',
        f'<rect width="{w}" height="{h}" fill="url(#bg)"/>',
        f'<rect width="{w}" height="{h}" fill="url(#dots)" opacity=".45"/>',
    ]

    # ------------------------------------------------------------------ header
    p += [
        text(44, 62, "dsh-ar-collection", 34, s["text"], bold=True),
        text(44, 88, "receivables CSV → 7/15/30 ladder → per-customer priority "
                     "→ 3 local artefacts", 15, s["sub"], kind="sans"),
        rect(644, 40, 412, 34, s["pill"], radius=17),
        text(850, 62, "as_of 2026-06-30 · days [7,15,30] · fixture", 14,
             s["accent"], anchor="middle"),
        line(44, 106, 1056, 106, s["grid"]),
    ]

    # ------------------------------------------------------------- input card
    p += [
        f'<g filter="url(#soft)">{rect(40, 124, 228, 346, s["card"], s["edge"], radius=20)}</g>',
        text(60, 158, "INPUT CSV · READ-ONLY", 14, s["accent"]),
        text(60, 190, "ar-collection.csv", 19, s["text"], bold=True),
        text(60, 216, "8 rows · 4 customers", 14, s["sub"]),
        text(60, 238, "1 settled · 2 partial", 14, s["sub"]),
        text(60, 260, "UTF-8 · ≤20 MB", 14, s["sub"]),
        line(60, 276, 248, 276, s["grid"]),
        text(60, 296, "columns · 6", 14, s["faint"]),
    ]
    for i, col in enumerate(["customer", "invoice_no", "due_date",
                             "amount_cents", "paid_cents", "contact_email"]):
        p.append(text(60, 318 + i * 22, col, 14, s["sub"]))
    p += [
        text(60, 456, "sha256 c9a2f94a…", 14, s["faint"]),
        # CSV -> plan contract
        path("M270 160 H284", s["accent"], width=2.2),
        path("M280 156 L286 160 L280 164", s["accent"], width=2.2),
    ]

    # ------------------------------------------------------------ plan strip
    p += [
        f'<g filter="url(#soft)">{rect(288, 124, 768, 72, s["zone"], s["zone_edge"], radius=18)}</g>',
        text(304, 152, "collection_plan · R0", 20, s["text"], bold=True),
        text(304, 178, "as_of 2026-06-30 · days [7,15,30] · "
                       "min_amount_cents 0 · include_settled false", 14,
             s["sub"]),
        text(1040, 152, "settled 1 · below_min 0 · snapshot", 14, s["faint"],
             anchor="end"),
    ]

    # --------------------------------------------------------------- columns
    cards_by_stage = {0: [], 1: [], 2: []}
    for c in CUSTOMERS:
        cards_by_stage[c["stage"]].append(c)

    for idx, stage in enumerate(STAGES):
        x = COL_X[idx]
        p.append(f'<g filter="url(#soft)">{rect(x, COL_TOP, COL_W, COL_H, s["zone"], s["zone_edge"], radius=18)}</g>')
        p += [
            text(x + 16, 240, stage["label"], 20, s["text"], kind="sans",
                 bold=True),
            text(x + 16, 262, f'{stage["range"]} · {stage["key"]} · '
                              f'{stage["invoices"]} 票', 14, s["sub"]),
            text(x + 16, 284, f'{stage["customers"]} 户 · {stage["amount"]}',
                 14, s["accent"]),
        ]

        y = CARD_TOP
        for c in cards_by_stage[idx]:
            hgt = 74 if len(c["invoices"]) == 1 else 88
            cx = x + CARD_X_OFF
            p.append(f'<g filter="url(#soft)">{rect(cx, y, CARD_W, hgt, s["card"], s["edge"], radius=14)}</g>')
            p += [
                text(cx + 12, y + 26, c["name"], 16.5, s["text"], kind="sans",
                     bold=True),
                text(cx + 196, y + 24, c["rank"], 14, s["accent"],
                     anchor="end"),
                text(cx + 12, y + 48, f'{c["count"]} 票 · {c["amount"]}', 14,
                     s["text"]),
                text(cx + 196, y + 48, c["next"], 14, s["faint"],
                     anchor="end"),
            ]
            for j, (inv, days) in enumerate(c["invoices"]):
                p.append(text(cx + 12, y + 66 + j * 16,
                              f'{inv} · {days}', 14, s["sub"]))
            y += hgt + 6

    # ---------------------------------------------------------- fan-out bus
    p += [
        path("M672 470 V478", s["accent"], width=2),
        path("M201 478 H893", s["accent"], width=2),
        path("M201 478 V486", s["accent"], width=2),
        path("M547 478 V486", s["accent"], width=2),
        path("M893 478 V486", s["accent"], width=2),
        f'<circle cx="201" cy="478" r="2.6" fill="{s["accent"]}"/>',
        f'<circle cx="547" cy="478" r="2.6" fill="{s["accent"]}"/>',
        f'<circle cx="893" cy="478" r="2.6" fill="{s["accent"]}"/>',
    ]

    # --------------------------------------------------------- outputs band
    out_cards = [
        (40, "collection_plan · R0", [
            ("as_of · source_sha256 · policy", s["sub"]),
            ("totals · stages[3] · customers[4]", s["sub"]),
            ("priority · stage · next_action_date", s["sub"]),
            ("→ 7 invoices · ¥1,008,000", s["accent"]),
        ]),
        (386, "collection_letters · R1", [
            ("1 .txt per chase customer · 4", s["sub"]),
            ("pay_by as_of+10 / +7 / +3", s["sub"]),
            ("→ $DSH_HOME/dsh-ar-collection/", s["sub"]),
            ("letters/letter-01.txt … -04.txt", s["accent"]),
        ]),
        (732, "collection_export · R1", [
            ("rows 7 + header · 4 customers", s["sub"]),
            ("客户,票号,到期日,金额,阶梯,动作日期", s["sub"]),
            ("→ exports/", s["sub"]),
            ("collection-2026-06-30.csv", s["accent"]),
        ]),
    ]
    for x, title, rows in out_cards:
        p.append(f'<g filter="url(#soft)">{rect(x, 486, 322, 126, s["card"], s["edge"], radius=18)}</g>')
        p.append(text(x + 14, 512, title, 18, s["text"], bold=True))
        for i, (body, fill) in enumerate(rows):
            p.append(text(x + 14, 538 + i * 21, body, 14, fill))

    # ---------------------------------------------------------------- footer
    p += [
        text(44, 630, "next_action_date: remind due+15 · notice due+30 · "
                      "escalate as_of+7 · customer stage = worst invoice", 14,
             s["sub"]),
        text(44, 648, "priority: stage > amount > days · days_past_due = "
                      "as_of − due_date (UTC) · <7d = pre_ladder · "
                      "R0 read-only / R1 local write · no network", 14,
             s["faint"], kind="sans"),
        '</svg>',
    ]
    return "\n".join(p) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ("zh", "en"):
        for skin_name in ("light", "dark"):
            hero(lang, skin_name)
    for skin_name in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-ar-collection-flow-v5-{skin_name}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin_name))
        print(f"wrote dsh-ar-collection-flow-v5-{skin_name}.svg")
    if WARNINGS:
        print(f"{len(WARNINGS)} width warning(s)")
    else:
        print("no text-width warnings")


if __name__ == "__main__":
    main()
