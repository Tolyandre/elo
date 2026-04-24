"""
FastAPI inference service for Its a Wonderful World scoring recognition.

POST /recognize  multipart/form-data  file=<image>
→ JSON: {cards, tokens, empire}

Start:
  uvicorn service:app --port 8765 --reload
"""

import io
import json
import os
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from ultralytics import YOLO

ROOT = Path(__file__).parent
MODEL_PATH = ROOT / "model" / "best.onnx"
FALLBACK_MODEL = ROOT / "model" / "best.pt"
TEMPLATES_ICONS = ROOT / "templates" / "icons"
TEMPLATES_DIGITS = ROOT / "templates" / "digits"
CARD_DB = ROOT / "data" / "card_database.json"

CLASSES = ["card_strip", "token_general", "token_financier", "token_culture", "empire_board"]
ICON_NAMES = ["structure", "vehicle", "research", "project", "discovery",
              "general", "financier", "culture"]

app = FastAPI(title="IaWW Recognition Service")

# ─── Model & template loading ─────────────────────────────────────────────────

_model: YOLO | None = None
_icon_templates: dict[str, np.ndarray] = {}
_digit_templates: dict[int, np.ndarray] = {}
_card_db: dict = {}


def _load():
    global _model, _icon_templates, _digit_templates, _card_db

    model_path = MODEL_PATH if MODEL_PATH.exists() else FALLBACK_MODEL
    if not model_path.exists():
        raise RuntimeError(f"Model not found at {MODEL_PATH} or {FALLBACK_MODEL}. Run train.py first.")
    _model = YOLO(str(model_path), task="obb")

    # Icon templates
    for name in ICON_NAMES:
        p = TEMPLATES_ICONS / f"{name}.png"
        if p.exists():
            _icon_templates[name] = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)

    # Digit templates 1–12
    for d in range(1, 13):
        p = TEMPLATES_DIGITS / f"{d}.png"
        if p.exists():
            _digit_templates[d] = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)

    if CARD_DB.exists():
        with open(CARD_DB, encoding="utf-8") as f:
            _card_db = json.load(f)


@app.on_event("startup")
async def startup():
    _load()


# ─── Template matching helpers ────────────────────────────────────────────────

def _best_template_match(roi_gray: np.ndarray, templates: dict) -> tuple[str | int, float]:
    """Return the key and NCC score of the best matching template."""
    best_key, best_score = None, -1.0
    for key, tmpl in templates.items():
        if tmpl is None:
            continue
        # Resize template to fit inside ROI while keeping aspect ratio
        th, tw = tmpl.shape[:2]
        rh, rw = roi_gray.shape[:2]
        if tw > rw or th > rh:
            scale = min(rw / tw, rh / th)
            tmpl_r = cv2.resize(tmpl, (int(tw * scale), int(th * scale)))
        else:
            tmpl_r = tmpl
        if tmpl_r.shape[0] > roi_gray.shape[0] or tmpl_r.shape[1] > roi_gray.shape[1]:
            continue
        res = cv2.matchTemplate(roi_gray, tmpl_r, cv2.TM_CCOEFF_NORMED)
        score = float(res.max())
        if score > best_score:
            best_score = score
            best_key = key
    return best_key, best_score


