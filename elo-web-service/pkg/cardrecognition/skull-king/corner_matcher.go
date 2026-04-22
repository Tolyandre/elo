package skullking

import (
	"image"

	"gocv.io/x/gocv"
)

// borderFamily is the card family inferred from border color analysis.
type borderFamily struct {
	name       string
	confidence float64
}

// matchCorner crops the top-left corner badge of src (30%×28%), resizes it to
// the stored template dimensions, and returns the best-matching special-card
// name and its NCC score (used for within-family disambiguation, not as a gate).
func matchCorner(src gocv.Mat, cornerTemplates map[string]gocv.Mat) (name string, score float64) {
	if len(cornerTemplates) == 0 {
		return "", 0
	}
	h, w := src.Rows(), src.Cols()
	cx := w * 30 / 100
	cy := h * 28 / 100
	if cx == 0 || cy == 0 {
		return "", 0
	}

	var tmplH, tmplW int
	for _, t := range cornerTemplates {
		tmplH, tmplW = t.Rows(), t.Cols()
		break
	}
	if tmplH == 0 {
		return "", 0
	}

	roi := src.Region(image.Rect(0, 0, cx, cy))
	defer roi.Close()

	resized := gocv.NewMat()
	defer resized.Close()
	gocv.Resize(roi, &resized, image.Pt(tmplW, tmplH), 0, 0, gocv.InterpolationLinear)

	bestName := ""
	bestScore := -1.0
	emptyMask := gocv.NewMat()
	defer emptyMask.Close()

	for n, tmpl := range cornerTemplates {
		result := gocv.NewMat()
		gocv.MatchTemplate(resized, tmpl, &result, gocv.TmCcoeffNormed, emptyMask)
		_, maxVal, _, _ := gocv.MinMaxLoc(result)
		result.Close()
		if float64(maxVal) > bestScore {
			bestScore = float64(maxVal)
			bestName = n
		}
	}
	return bestName, bestScore
}

// matchCornerAmong is like matchCorner but only considers the given candidates.
func matchCornerAmong(src gocv.Mat, cornerTemplates map[string]gocv.Mat, candidates []string) (name string, score float64) {
	sub := make(map[string]gocv.Mat, len(candidates))
	for _, c := range candidates {
		if t, ok := cornerTemplates[c]; ok {
			sub[c] = t
		}
	}
	return matchCorner(src, sub)
}

// detectColorFamily analyzes the outer border strips (12% of each edge) to
// determine which broad color family the card belongs to.
// Returns one of: "red", "teal", "green", "purple", "blue", "gold", "dark".
func detectColorFamily(src gocv.Mat) string {
	h, w := src.Rows(), src.Cols()
	sw := max(1, w*12/100)
	sh := max(1, h*12/100)

	rects := []image.Rectangle{
		image.Rect(sw, 0, w-sw, sh),    // top
		image.Rect(sw, h-sh, w-sw, h),  // bottom
		image.Rect(0, sh, sw, h-sh),    // left
		image.Rect(w-sw, sh, w, h-sh),  // right
	}

	hsv := gocv.NewMat()
	defer hsv.Close()
	gocv.CvtColor(src, &hsv, gocv.ColorBGRToHSV)

	var redC, tealC, greenC, purpleC, darkPurpleC, blueC, goldC, darkC int

	for _, rect := range rects {
		roi := hsv.Region(rect)

		// Red wraps around 0/180: H<12 or H>163, S>=80, V>=50
		redC += hsvCount(roi, 0, 11, 80, 50)
		redC += hsvCount(roi, 164, 180, 80, 50)

		tealC += hsvCount(roi, 82, 102, 80, 60)          // teal/cyan
		greenC += hsvCount(roi, 55, 82, 80, 60)          // green
		purpleC += hsvCount(roi, 118, 155, 50, 85)        // bright purple (map suit, V>=85)
		darkPurpleC += hsvCount(roi, 118, 155, 50, 30)   // all purple V>=30
		darkPurpleC -= hsvCount(roi, 118, 155, 50, 85)   // subtract bright → dark only (V 30-84)
		blueC += hsvCount(roi, 95, 130, 40, 120)         // pastel blue/escape
		goldC += hsvCount(roi, 15, 45, 100, 100)         // gold/orange

		// Dark: low V regardless of hue (for skull-king/jolly-roger dark border).
		// Threshold at 100 rather than 60 to capture dark-navy borders that
		// photograph as V≈70-90 under typical lighting.
		ch := gocv.Split(roi)
		vDark := gocv.NewMat()
		gocv.Threshold(ch[2], &vDark, 100, 255, gocv.ThresholdBinaryInv)
		darkC += gocv.CountNonZero(vDark)
		vDark.Close()
		for i := range ch {
			ch[i].Close()
		}

		roi.Close()
	}

	type cand struct {
		name  string
		count int
	}
	best := cand{"unknown", 0}
	for _, c := range []cand{
		{"red", redC},
		{"teal", tealC},
		{"green", greenC},
		{"purple", purpleC},
		{"dark_purple", darkPurpleC},
		{"blue", blueC},
		{"gold", goldC},
		{"dark", darkC},
	} {
		if c.count > best.count {
			best = c
		}
	}
	return best.name
}

// hsvCount counts pixels in an HSV ROI where H in [hMin,hMax], S>=sMin, V>=vMin.
func hsvCount(roi gocv.Mat, hMin, hMax, sMin, vMin int) int {
	ch := gocv.Split(roi)
	defer func() {
		for i := range ch {
			ch[i].Close()
		}
	}()
	hC, sC, vC := ch[0], ch[1], ch[2]

	lo := gocv.NewMat()
	hi := gocv.NewMat()
	hRange := gocv.NewMat()
	sm := gocv.NewMat()
	result := gocv.NewMat()
	defer lo.Close()
	defer hi.Close()
	defer hRange.Close()
	defer sm.Close()
	defer result.Close()

	gocv.Threshold(hC, &lo, float32(hMin-1), 255, gocv.ThresholdBinary)  // H >= hMin
	gocv.Threshold(hC, &hi, float32(hMax), 255, gocv.ThresholdBinaryInv) // H <= hMax
	gocv.BitwiseAnd(lo, hi, &hRange)
	gocv.Threshold(sC, &sm, float32(sMin-1), 255, gocv.ThresholdBinary)  // S >= sMin
	gocv.BitwiseAnd(hRange, sm, &result)
	if vMin > 0 {
		vm := gocv.NewMat()
		defer vm.Close()
		final := gocv.NewMat()
		defer final.Close()
		gocv.Threshold(vC, &vm, float32(vMin-1), 255, gocv.ThresholdBinary) // V >= vMin
		gocv.BitwiseAnd(result, vm, &final)
		return gocv.CountNonZero(final)
	}
	return gocv.CountNonZero(result)
}

func clamp(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
