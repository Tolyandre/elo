"""
Parse cards-1652.webp into individual card bottom strips.

Outputs:
  data/card_strips/card_RRCC.png   - bottom strip of each card (row RR, col CC)
  data/card_database_template.json - template to fill with card metadata

Usage:
  python scripts/parse_spritesheet.py [--show] [--cols N] [--rows N] [--strip-ratio 0.20]

Auto-detects grid size from projection profiles; pass --cols/--rows to override.
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITESHEET = os.path.join(ROOT, "cards-1652.webp")
EMPIRES_SHEET = os.path.join(ROOT, "empires.webp")
OUT_DIR = os.path.join(ROOT, "data", "card_strips")
EMPIRE_DIR = os.path.join(ROOT, "data", "empire_strips")
DB_TEMPLATE = os.path.join(ROOT, "data", "card_database_template.json")


def detect_grid_lines(img_gray, axis: int, min_gap: int = 20) -> list[int]:
    """Return boundary positions along the given axis using projection valleys."""
    # Sum pixel intensities along the perpendicular axis
    proj = img_gray.sum(axis=axis).astype(float)
    # Smooth to reduce noise
    kernel = np.ones(5) / 5
    proj = np.convolve(proj, kernel, mode="same")
    # Normalise
    proj -= proj.min()
    proj /= proj.max() + 1e-9

    # Find valleys (card borders are darker lines between bright art areas)
    # Use a sliding minimum as reference
    from scipy.signal import find_peaks

    # Invert so borders become peaks
    inverted = 1.0 - proj
    peaks, _ = find_peaks(inverted, distance=min_gap, prominence=0.05)
    return sorted(peaks.tolist())


def split_by_lines(positions: list[int], total: int) -> list[tuple[int, int]]:
    """Convert a list of boundary positions into (start, end) slice pairs."""
    boundaries = [0] + positions + [total]
    segments = []
    for i in range(len(boundaries) - 1):
        a, b = boundaries[i], boundaries[i + 1]
        if b - a > 10:  # skip tiny slivers
            segments.append((a, b))
    return segments


def estimate_uniform_grid(img_h: int, img_w: int, n_rows: int, n_cols: int):
    """Divide image into uniform grid without peak detection."""
    row_segs = [(round(img_h * r / n_rows), round(img_h * (r + 1) / n_rows)) for r in range(n_rows)]
    col_segs = [(round(img_w * c / n_cols), round(img_w * (c + 1) / n_cols)) for c in range(n_cols)]
    return row_segs, col_segs


def parse_cards(img, n_rows: int | None, n_cols: int | None, strip_ratio: float, show: bool):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    if n_rows and n_cols:
        row_segs, col_segs = estimate_uniform_grid(h, w, n_rows, n_cols)
    else:
        print("Auto-detecting grid…")
        try:
            from scipy.signal import find_peaks  # noqa: F401 (check available)
        except ImportError:
            print("scipy not found – install it or pass --rows/--cols manually")
            sys.exit(1)
        row_peaks = detect_grid_lines(gray, axis=1, min_gap=max(h // 20, 20))
        col_peaks = detect_grid_lines(gray, axis=0, min_gap=max(w // 20, 20))
        row_segs = split_by_lines(row_peaks, h)
        col_segs = split_by_lines(col_peaks, w)
        print(f"Detected {len(row_segs)} rows × {len(col_segs)} cols")

    os.makedirs(OUT_DIR, exist_ok=True)

    entries = {}
    strip_paths = []

    for r, (y0, y1) in enumerate(row_segs):
        for c, (x0, x1) in enumerate(col_segs):
            cell = img[y0:y1, x0:x1]
            ch = cell.shape[0]
            # Bottom strip: bottom strip_ratio of the card
            strip_y = int(ch * (1.0 - strip_ratio))
            strip = cell[strip_y:, :]

            name = f"card_{r:02d}{c:02d}"
            path = os.path.join(OUT_DIR, f"{name}.png")
            cv2.imwrite(path, strip)
            strip_paths.append((name, path))

            entries[name] = {
                "row": r,
                "col": c,
                "type": None,  # fill manually: structure/vehicle/research/project/discovery
                "scoring": None,
                # scoring examples:
                # {"kind": "direct_vp", "value": 2}
                # {"kind": "multiplier_single", "icon": "research", "coeff": 3}
                # {"kind": "multiplier_pair", "icon1": "project", "icon2": "discovery", "coeff": 12}
            }

    print(f"Saved {len(entries)} card strips → {OUT_DIR}")

    with open(DB_TEMPLATE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print(f"Template written → {DB_TEMPLATE}")

    if show:
        debug_path = os.path.join(ROOT, "data", "debug_grid.jpg")
        _save_debug_grid(img, row_segs, col_segs, strip_ratio, debug_path)

    return entries


def parse_empires(img, n_rows: int = 2, n_cols: int = 5, strip_ratio: float = 0.20):
    os.makedirs(EMPIRE_DIR, exist_ok=True)
    h, w = img.shape[:2]
    row_segs, col_segs = estimate_uniform_grid(h, w, n_rows, n_cols)

    entries = {}
    for r, (y0, y1) in enumerate(row_segs):
        for c, (x0, x1) in enumerate(col_segs):
            cell = img[y0:y1, x0:x1]
            ch = cell.shape[0]
            strip_y = int(ch * (1.0 - strip_ratio))
            strip = cell[strip_y:, :]
            name = f"empire_{r:01d}{c:01d}"
            cv2.imwrite(os.path.join(EMPIRE_DIR, f"{name}.png"), strip)
            entries[name] = {"row": r, "col": c, "scoring": None}

    print(f"Saved {len(entries)} empire strips → {EMPIRE_DIR}")
    return entries


def _save_debug_grid(img, row_segs, col_segs, strip_ratio, out_path: str):
    vis = img.copy()
    for y0, y1 in row_segs:
        strip_y = y0 + int((y1 - y0) * (1 - strip_ratio))
        cv2.line(vis, (0, y0), (vis.shape[1], y0), (0, 255, 0), 2)
        cv2.line(vis, (0, strip_y), (vis.shape[1], strip_y), (0, 0, 255), 1)
    for x0, x1 in col_segs:
        cv2.line(vis, (x0, 0), (x0, vis.shape[0]), (0, 255, 0), 2)
    scale = 1200 / max(vis.shape[:2])
    vis = cv2.resize(vis, None, fx=scale, fy=scale)
    cv2.imwrite(out_path, vis)
    print(f"Debug grid saved → {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cols", type=int, default=None, help="Number of card columns (auto-detect if omitted)")
    ap.add_argument("--rows", type=int, default=None, help="Number of card rows (auto-detect if omitted)")
    ap.add_argument("--strip-ratio", type=float, default=0.12, help="Fraction of card height used as the score strip")
    ap.add_argument("--show", action="store_true", help="Save annotated grid to data/debug_grid.jpg for verification")
    ap.add_argument("--empires-rows", type=int, default=2)
    ap.add_argument("--empires-cols", type=int, default=5)
    args = ap.parse_args()

    img = cv2.imread(SPRITESHEET, cv2.IMREAD_COLOR)
    if img is None:
        print(f"Cannot read {SPRITESHEET}")
        sys.exit(1)
    print(f"Loaded cards sheet: {img.shape[1]}×{img.shape[0]}")
    parse_cards(img, args.rows, args.cols, args.strip_ratio, args.show)

    emp = cv2.imread(EMPIRES_SHEET, cv2.IMREAD_COLOR)
    if emp is not None:
        print(f"Loaded empires sheet: {emp.shape[1]}×{emp.shape[0]}")
        parse_empires(emp, args.empires_rows, args.empires_cols, args.strip_ratio)


if __name__ == "__main__":
    main()
