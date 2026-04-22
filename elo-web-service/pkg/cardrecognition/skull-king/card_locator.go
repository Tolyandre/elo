package skullking

import (
	"image"
	"math"
	"sort"

	"gocv.io/x/gocv"
)

// findCardAndWarp detects the card in src (which may have arbitrary background)
// and returns a perspective-corrected image at canonical card size (248×347).
// Returns (warped, true) if a card-shaped quad is found, otherwise (empty, false).
//
// Algorithm:
//  1. Grayscale + Gaussian blur
//  2. Otsu threshold: card (light) vs. dark background
//  3. Morphological close to fill dark patches inside the card
//  4. Find external contours → largest 4-point polygon with card aspect ratio
//  5. Perspective warp to canonical size
func findCardAndWarp(src gocv.Mat) (gocv.Mat, bool) {
	imgArea := float64(src.Rows() * src.Cols())

	gray := gocv.NewMat()
	defer gray.Close()
	gocv.CvtColor(src, &gray, gocv.ColorBGRToGray)

	blurred := gocv.NewMat()
	defer blurred.Close()
	gocv.GaussianBlur(gray, &blurred, image.Pt(5, 5), 0, 0, gocv.BorderDefault)

	thresh := gocv.NewMat()
	defer thresh.Close()
	gocv.Threshold(blurred, &thresh, 0, 255, gocv.ThresholdBinary|gocv.ThresholdOtsu)

	// Close dark regions inside the card body.
	kernel := gocv.GetStructuringElement(gocv.MorphRect, image.Pt(15, 15))
	defer kernel.Close()
	closed := gocv.NewMat()
	defer closed.Close()
	gocv.MorphologyEx(thresh, &closed, gocv.MorphClose, kernel)

	contours := gocv.FindContours(closed, gocv.RetrievalExternal, gocv.ChainApproxSimple)
	defer contours.Close()

	var bestPts [4]image.Point
	bestArea := 0.0
	found := false

	for i := 0; i < contours.Size(); i++ {
		contour := contours.At(i)
		area := gocv.ContourArea(contour)
		if area < imgArea*0.15 || area > imgArea*0.92 {
			continue
		}

		perimeter := gocv.ArcLength(contour, true)
		approx := gocv.ApproxPolyDP(contour, 0.02*perimeter, true)
		if approx.Size() != 4 {
			approx.Close()
			continue
		}

		pts := [4]image.Point{approx.At(0), approx.At(1), approx.At(2), approx.At(3)}
		approx.Close()

		if !isCardAspectRatio(pts) {
			continue
		}
		if area > bestArea {
			bestArea = area
			bestPts = pts
			found = true
		}
	}

	if !found {
		return gocv.NewMat(), false
	}

	sorted := sortCorners(bestPts)
	warped := perspectiveWarp(src, sorted)
	if warped.Empty() {
		warped.Close()
		return gocv.NewMat(), false
	}
	return warped, true
}

// isCardAspectRatio returns true if the 4 corner points form a quadrilateral
// whose aspect ratio is consistent with a playing card (~63×88 mm = 0.716).
// Allows 0.55–0.85 to accommodate perspective distortion.
func isCardAspectRatio(pts [4]image.Point) bool {
	dist := func(a, b image.Point) float64 {
		dx, dy := float64(a.X-b.X), float64(a.Y-b.Y)
		return math.Sqrt(dx*dx + dy*dy)
	}
	sides := [4]float64{
		dist(pts[0], pts[1]),
		dist(pts[1], pts[2]),
		dist(pts[2], pts[3]),
		dist(pts[3], pts[0]),
	}
	w := (sides[0] + sides[2]) / 2
	h := (sides[1] + sides[3]) / 2
	if w == 0 || h == 0 {
		return false
	}
	ratio := math.Min(w, h) / math.Max(w, h)
	return ratio >= 0.55 && ratio <= 0.85
}

// sortCorners orders 4 points as [TL, TR, BR, BL] for perspective transform.
// Uses sum/difference of coordinates: TL has min sum, BR has max sum,
// TR has max diff (x−y), BL has min diff.
func sortCorners(pts [4]image.Point) [4]image.Point {
	type item struct {
		pt  image.Point
		sum int
		dif int
	}
	items := [4]item{
		{pts[0], pts[0].X + pts[0].Y, pts[0].X - pts[0].Y},
		{pts[1], pts[1].X + pts[1].Y, pts[1].X - pts[1].Y},
		{pts[2], pts[2].X + pts[2].Y, pts[2].X - pts[2].Y},
		{pts[3], pts[3].X + pts[3].Y, pts[3].X - pts[3].Y},
	}
	bySum := items
	sort.Slice(bySum[:], func(i, j int) bool { return bySum[i].sum < bySum[j].sum })
	byDif := items
	sort.Slice(byDif[:], func(i, j int) bool { return byDif[i].dif < byDif[j].dif })

	return [4]image.Point{
		bySum[0].pt, // TL: min (x+y)
		byDif[3].pt, // TR: max (x−y)
		bySum[3].pt, // BR: max (x+y)
		byDif[0].pt, // BL: min (x−y)
	}
}

// perspectiveWarp applies a perspective transform to map the 4 card corners
// (ordered TL, TR, BR, BL) into a canonical canonicalW × canonicalH rectangle.
func perspectiveWarp(src gocv.Mat, corners [4]image.Point) gocv.Mat {
	srcPts := gocv.NewPoint2fVectorFromPoints([]gocv.Point2f{
		{X: float32(corners[0].X), Y: float32(corners[0].Y)},
		{X: float32(corners[1].X), Y: float32(corners[1].Y)},
		{X: float32(corners[2].X), Y: float32(corners[2].Y)},
		{X: float32(corners[3].X), Y: float32(corners[3].Y)},
	})
	defer srcPts.Close()

	dstPts := gocv.NewPoint2fVectorFromPoints([]gocv.Point2f{
		{X: 0, Y: 0},
		{X: float32(canonicalW - 1), Y: 0},
		{X: float32(canonicalW - 1), Y: float32(canonicalH - 1)},
		{X: 0, Y: float32(canonicalH - 1)},
	})
	defer dstPts.Close()

	transform := gocv.GetPerspectiveTransform2f(srcPts, dstPts)
	defer transform.Close()

	warped := gocv.NewMat()
	gocv.WarpPerspective(src, &warped, transform, image.Pt(canonicalW, canonicalH))
	return warped
}
