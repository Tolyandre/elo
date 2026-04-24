"""
Train YOLO26 OBB model on the generated dataset.

Usage:
  python scripts/train.py [--epochs 100] [--device cpu] [--resume]
"""

import argparse
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_YAML = os.path.join(ROOT, "data", "dataset", "dataset.yaml")
RUNS_DIR = os.path.join(ROOT, "runs")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolo26n-obb.pt", help="Base model weights")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="cpu", help="'cpu', '0', '0,1', …")
    ap.add_argument("--name", default="iaww_v1")
    ap.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    ap.add_argument("--lr", type=float, default=0.01)
    ap.add_argument("--fine-tune", default=None, metavar="WEIGHTS",
                    help="Fine-tune from existing weights instead of pretrained base")
    args = ap.parse_args()

    from ultralytics import YOLO

    base = args.fine_tune if args.fine_tune else args.model
    model = YOLO(base)

    train_args = dict(
        data=DATASET_YAML,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=RUNS_DIR,
        name=args.name,
        lr0=args.lr,
        resume=args.resume,
        task="obb",
        verbose=True,
    )
    if args.fine_tune:
        # Lower LR for fine-tuning on real photos
        train_args["lr0"] = min(args.lr, 0.001)
        train_args["freeze"] = 10  # freeze first 10 layers

    results = model.train(**train_args)
    print("\nTraining complete.")
    print(f"Best weights: {RUNS_DIR}/{args.name}/weights/best.pt")

    # Export to ONNX for faster CPU inference
    best_pt = os.path.join(RUNS_DIR, args.name, "weights", "best.pt")
    if os.path.exists(best_pt):
        print("\nExporting to ONNX …")
        trained = YOLO(best_pt)
        trained.export(format="onnx", imgsz=args.imgsz, simplify=True)
        onnx_path = best_pt.replace(".pt", ".onnx")
        print(f"ONNX model: {onnx_path}")


if __name__ == "__main__":
    main()
