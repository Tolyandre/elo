package skullking

import (
	"image"

	"gocv.io/x/gocv"
)

const canonicalW, canonicalH = 248, 347

// matchSpecial resizes input to canonical template size, preprocesses it, and
// returns the special card name with the highest NCC score among candidates.
// Pass nil for candidates to search all loaded specials.
func matchSpecial(src gocv.Mat, specials map[string]gocv.Mat, candidates []string) (name string, score float64) {
	resized := gocv.NewMat()
	gocv.Resize(src, &resized, image.Pt(canonicalW, canonicalH), 0, 0, gocv.InterpolationLinear)
	defer resized.Close()

	// Convert to BGR→Gray for CvtColor (src is BGR from IMDecode).
	gray := gocv.NewMat()
	gocv.CvtColor(resized, &gray, gocv.ColorBGRToGray)
	eq := gocv.NewMat()
	gocv.EqualizeHist(gray, &eq)
	gray.Close()
	defer eq.Close()

	search := candidates
	if search == nil {
		search = make([]string, 0, len(specials))
		for k := range specials {
			search = append(search, k)
		}
	}

	bestName := ""
	bestScore := -1.0
	mask := gocv.NewMat()
	defer mask.Close()

	for _, c := range search {
		tmpl, ok := specials[c]
		if !ok {
			continue
		}
		result := gocv.NewMat()
		gocv.MatchTemplate(eq, tmpl, &result, gocv.TmCcoeffNormed, mask)
		_, maxVal, _, _ := gocv.MinMaxLoc(result)
		result.Close()
		if float64(maxVal) > bestScore {
			bestScore = float64(maxVal)
			bestName = c
		}
	}
	return bestName, bestScore
}
