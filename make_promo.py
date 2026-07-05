# -*- coding: utf-8 -*-
"""Generate the two Chrome Web Store promo images (24-bit PNG, no alpha):
  promo-small-440x280.png   (Small promo tile)
  promo-marquee-1400x560.png (Marquee)
Branded to match the extension: dark theme + green accent.
"""
import os, math
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # Desktop
FONT = "C:/Windows/Fonts/segoeui.ttf"
FONTB = "C:/Windows/Fonts/segoeuib.ttf"

GREEN = (74, 222, 128)
RED = (248, 113, 113)
TEXT = (232, 234, 237)
MUTED = (138, 147, 167)
CARD = (26, 31, 43)
BORDER = (42, 51, 69)

def f(sz, bold=True): return ImageFont.truetype(FONTB if bold else FONT, sz)

def mark(d, x, y, s, color=GREEN):
    # small green up-triangle logo glyph (Segoe UI can't render the 📈 emoji)
    d.polygon([(x, y + s), (x + s / 2, y), (x + s, y + s)], fill=color)

def vgrad(w, h, top, bot):
    img = Image.new("RGB", (w, h), top)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img

def sparkline(d, x, y, w, h, color, seed=1, width=3, fill_below=None):
    import random
    random.seed(seed)
    n = 34
    pts, val = [], 0.5
    for i in range(n):
        val += (random.random() - 0.45) * 0.16
        val = max(0.12, min(0.9, val))
        pts.append((x + w * i / (n - 1), y + h * (1 - val)))
    if fill_below:
        poly = pts + [(x + w, y + h), (x, y + h)]
        d.polygon(poly, fill=fill_below)
    d.line(pts, fill=color, width=width, joint="curve")

def pill(d, xy, text, fg, bg, font, pad=(16, 7)):
    x, y = xy
    tw = d.textlength(text, font=font)
    th = font.size
    w = tw + pad[0] * 2
    h = th + pad[1] * 2
    d.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=bg)
    d.text((x + pad[0], y + pad[1] - 1), text, font=font, fill=fg)
    return w, h

# ── Small promo 440×280 ──────────────────────────────────────────────
def small():
    W, H = 440, 280
    img = vgrad(W, H, (14, 17, 26), (8, 10, 16))
    d = ImageDraw.Draw(img)
    sparkline(d, 0, 150, W, 130, (46, 90, 60), seed=7, width=4, fill_below=(16, 30, 22))
    mark(d, 26, 26, 16)
    d.text((50, 23), "AI Stocks", font=f(17), fill=GREEN)
    d.text((26, 74), "AI Stock", font=f(40), fill=TEXT)
    d.text((26, 116), "Analyzer", font=f(40), fill=TEXT)
    pill(d, (250, 84), "BUY", (10, 15, 10), GREEN, f(20))
    d.text((26, 176), "Instant AI analysis of any", font=f(15, False), fill=MUTED)
    d.text((26, 197), "stock or crypto.", font=f(15, False), fill=MUTED)
    d.text((26, 240), "Free · No API keys · UA · EN · FR", font=f(13, False), fill=(110, 118, 135))
    img.save(os.path.join(OUT, "promo-small-440x280.png"))
    print("saved promo-small-440x280.png")

# ── Marquee 1400×560 ─────────────────────────────────────────────────
def marquee():
    W, H = 1400, 560
    img = vgrad(W, H, (15, 18, 28), (8, 10, 16))
    d = ImageDraw.Draw(img)
    sparkline(d, 0, 300, W, 260, (40, 78, 54), seed=3, width=5, fill_below=(14, 27, 20))
    # Left column
    mark(d, 80, 74, 28)
    d.text((118, 68), "AI Stocks", font=f(30), fill=GREEN)
    d.text((78, 130), "AI Stock Analyzer", font=f(76), fill=TEXT)
    d.text((80, 232), "Instant AI verdict on any stock or crypto —", font=f(30, False), fill=(200, 205, 215))
    d.text((80, 272), "no API keys, no sign-up, completely free.", font=f(30, False), fill=(200, 205, 215))
    chips = ["AI Buy/Hold/Sell", "Analyst ratings", "Portfolio + P&L", "3 languages"]
    cx = 80
    for c in chips:
        w, h = pill(d, (cx, 340), c, GREEN, (22, 40, 28), f(22, False), pad=(18, 9))
        cx += w + 12
    # Right: mock analysis card
    cardx, cardy, cw, ch = 900, 120, 420, 320
    d.rounded_rectangle([cardx, cardy, cardx + cw, cardy + ch], radius=18, fill=CARD, outline=BORDER, width=2)
    d.text((cardx + 28, cardy + 26), "USD 178.45", font=f(34), fill=TEXT)
    d.text((cardx + 28, cardy + 70), "▲ +3.21 (+1.83%)", font=f(20, False), fill=GREEN)
    d.text((cardx + 28, cardy + 118), "NVDA", font=f(30), fill=GREEN)
    pill(d, (cardx + 140, cardy + 116), "Buy", (10, 15, 10), GREEN, f(20))
    # analyst bar
    by = cardy + 178
    d.text((cardx + 28, by), "ANALYSTS · 68", font=f(14, False), fill=MUTED)
    bx, bw = cardx + 28, cw - 56
    d.rounded_rectangle([bx, by + 24, bx + int(bw * 0.82), by + 34], radius=5, fill=GREEN)
    d.rounded_rectangle([bx + int(bw * 0.82), by + 24, bx + int(bw * 0.95), by + 34], radius=5, fill=MUTED)
    d.rounded_rectangle([bx + int(bw * 0.95), by + 24, bx + bw, by + 34], radius=5, fill=RED)
    d.text((cardx + 28, by + 46), "56 buy   9 hold   3 sell", font=f(18, False), fill=(180, 186, 200))
    sparkline(d, cardx + 28, cardy + 250, cw - 56, 50, GREEN, seed=11, width=3)
    img.save(os.path.join(OUT, "promo-marquee-1400x560.png"))
    print("saved promo-marquee-1400x560.png")

small()
marquee()
print("OUT dir:", OUT)
