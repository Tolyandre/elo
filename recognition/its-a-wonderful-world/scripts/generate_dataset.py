"""
Generate synthetic YOLO OBB training images from card strips + token crops.

For each synthetic image:
  1. Pick a random background (wood-table photo or generated texture).
  2. Stack 5–20 card strips with realistic overlap (70% hidden, 30% visible at bottom).
  3. Scatter 0–5 tokens nearby.
  4. Optionally add an empire board.
  5. Apply augmentations (perspective, rotation, blur, brightness).
  6. Write image + OBB label file (YOLO format).

Usage:
  python scripts/generate_dataset.py --count 6000 --val-ratio 0.15 --test-ratio 0.05
"""

import argparse
import json
import os
import random
import shutil
import sys

import albumentations as A
import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRIPS_DIR = os.path.join(ROOT, "data", "card_strips")
EMPIRE_DIR = os.path.join(ROOT, "data", "empire_strips")
TOKENS_IMG = os.path.join(ROOT, "tokens.webp")
BG_DIR = os.path.join(ROOT, "data", "backgrounds")   # put wood-table photos here
DATASET_DIR = os.path.join(ROOT, "data", "dataset")

CLASSES = ["card_strip", "token_general", "token_financier", "token_culture", "empire_board"]
CLS = {n: i for i, n in enumerate(CLASSES)}

# Token crops (col index in tokens.webp): adjust after inspecting the image.
# tokens.webp is 800×150; the two round portrait tokens are rightmost.
TOKEN_COLS = {
    "token_general":    (680, 790),   # x range in tokens.webp (top row)
    "token_financier":  (680, 790),   # adjust: these overlap with general in the sheet
    "token_culture":    (680, 790),   # TODO: set correct x offsets after visual inspection
}


# ─── Augmentation pipeline ───────────────────────────────────────────────────

AUG = A.Compose(
    [
        A.Perspective(scale=(0.03, 0.10), p=0.8),
        A.Rotate(limit=15, p=0.7),
        A.RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3, p=0.8),
        A.CLAHE(clip_limit=3.0, p=0.3),
        A.GaussianBlur(blur_limit=(3, 7), p=0.4),
        A.MotionBlur(blur_limit=7, p=0.2),
        A.ImageCompression(quality_lower=60, quality_upper=95, p=0.5),
        A.HueSaturationValue(hue_shift_limit=10, sat_shift_limit=20, val_shift_limit=20, p=0.4),
    ]
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def load_strips() -> list[np.ndarray]:
    """Load all card strip images from data/card_strips/."""
    paths = sorted(p for p in os.listdir(STRIPS_DIR) if p.endswith(".png"))
    if not paths:
        print(f"No strips found in {STRIPS_DIR}. Run parse_spritesheet.py first.")
        sys.exit(1)
    strips = [cv2.imread(os.path.join(STRIPS_DIR, p), cv2.IMREAD_COLOR) for p in paths]
    return [s for s in strips if s is not None]


def load_backgrounds(target_size: tuple[int, int] = (960, 720)) -> list[np.ndarray]:
    """Load background images; generate wood-like texture if none available."""
    bgs = []
    if os.path.isdir(BG_DIR):
        for f in os.listdir(BG_DIR):
            img = cv2.imread(os.path.join(BG_DIR, f))
            if img is not None:
                bgs.append(cv2.resize(img, target_size))
    if not bgs:
        bgs.append(_generate_wood_bg(target_size))
    return bgs


def _generate_wood_bg(size: tuple[int, int]) -> np.ndarray:
    """Procedural wood-grain background as a fallback."""
    w, h = size
    bg = np.full((h, w, 3), (45, 80, 120), dtype=np.uint8)  # dark brown base
    # Add horizontal grain lines
    rng = np.random.default_rng(42)
    noise = rng.integers(0, 30, (h, w), dtype=np.uint8)
    bg = np.clip(bg.astype(int) + noise[:, :, None] - 15, 0, 255).astype(np.uint8)
    # Simulate grain with gaussian blur in one direction
    bg = cv2.GaussianBlur(bg, (1, 31), 0)
    return bg