def classify_strip(strip_bgr: np.ndarray) -> dict:
    """
    Extract card type and scoring from a perspective-corrected strip image.

    Returns:
      {
        "card_type": "structure" | "vehicle" | "research" | "project" | "discovery" | None,
        "scoring": None | {"kind": ..., ...}
      }
    """
    if strip_bgr is None or strip_bgr.size == 0:
        return {"card_type": None, "scoring": None}

    gray = cv2.cvtColor(strip_bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Right ~25% of strip → card type icon
    icon_roi = gray[:, int(w * 0.75):]
    card_type, icon_score = _best_template_match(icon_roi, _icon_templates)
    if icon_score < 0.35:
        card_type = None

    # Left ~40% → scoring area
    score_roi = gray[:, :int(w * 0.40)]
    scoring = _parse_scoring_roi(score_roi)

    return {"card_type": card_type, "scoring": scoring}


def _parse_scoring_roi(roi_gray: np.ndarray) -> dict | None:
    """
    Attempt to extract scoring type and value from the left portion of a strip.

    Heuristic:
      - If no template matches above threshold → no scoring (return None)
      - Detect the laurel-wreath badge (roundish bright region) and the icons around it
      - Match digit template for the number
      - Classify as direct_vp / multiplier_single / multiplier_pair based on icon count next to badge
    """
    if not _digit_templates:
        return None

    digit_key, d_score = _best_template_match(roi_gray, _digit_templates)

    if d_score < 0.30:
        return None  # no scoring on this card

    # Identify what type of multiplier by checking which icon templates appear
    icons_present = []
    for name, tmpl in _icon_templates.items():
        if tmpl is None:
            continue
        th, tw = tmpl.shape[:2]
        rh, rw = roi_gray.shape[:2]
        if tw > rw or th > rh:
            scale = min(rw / tw, rh / th)
            tmpl_r = cv2.resize(tmpl, (int(tw * scale), int(th * scale)))
        else:
            tmpl_r = tmpl
        if tmpl_r.shape[0] > roi_gray.shape[0] or tmpl_r.shape[1] > roi_gray.shape[1]:
            continue
        res = cv2.matchTemplate(roi_gray, tmpl_r, cv2.TM_CCOEFF_NORMED)
        if float(res.max()) > 0.35:
            icons_present.append(name)

    coeff = int(digit_key) if digit_key is not None else 0

    if not icons_present:
        return {"kind": "direct_vp", "value": coeff}
    elif len(icons_present) == 1:
        return {"kind": "multiplier_single", "icon": icons_present[0], "coeff": coeff}
    else:
        return {"kind": "multiplier_pair", "icon1": icons_present[0], "icon2": icons_present[1], "coeff": coeff}


# ─── Perspective warp ─────────────────────────────────────────────────────────

def warp_obb(img: np.ndarray, obb_pts: np.ndarray, target_w: int = 300, target_h: int = 60) -> np.ndarray:
    """Warp the OBB region to a canonical axis-aligned rectangle."""
    # obb_pts: shape (4, 2) in pixel coords
    pts = obb_pts.astype(np.float32)
    # Order: top-left, top-right, bottom-right, bottom-left
    dst = np.array([[0, 0], [target_w, 0], [target_w, target_h], [0, target_h]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(pts, dst)
    warped = cv2.warpPerspective(img, M, (target_w, target_h))
    return warped


# ─── Main endpoint ────────────────────────────────────────────────────────────

@app.post("/recognize")
async def recognize(file: UploadFile = File(...)):
    if _model is None:
        raise HTTPException(503, "Model not loaded")

    data = await file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Cannot decode image")

    results = _model(img, conf=0.35, verbose=False)

    cards = []
    tokens: dict[str, int] = {"general": 0, "financier": 0, "culture": 0}
    empire_scoring = None

    h_img, w_img = img.shape[:2]

    for r in results:
        if r.obb is None:
            continue
        for i in range(len(r.obb)):
            cls_id = int(r.obb.cls[i].item())
            cls_name = CLASSES[cls_id] if cls_id < len(CLASSES) else ""

            if cls_name == "token_general":
                tokens["general"] += 1
            elif cls_name == "token_financier":
                tokens["financier"] += 1
            elif cls_name == "token_culture":
                tokens["culture"] += 1
            elif cls_name in ("card_strip", "empire_board"):
                # Extract OBB corner points
                pts = r.obb[i].xyxyxyxy.cpu().numpy().reshape(4, 2)
                pts_px = pts.copy()
                warped = warp_obb(img, pts_px)
                info = classify_strip(warped)
                if cls_name == "card_strip":
                    cards.append(info)
                else:
                    empire_scoring = info.get("scoring")

    return JSONResponse({
        "cards": cards,
        "tokens": tokens,
        "empire": empire_scoring,
    })


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None}
