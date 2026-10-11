#!/usr/bin/env python3
"""One-off generator for the static tournament trophy pool (ADR-26 §UI).

The pool is source-defined: a trophy is a PNG under nextjs/public/trophies/
named <trophy>.png, listed in nextjs/lib/trophies.ts and pkg/elo/trophies.go.
Organizers can only pick trophies from that pool, one tournament each.

This script created the initial four images from BoardGameGeek box art (used
once, by agreement with BGG's hotlink-only runtime policy — these derivatives
live in our source, the runtime keeps hotlinking). Future trophies can be any
hand-made PNG dropped in with the same name+registry steps; rerunning this is
not part of any build.

Run (Pillow is not in the pinned devenv shell):
  nix shell --impure --expr \
    '(import <nixpkgs> {}).python3.withPackages (ps: with ps; [ pillow ])' \
    -c python3 scripts/generate_trophy_art.py
"""

import io
import json
import math
import random
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 512
CENTER = SIZE // 2
OUT_DIR = Path(__file__).resolve().parent.parent / "nextjs" / "public" / "trophies"

# trophy id → BGG box art the initial art is derived from.
SOURCES = {
    "serpent-hunt": "https://cf.geekdo-images.com/B9_Tc4VJbMy3LXd2aJCviw__original/img/QJ4dTYvAELS-n9fParoE0UAA_7E=/0x0/filters:format(png)/pic7036671.png",
    "clank-legacy": "https://cf.geekdo-images.com/hc2NDafu5c24iLJh_IZmyg__original/img/1Fpyz7j7rTvMPRiDdPjn0Vf0m2k=/0x0/filters:format(png)/pic4885780.png",
    "innovation": "https://cf.geekdo-images.com/l4fVXtRnhKMf5UPn78rEdg__original/img/spomh0P7HHKNTFNLVwVX7xJPf3M=/0x0/filters:format(png)/pic8792317.png",
    "seti": "https://cf.geekdo-images.com/_BUXOVRDU9g_eRwgpR5ZZw__original/img/28ob2JiASW8iX8XoVzp5Y25-h24=/0x0/filters:format(jpeg)/pic8160466.jpg",
}

GOLD_LIGHT = (255, 233, 168)
GOLD_MID = (217, 169, 30)
GOLD_DARK = (138, 90, 0)