def load_tokens() -> dict[str, list[np.ndarray]]:
    """Load token crops from tokens.webp. Returns {class_name: [crop, ...]}."""
    tokens: dict[str, list[np.ndarray]] = {k: [] for k in TOKEN_COLS}
    raw = cv2.imread(TOKENS_IMG, cv2.IMREAD_COLOR)
    if raw is None:
        return tokens
    h, w = raw.shape[:2]
    # Top row: hexagonal resource tokens; bottom row: portrait tokens (round)
    # Portrait tokens are in the right portion of the top row at y=0..h/2
    half_h = h // 2
    for name, (x0, x1) in TOKEN_COLS.items():
        crop = raw[0:half_h, x0:x1]
        if crop.size > 0:
            tokens[name].append(crop)
    return tokens


# ─── OBB label helpers ────────────────────────────────────────────────────────

def obb_label(cls_id: int, cx: float, cy: float, w: float, h: float, angle: float) -> str:
    """Format one OBB label line (YOLO OBB format)."""
    return f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f} {angle:.4f}"


def paste_strip_rotated(canvas: np.ndarray, strip: np.ndarray, x: int, y: int, angle_deg: float) -> tuple:
    """
    Paste a strip onto the canvas at position (x, y) with the given rotation.
    Returns the OBB parameters (cx, cy, w, h, angle) in pixel coords.
    """
    sh, sw = strip.shape[:2]
    M = cv2.getRotationMatrix2D((sw / 2, sh / 2), angle_deg, 1.0)
    # Compute bounding box of rotated strip
    cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
    nw = int(sh * sin_a + sw * cos_a)
    nh = int(sh * cos_a + sw * sin_a)
    M[0, 2] += (nw - sw) / 2
    M[1, 2] += (nh - sh) / 2
    rotated = cv2.warpAffine(strip, M, (nw, nh), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))

    # Clip to canvas
    ch, cw = canvas.shape[:2]
    x1, y1 = x, y
    x2, y2 = min(x + nw, cw), min(y + nh, ch)
    rx2, ry2 = x2 - x, y2 - y
    if rx2 <= 0 or ry2 <= 0:
        return None
    canvas[y1:y2, x1:x2] = rotated[:ry2, :rx2]

    # OBB centre and dims in canvas pixels (pre-augmentation)
    cx_px = x + nw / 2
    cy_px = y + nh / 2
    return cx_px, cy_px, float(sw), float(sh), -angle_deg


# ─── Scene composer ──────────────────────────────────────────────────────────

