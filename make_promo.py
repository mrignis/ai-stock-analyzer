# -*- coding: utf-8 -*-
"""Generate the two Chrome Web Store promo images (24-bit PNG, no alpha):
  promo-small-440x280.png    (Small promo tile, 440x280)
  promo-marquee-1400x560.png (Marquee, 1400x560)
Rendered at 3x and downsampled with LANCZOS → crisp text/edges (not soft).
Branded to match the extension: dark theme + green accent.
"""
import os, random
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Desktop
FONT = "C:/Windows/Fonts/segoeui.ttf"
FONTB = "C:/Windows/Fonts/segoeuib.ttf"
SS = 3  # supersample factor

GREEN = (74, 222, 128); RED = (248, 113, 113); TEXT = (233, 236, 240)
MUTED = (140, 149, 168); CARD = (24, 29, 41); BORDER = (44, 53, 71)

def f(sz, bold=True): return ImageFont.truetype(FONTB if bold else FONT, sz * SS)

class SD:
    """Draw wrapper: write 1x coordinates/sizes, it renders on the SSx canvas."""
    def __init__(self, d): self.d = d
    def _pts(self, p): return [(x * SS, y * SS) for x, y in p]
    def _box(self, b): return [v * SS for v in b]
    def text(self, xy, s, font, fill): self.d.text((xy[0] * SS, xy[1] * SS), s, font=font, fill=fill)
    def tlen(self, s, font): return self.d.textlength(s, font=font) / SS
    def line(self, pts, fill, width=1, joint=None): self.d.line(self._pts(pts), fill=fill, width=max(1, width * SS), joint=joint)
    def polygon(self, pts, fill): self.d.polygon(self._pts(pts), fill=fill)
    def rrect(self, box, radius, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self._box(box), radius=radius * SS, fill=fill, outline=outline, width=max(1, width * SS))

def canvas(w, h, top, bot):
    img = Image.new("RGB", (w * SS, h * SS), top)
    d = ImageDraw.Draw(img)
    for y in range(h * SS):
        t = y / (h * SS - 1)
        d.line([(0, y), (w * SS, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img, SD(d)

def finish(img, w, h, name):
    img.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, name))
    print("saved", name)

def mark(d, x, y, s, color=GREEN): d.polygon([(x, y + s), (x + s / 2.0, y), (x + s, y + s)], color)

def sparkline(d, x, y, w, h, color, seed, width=3, fill=None):
    random.seed(seed); n = 40; pts = []; v = 0.5
    for i in range(n):
        v = max(0.12, min(0.9, v + (random.random() - 0.45) * 0.15))
        pts.append((x + w * i / (n - 1.0), y + h * (1 - v)))
    if fill: d.polygon(pts + [(x + w, y + h), (x, y + h)], fill)
    d.line(pts, color, width, "curve")

def pill(d, xy, text, fg, bg, font, pad=(16, 8)):
    x, y = xy; tw = d.tlen(text, font); th = font.size / SS
    w, h = tw + pad[0] * 2, th + pad[1] * 2
    d.rrect([x, y, x + w, y + h], h / 2, fill=bg)
    d.text((x + pad[0], y + pad[1] - 1), text, font, fg)
    return w, h

def small():
    W, H = 440, 280
    img, d = canvas(W, H, (15, 18, 27), (8, 10, 16))
    sparkline(d, 0, 150, W, 130, (48, 92, 62), 7, 3, fill=(15, 29, 21))
    mark(d, 26, 27, 15); d.text((48, 23), "AI Stocks", f(17), GREEN)
    d.text((26, 72), "AI Stock", f(40), TEXT); d.text((26, 114), "Analyzer", f(40), TEXT)
    pill(d, (250, 84), "BUY", (9, 14, 9), GREEN, f(20))
    d.text((26, 176), "Instant AI analysis of any", f(15, False), MUTED)
    d.text((26, 197), "stock or crypto.", f(15, False), MUTED)
    d.text((26, 242), "Free · No API keys · UA · EN · FR", f(13, False), (112, 120, 138))
    finish(img, W, H, "promo-small-440x280.png")

def marquee():
    W, H = 1400, 560
    img, d = canvas(W, H, (16, 19, 29), (8, 10, 16))
    sparkline(d, 0, 300, W, 260, (42, 80, 56), 3, 3, fill=(13, 26, 19))
    mark(d, 80, 75, 26); d.text((116, 68), "AI Stocks", f(30), GREEN)
    d.text((78, 130), "AI Stock Analyzer", f(76), TEXT)
    d.text((80, 233), "Instant AI verdict on any stock or crypto —", f(29, False), (203, 208, 218))
    d.text((80, 272), "no API keys, no sign-up, completely free.", f(29, False), (203, 208, 218))
    cx = 80
    for c in ["AI Buy/Hold/Sell", "Analyst ratings", "Portfolio + P&L", "3 languages"]:
        w, _ = pill(d, (cx, 342), c, GREEN, (22, 41, 28), f(22, False), (18, 9)); cx += w + 12
    cxx, cyy, cw, ch = 900, 118, 420, 322
    d.rrect([cxx, cyy, cxx + cw, cyy + ch], 18, fill=CARD, outline=BORDER, width=2)
    d.text((cxx + 28, cyy + 26), "USD 178.45", f(34), TEXT)
    d.text((cxx + 28, cyy + 71), "▲ +3.21 (+1.83%)", f(20, False), GREEN)
    d.text((cxx + 28, cyy + 116), "NVDA", f(30), GREEN)
    pill(d, (cxx + 145, cyy + 116), "Buy", (9, 14, 9), GREEN, f(20))
    by = cyy + 178; d.text((cxx + 28, by), "ANALYSTS · 68", f(14, False), MUTED)
    bx, bw = cxx + 28, cw - 56
    d.rrect([bx, by + 26, bx + int(bw * .82), by + 36], 5, fill=GREEN)
    d.rrect([bx + int(bw * .82), by + 26, bx + int(bw * .95), by + 36], 5, fill=MUTED)
    d.rrect([bx + int(bw * .95), by + 26, bx + bw, by + 36], 5, fill=RED)
    d.text((cxx + 28, by + 48), "56 buy    9 hold    3 sell", f(18, False), (182, 188, 202))
    sparkline(d, cxx + 28, cyy + 252, cw - 56, 50, GREEN, 11, 2)
    finish(img, W, H, "promo-marquee-1400x560.png")

small(); marquee(); print("OUT:", OUT)
