#!/usr/bin/env python3
"""Build the VisaAI brand asset set from a logo master.

Handles both lockup shapes this brand has shipped, because the master has
changed style twice and hand-tuned crops did not survive it:

  HORIZONTAL  glyph left, wordmark right  -> used as-is
  STACKED     glyph above, wordmark below -> split and recomposed horizontally,
              because the sidebar and auth slots size by height (h-7/h-9) and a
              square lockup there renders ~8px lettering

Masters have also arrived with three different backgrounds — already
transparent, transparent-with-an-alpha-halo, and a white card on black — so
nothing here keys on a fixed colour. Black and white are cleared by flooding
inward from the border, which preserves the white inside flags and letterforms
that a global colour key destroys, and trimming uses an alpha THRESHOLD because
PIL's getbbox() counts any alpha > 0 and a halo makes it a no-op.

Usage:  make-brand-assets.py <master.png> <out-dir> [version-suffix]
Needs Pillow. Not wired into any build script.
"""
from collections import deque
import sys
from PIL import Image

SRC = sys.argv[1]
OUT = sys.argv[2]
SUFFIX = f"-{sys.argv[3]}" if len(sys.argv) > 3 else ""
ALPHA_MIN = 24
GAP_MIN = 12  # transparent run wide/tall enough to be a real gap, not letter spacing


def flood_clear(im, match):
    """Clear pixels matching `match` reachable from the border."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h):
            continue
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        p = px[x, y]
        if p[3] != 0 and not match(p):
            continue
        px[x, y] = (255, 255, 255, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def trim(im):
    a = im.getchannel("A").point(lambda v: 255 if v >= ALPHA_MIN else 0)
    box = a.getbbox()
    return im.crop(box) if box else im


def profile(im, axis):
    """Filled-pixel count per column (axis=0) or per row (axis=1)."""
    w, h = im.size
    a = im.getchannel("A").point(lambda v: 1 if v >= ALPHA_MIN else 0)
    if axis == 0:
        return [sum(a.crop((x, 0, x + 1, h)).getdata()) for x in range(w)]
    return [sum(a.crop((0, y, w, y + 1)).getdata()) for y in range(h)]


def first_gap(counts):
    """Start index of the first run of >= GAP_MIN empty slots, else None."""
    run = 0
    for i, c in enumerate(counts):
        run = run + 1 if c == 0 else 0
        if run >= GAP_MIN:
            return i - run + 1
    return None


def widest_gap(counts):
    best, run, start = None, 0, 0
    for i, c in enumerate(counts):
        if c == 0:
            if run == 0:
                start = i
            run += 1
        else:
            if run >= GAP_MIN and (best is None or run > best[1]):
                best = (start, run)
            run = 0
    return best[0] + best[1] // 2 if best else None


def square(glyph, pad_ratio=0.05):
    side = max(glyph.size)
    pad = round(side * pad_ratio)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (255, 255, 255, 0))
    canvas.alpha_composite(
        glyph, ((canvas.width - glyph.width) // 2, (canvas.height - glyph.height) // 2)
    )
    return canvas


def main():
    raw = Image.open(SRC).convert("RGBA")
    art = flood_clear(raw, lambda p: max(p[:3]) <= 40)      # black field, if any
    art = trim(art)
    if art.width > raw.width * 0.95 and art.height > raw.height * 0.95:
        # nothing trimmed: likely a white card, so inset past its anti-aliased
        # border before clearing white, or the border survives as faint arcs
        inset = round(min(art.size) * 0.06)
        art = art.crop((inset, inset, art.width - inset, art.height - inset))
        art = trim(flood_clear(art, lambda p: min(p[:3]) >= 225))
    print("art:", art.size)

    stacked = art.height > art.width * 0.75
    print("orientation:", "stacked" if stacked else "horizontal")

    if stacked:
        split = widest_gap(profile(art, 1)) or int(art.height * 0.62)
        glyph = trim(art.crop((0, 0, art.width, split)))
        word = trim(art.crop((0, split, art.width, art.height)))
        target_h = 300
        g = glyph.resize(
            (round(glyph.width * target_h / glyph.height), target_h), Image.LANCZOS
        )
        wh = round(target_h * 0.62)
        wm = word.resize((round(word.width * wh / word.height), wh), Image.LANCZOS)
        gap = round(target_h * 0.12)
        lock = Image.new(
            "RGBA", (g.width + gap + wm.width, target_h), (255, 255, 255, 0)
        )
        lock.alpha_composite(g, (0, 0))
        lock.alpha_composite(wm, (g.width + gap, (target_h - wh) // 2))
        lock = trim(lock)
    else:
        lock = art
        cut = first_gap(profile(art, 0)) or int(art.height * 1.05)
        glyph = trim(art.crop((0, 0, cut, art.height)))
        print("glyph cut at x =", cut)

    lock.save(f"{OUT}/wordmark{SUFFIX}.png")
    print("lockup:", lock.size)

    icon = square(glyph)
    for s in (512, 192, 180, 32):
        icon.resize((s, s), Image.LANCZOS).save(f"{OUT}/mark{SUFFIX}-{s}.png")
    print("glyph:", glyph.size, "-> icon canvas", icon.size)

    icon.resize((1024, 1024), Image.LANCZOS).save(f"{OUT}/app-icon{SUFFIX}.png")

    # OG card stays opaque: some clients composite transparency onto black,
    # which would bury a navy wordmark.
    og = Image.new("RGBA", (1200, 630), (255, 255, 255, 255))
    scale = min(880 / lock.width, 330 / lock.height)
    l2 = lock.resize(
        (round(lock.width * scale), round(lock.height * scale)), Image.LANCZOS
    )
    og.alpha_composite(l2, ((1200 - l2.width) // 2, (630 - l2.height) // 2))
    og.convert("RGB").save(f"{OUT}/og{SUFFIX}.png")
    print("og: (1200, 630)")


main()