def compose_scene(
    strips: list[np.ndarray],
    bg: np.ndarray,
    tokens_by_class: dict[str, list[np.ndarray]],
    n_cards: int,
    n_tokens: int,
) -> tuple[np.ndarray, list[str]]:
    """Return (image, list_of_label_lines)."""
    canvas = bg.copy()
    ch, cw = canvas.shape[:2]
    labels = []

    # ── Card stack ────────────────────────────────────────────────────────────
    selected = random.choices(strips, k=n_cards)
    # Overall stack tilt
    stack_angle = random.uniform(-20, 20)
    # Start position
    x0 = random.randint(int(cw * 0.05), int(cw * 0.30))
    y0 = random.randint(int(ch * 0.10), int(ch * 0.40))
    # Strip height after perspective warp is ~strip_h; advance by 30% (visible portion)
    strip_h = selected[0].shape[0] if selected else 50
    step = int(strip_h * 0.35)  # 35% visible per strip

    for i, strip in enumerate(selected):
        x = x0 + int(i * step * np.cos(np.radians(stack_angle + 90)))
        y = y0 + int(i * step * np.sin(np.radians(stack_angle + 90)))
        angle = stack_angle + random.uniform(-3, 3)
        result = paste_strip_rotated(canvas, strip, x, y, angle)
        if result is None:
            continue
        cx_px, cy_px, w_px, h_px, a = result
        cx_n = cx_px / cw
        cy_n = cy_px / ch
        w_n = w_px / cw
        h_n = h_px / ch
        labels.append(obb_label(CLS["card_strip"], cx_n, cy_n, w_n, h_n, a))

    # ── Tokens ────────────────────────────────────────────────────────────────
    for _ in range(n_tokens):
        cls_name = random.choice(list(tokens_by_class.keys()))
        crops = tokens_by_class[cls_name]
        if not crops:
            continue
        tok = random.choice(crops)
        scale = random.uniform(0.5, 1.2)
        tok_r = cv2.resize(tok, None, fx=scale, fy=scale)
        th, tw = tok_r.shape[:2]
        tx = random.randint(0, max(0, cw - tw))
        ty = random.randint(0, max(0, ch - th))
        canvas[ty:ty + th, tx:tx + tw] = tok_r
        cx_n = (tx + tw / 2) / cw
        cy_n = (ty + th / 2) / ch
        labels.append(obb_label(CLS[cls_name], cx_n, cy_n, tw / cw, th / ch, 0.0))

    return canvas, labels


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=6000, help="Total number of synthetic images")
    ap.add_argument("--val-ratio", type=float, default=0.15)
    ap.add_argument("--test-ratio", type=float, default=0.05)
    ap.add_argument("--img-size", type=int, default=960, help="Longer side of canvas")
    ap.add_argument("--min-cards", type=int, default=5)
    ap.add_argument("--max-cards", type=int, default=20)
    args = ap.parse_args()

    strips = load_strips()
    bgs = load_backgrounds((args.img_size, int(args.img_size * 0.75)))
    tokens_by_class = load_tokens()
    print(f"Strips: {len(strips)}, Backgrounds: {len(bgs)}")

    # Prepare split dirs
    n_val = int(args.count * args.val_ratio)
    n_test = int(args.count * args.test_ratio)
    n_train = args.count - n_val - n_test
    splits = (["train"] * n_train + ["val"] * n_val + ["test"] * n_test)
    random.shuffle(splits)

    for split in ("train", "val", "test"):
        for sub in ("images", "labels"):
            os.makedirs(os.path.join(DATASET_DIR, sub, split), exist_ok=True)

    for idx, split in enumerate(splits):
        n_cards = random.randint(args.min_cards, args.max_cards)
        n_tokens = random.randint(0, 5)
        bg = random.choice(bgs)
        canvas, labels = compose_scene(strips, bg, tokens_by_class, n_cards, n_tokens)

        # Augment
        aug_result = AUG(image=canvas)
        aug_img = aug_result["image"]

        name = f"syn_{idx:06d}"
        cv2.imwrite(os.path.join(DATASET_DIR, "images", split, f"{name}.jpg"), aug_img,
                    [cv2.IMWRITE_JPEG_QUALITY, 90])
        label_path = os.path.join(DATASET_DIR, "labels", split, f"{name}.txt")
        with open(label_path, "w") as f:
            f.write("\n".join(labels))

        if idx % 500 == 0:
            print(f"  {idx}/{args.count} …")

    print(f"Done. Dataset at {DATASET_DIR}")

    # Write dataset.yaml
    yaml_path = os.path.join(DATASET_DIR, "dataset.yaml")
    with open(yaml_path, "w") as f:
        f.write(f"path: {os.path.abspath(DATASET_DIR)}\n")
        f.write("train: images/train\n")
        f.write("val: images/val\n")
        f.write("test: images/test\n\n")
        f.write(f"nc: {len(CLASSES)}\n")
        f.write("names:\n")
        for i, name in enumerate(CLASSES):
            f.write(f"  {i}: {name}\n")
    print(f"dataset.yaml written → {yaml_path}")


if __name__ == "__main__":
    main()
