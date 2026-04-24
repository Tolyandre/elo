"""
Test inference and visualise detections on a photo.

Usage:
  python scripts/test_inference.py --image samples/1.jpg [--model model/best.pt] [--threshold 0.5]
"""

import argparse
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CLASSES = ["card_strip", "token_general", "token_financier", "token_culture", "empire_board"]
COLORS = {
    "card_strip":      (0, 200, 255),
    "token_general":   (0, 255, 0),
    "token_financier": (255, 128, 0),
    "token_culture":   (200, 0, 255),
    "empire_board":    (0, 0, 255),
}


def draw_obb(img: np.ndarray, obb, label: str, color: tuple) -> None:
    pts = obb.xyxyxyxy.cpu().numpy().reshape(-1, 2).astype(int)
    cv2.polylines(img, [pts], True, color, 2)
    x, y = pts[0]
    cv2.putText(img, label, (x, y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--model", default=os.path.join(ROOT, "model", "best.pt"))
    ap.add_argument("--threshold", type=float, default=0.4)
    ap.add_argument("--save", default=None, metavar="OUT_PATH")
    args = ap.parse_args()

    if not os.path.exists(args.model):
        print(f"Model not found: {args.model}")
        print("Train first with: python scripts/train.py")
        sys.exit(1)

    from ultralytics import YOLO

    model = YOLO(args.model, task="obb")
    results = model(args.image, conf=args.threshold, verbose=False)

    img = cv2.imread(args.image)
    counts = {c: 0 for c in CLASSES}

    for r in results:
        if r.obb is None:
            continue
        for i in range(len(r.obb)):
            cls_id = int(r.obb.cls[i].item())
            conf = float(r.obb.conf[i].item())
            cls_name = CLASSES[cls_id] if cls_id < len(CLASSES) else str(cls_id)
            counts[cls_name] += 1
            draw_obb(img, r.obb[i], f"{cls_name} {conf:.2f}", COLORS.get(cls_name, (255, 255, 255)))

    print("Detections:")
    for k, v in counts.items():
        print(f"  {k}: {v}")

    out = args.save or args.image.replace(".", "_detected.")
    cv2.imwrite(out, img)
    print(f"Saved → {out}")

    scale = 900 / max(img.shape[:2])
    preview = cv2.resize(img, None, fx=scale, fy=scale)
    cv2.imshow("Detections", preview)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