def fetch(url: str) -> Image.Image:
    with urllib.request.urlopen(url, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def cover(img: Image.Image, side: int) -> Image.Image:
    """Scale to cover side×side, center-crop."""
    w, h = img.size
    scale = max(side / w, side / h)
    img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    left = (img.width - side) // 2
    top = (img.height - side) // 2
    return img.crop((left, top, left + side, top + side))


def darken(c: tuple, k: float) -> tuple:
    return (round(c[0] * k), round(c[1] * k), round(c[2] * k))


def mix(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def polygon_points(cx, cy, outer, inner, n=5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = outer if i % 2 == 0 else inner
        a = rot + math.pi * i / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def sparkle(draw, cx, cy, s, color):
    draw.polygon(
        [
            (cx, cy - 2 * s), (cx + 0.55 * s, cy - 0.55 * s),
            (cx + 2 * s, cy), (cx + 0.55 * s, cy + 0.55 * s),
            (cx, cy + 2 * s), (cx - 0.55 * s, cy + 0.55 * s),
            (cx - 2 * s, cy), (cx - 0.55 * s, cy - 0.55 * s),
        ],
        fill=color,
    )


def wreath_layer(rng):
    """One laurel branch per side: gold leaves along the medallion arc."""
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for side in (1, -1):
        start, sweep = 84, 168  # degrees, y-down: 84° is bottom center
        count = 11
        for i in range(count):
            t = i / (count - 1)
            deg = start + side * sweep * t
            rad = math.radians(deg)
            radius = 205 + 7 * math.sin(t * math.pi)
            cx = CENTER + radius * math.cos(rad)
            cy = CENTER + radius * math.sin(rad)
            shrink = 1 - 0.35 * t
            leaf_w, leaf_h = 56 * shrink, 24 * shrink
            rot = deg + 90 + (24 if i % 2 == 0 else -24) * side + (rng.random() - 0.5) * 8
            leaf = Image.new("RGBA", (round(leaf_w) + 8, round(leaf_h) + 8), (0, 0, 0, 0))
            ld = ImageDraw.Draw(leaf)
            fill = GOLD_MID if i % 2 == 0 else GOLD_DARK
            ld.ellipse([4, 4, 4 + leaf_w, 4 + leaf_h], fill=fill, outline=GOLD_LIGHT, width=2)
            leaf = leaf.rotate(rot, expand=True, resample=Image.BICUBIC)
            layer.alpha_composite(leaf, (round(cx - leaf.width / 2), round(cy - leaf.height / 2)))
    return layer


def trophy_image(trophy_id: str, art: Image.Image) -> Image.Image:
    rng = random.Random(trophy_id)
    accent = darken(cover(art.copy(), 1).getpixel((0, 0)), 1.0)
    bg_top, bg_bottom = darken(accent, 0.42), darken(accent, 0.16)

    img = Image.new("RGB", (SIZE, SIZE), bg_bottom)
    d = ImageDraw.Draw(img)
    for y in range(SIZE):  # vertical gradient backdrop
        d.line([(0, y), (SIZE, y)], fill=mix(bg_top, bg_bottom, y / SIZE))

    # soft spotlight behind the medallion
    spot = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(spot).ellipse([96, 66, SIZE - 96, SIZE - 96], fill=46)
    img.paste(Image.new("RGB", (SIZE, SIZE), darken(accent, 0.62)), (0, 0), spot)

    # sparkles around the wreath
    for _ in range(9):
        deg, radius = rng.random() * 360, 228 + rng.random() * 16
        cx = CENTER + radius * math.cos(math.radians(deg))
        cy = CENTER + radius * math.sin(math.radians(deg))
        sparkle(d, cx, cy, 4 + rng.random() * 4, GOLD_LIGHT)

    img = img.convert("RGBA")
    img.alpha_composite(wreath_layer(rng))
    d = ImageDraw.Draw(img)

    # medallion: the game art in a double gold ring
    ring_r, art_r = 170, 152
    d.ellipse([CENTER - ring_r, CENTER - ring_r, CENTER + ring_r, CENTER + ring_r],
              outline=GOLD_MID, width=14)
    mask = Image.new("L", (art_r * 2, art_r * 2), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, art_r * 2, art_r * 2], fill=255)
    img.paste(cover(art, art_r * 2), (CENTER - art_r, CENTER - art_r), mask)
    d.ellipse([CENTER - art_r, CENTER - art_r, CENTER + art_r, CENTER + art_r],
              outline=GOLD_DARK, width=3)
    # top sheen on the glass
    sheen = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(sheen).pieslice(
        [CENTER - art_r, CENTER - art_r, CENTER + art_r, CENTER + art_r],
        190, 300, fill=(255, 255, 255, 26),
    )
    img.alpha_composite(sheen)

    # star in the wreath's top gap
    d.polygon(polygon_points(CENTER, 64, 50, 21), fill=GOLD_MID, outline=GOLD_DARK, width=3)

    # ribbon at the bottom
    ribbon = [(92, 402), (420, 402), (382, 432), (420, 462), (92, 462), (130, 432)]
    d.polygon(ribbon, fill=GOLD_MID, outline=GOLD_DARK, width=3)
    d.ellipse([CENTER - 11, 421, CENTER + 11, 443], fill=GOLD_DARK)
    d.ellipse([CENTER - 6, 426, CENTER + 6, 438], fill=GOLD_LIGHT)

    return img.convert("RGB")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for trophy_id, url in SOURCES.items():
        art = fetch(url)
        out = OUT_DIR / f"{trophy_id}.png"
        trophy_image(trophy_id, art).save(out, "PNG", optimize=True)
        print(json.dumps({"trophy": trophy_id, "source": url, "out": str(out)}))


if __name__ == "__main__":
    main()
