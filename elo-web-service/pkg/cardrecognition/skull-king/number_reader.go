package skullking

import (
	"image"

	"gocv.io/x/gocv"
)

// readNumber finds the digit in the top-left badge of a suit card.
//
// The 36×48 digit templates (pre-binarized, inner badge crop from sprite sheet)
// slide over the full 70×93 corner binary image.  Sliding-window matching
// tolerates small positional offsets between real cards and the sprite sheet.
func readNumber(src gocv.Mat, digitTemplateSets ...map[int]gocv.Mat) (value int, confidence float64) {
	// Full corner crop: 4px inset, 70×93 px in canonical 248×347 card space.
	const x1, y1, x2, y2 = 4, 4, 74, 97
	if src.Cols() < x2 || src.Rows() < y2 {
		return 0, 0
	}

	corner := src.Region(image.Rect(x1, y1, x2, y2))
	defer corner.Close()

	gray := gocv.NewMat()
	gocv.CvtColor(corner, &gray, gocv.ColorBGRToGray)
	defer gray.Close()

	// Binarize: digit strokes become white, background black.
	binary := gocv.NewMat()
	gocv.AdaptiveThreshold(gray, &binary, 255,
		gocv.AdaptiveThresholdGaussian, gocv.ThresholdBinaryInv, 11, 3)
	defer binary.Close()

	// Slide each 36×48 template over the 70×93 binary source.
	bestValue := 0
	bestScore := -1.0
	mask := gocv.NewMat()
	defer mask.Close()
	for _, set := range digitTemplateSets {
		for d, tmpl := range set {
			result := gocv.NewMat()
			gocv.MatchTemplate(binary, tmpl, &result, gocv.TmCcoeffNormed, mask)
			_, maxVal, _, _ := gocv.MinMaxLoc(result)
			result.Close()
			if float64(maxVal) > bestScore {
				bestScore = float64(maxVal)
				bestValue = d
			}
		}
	}
	return bestValue, bestScore
}
