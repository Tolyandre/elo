package skullking

import (
	"encoding/base64"
	"fmt"

	"gocv.io/x/gocv"
)

// CardResult holds the recognized card type and optional numeric value.
type CardResult struct {
	Type  string
	Value *int // nil for special cards
}

// Recognizer uses OpenCV template matching to identify Skull King cards.
type Recognizer struct {
	cfg       RecognizerConfig
	templates *cardTemplates
}

// NewRecognizer loads all templates from the embedded FS and returns a ready
// Recognizer. Call Close() when done.
func NewRecognizer(cfg RecognizerConfig) (*Recognizer, error) {
	t, err := loadTemplates()
	if err != nil {
		return nil, fmt.Errorf("load card templates: %w", err)
	}
	return &Recognizer{cfg: cfg, templates: t}, nil
}

// Close releases OpenCV Mats held by the recognizer.
func (r *Recognizer) Close() {
	r.templates.close()
}

// RecognizeBase64 decodes a raw base64 string (no data-URI prefix) and
// identifies the card.
func (r *Recognizer) RecognizeBase64(b64 string) (CardResult, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return CardResult{}, fmt.Errorf("base64 decode: %w", err)
	}
	return r.Recognize(data)
}

// Recognize identifies a card from raw image bytes (JPEG or PNG).
//
// Pipeline:
//  1. Locate the card in the image (handles arbitrary backgrounds, tilt).
//  2. Try recognition at the detected orientation.
//  3. If that fails, rotate 180° and retry (handles upside-down cards).
//  4. If localization failed, fall back to recognizing the full image as-is.
func (r *Recognizer) Recognize(data []byte) (CardResult, error) {
	src, err := matFromBytes(data)
	if err != nil {
		return CardResult{}, fmt.Errorf("decode image: %w", err)
	}
	defer src.Close()

	warped, cardFound := findCardAndWarp(src)
	if cardFound {
		defer warped.Close()

		result, err := r.recognizeCardMat(warped)
		if err == nil {
			return result, nil
		}

		// Upside-down card: rotate 180° and retry.
		rotated := gocv.NewMat()
		defer rotated.Close()
		if rotErr := gocv.Rotate(warped, &rotated, gocv.Rotate180Clockwise); rotErr == nil {
			if result, err2 := r.recognizeCardMat(rotated); err2 == nil {
				return result, nil
			}
		}
		return CardResult{}, err // return original error
	}

	// No card shape found — try the full image directly.
	return r.recognizeCardMat(src)
}

// recognizeCardMat runs the recognition pipeline on a pre-cropped card Mat.
//
// Pipeline:
//  1. detectColorFamily identifies the broad color of the card border (12% strips).
//  2. Route by color family:
//     - teal → mermaid; blue → escape
//     - green/purple/gold → suit card; read digit → return {type, value}
//     - red → pirate or tigress (corner NCC disambiguates)
//     - dark → skull-king or jolly-roger (digit test disambiguates)
//     - dark purple → kraken / white-whale / loot (corner NCC disambiguates)
//  3. Fallback: full-card template matching against all specials.
func (r *Recognizer) recognizeCardMat(src gocv.Mat) (CardResult, error) {
	threshold := r.cfg.ConfidenceThreshold

	colorFamily := detectColorFamily(src)

	switch colorFamily {
	case "teal":
		return CardResult{Type: "mermaid"}, nil

	case "blue":
		return CardResult{Type: "escape"}, nil

	case "red":
		// pirate or tigress — same red border, different corner icon
		name, _ := matchCornerAmong(src, r.templates.corners, []string{"pirate", "tigress"})
		if name == "" {
			name = "pirate"
		}
		return CardResult{Type: name}, nil

	case "green":
		value, _ := readNumber(src, r.templates.digits, r.templates.digitsJolly)
		v := value
		return CardResult{Type: "parrot", Value: &v}, nil

	case "purple":
		value, _ := readNumber(src, r.templates.digits, r.templates.digitsJolly)
		v := value
		return CardResult{Type: "map", Value: &v}, nil

	case "gold":
		value, _ := readNumber(src, r.templates.digits, r.templates.digitsJolly)
		v := value
		return CardResult{Type: "chest", Value: &v}, nil

	case "dark_purple":
		name, _ := matchCornerAmong(src, r.templates.corners, []string{"kraken", "white-whale", "loot"})
		if name == "" {
			name = "kraken"
		}
		return CardResult{Type: name}, nil

	case "dark":
		// skull-king (special, no number) or jolly-roger (suit, has number).
		// Binary template matching gives lower absolute scores (~0.4 for a
		// correct digit vs ~0.1 for no digit), so use a dedicated threshold.
		const digitConf = 0.35
		value, conf := readNumber(src, r.templates.digits, r.templates.digitsJolly)
		if conf >= digitConf {
			v := value
			return CardResult{Type: "jolly-roger", Value: &v}, nil
		}
		return CardResult{Type: "skull-king"}, nil
	}

	// For color families that need corner NCC (purple can be kraken/whale/loot
	// rather than map at low numbers, etc.), or when color detection was unclear:
	// broad fallback via full-card template matching.
	bestName, bestScore := matchSpecial(src, r.templates.specials, nil)
	if bestScore >= threshold {
		return CardResult{Type: bestName}, nil
	}

	return CardResult{}, fmt.Errorf(
		"could not recognize card (color=%s, special=%.2f < threshold=%.2f)",
		colorFamily, bestScore, threshold,
	)
}
