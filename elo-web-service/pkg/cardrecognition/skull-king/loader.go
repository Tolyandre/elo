package skullking

import (
	"embed"
	"fmt"
	"io/fs"

	"gocv.io/x/gocv"
)

//go:embed templates
var templateFS embed.FS

type cardTemplates struct {
	specials    map[string]gocv.Mat // card name → preprocessed grayscale Mat (full card, fallback)
	corners     map[string]gocv.Mat // card name → BGR corner crop at template size (primary)
	digits      map[int]gocv.Mat    // 1–14 → preprocessed grayscale Mat (map suit)
	digitsJolly map[int]gocv.Mat    // 1–14 → preprocessed grayscale Mat (jolly-roger suit)
}

func loadTemplates() (*cardTemplates, error) {
	t := &cardTemplates{
		specials:    make(map[string]gocv.Mat),
		corners:     make(map[string]gocv.Mat),
		digits:      make(map[int]gocv.Mat),
		digitsJolly: make(map[int]gocv.Mat),
	}

	// Full-card specials: grayscale + equalized (for fallback NCC matching).
	specialEntries, err := fs.ReadDir(templateFS, "templates/special")
	if err != nil {
		return nil, fmt.Errorf("read templates/special: %w", err)
	}
	for _, e := range specialEntries {
		if e.IsDir() {
			continue
		}
		name := trimExt(e.Name())
		mat, err := readEmbeddedMat("templates/special/" + e.Name())
		if err != nil {
			t.close()
			return nil, fmt.Errorf("load special/%s: %w", e.Name(), err)
		}
		preprocessed := preprocessGray(mat)
		mat.Close()
		t.specials[name] = preprocessed
	}

	// Corner badge crops: stored as color (BGR) — color is the primary discriminant.
	cornerEntries, err := fs.ReadDir(templateFS, "templates/corners")
	if err != nil {
		return nil, fmt.Errorf("read templates/corners: %w", err)
	}
	for _, e := range cornerEntries {
		if e.IsDir() {
			continue
		}
		name := trimExt(e.Name())
		mat, err := readEmbeddedMat("templates/corners/" + e.Name())
		if err != nil {
			t.close()
			return nil, fmt.Errorf("load corners/%s: %w", e.Name(), err)
		}
		t.corners[name] = mat // keep as BGR; matchCorner will resize input to match
	}

	for d := 1; d <= 14; d++ {
		path := fmt.Sprintf("templates/digits/%d.png", d)
		mat, err := readEmbeddedMat(path)
		if err != nil {
			t.close()
			return nil, fmt.Errorf("load digit %d: %w", d, err)
		}
		// Templates are pre-binarized (adaptive threshold at extraction time).
		gray := loadGrayRaw(mat)
		mat.Close()
		t.digits[d] = gray
	}

	for d := 1; d <= 14; d++ {
		path := fmt.Sprintf("templates/digits-jolly/%d.png", d)
		mat, err := readEmbeddedMat(path)
		if err != nil {
			t.close()
			return nil, fmt.Errorf("load jolly digit %d: %w", d, err)
		}
		gray := loadGrayRaw(mat)
		mat.Close()
		t.digitsJolly[d] = gray
	}

	return t, nil
}

func (t *cardTemplates) close() {
	for _, m := range t.specials {
		m.Close()
	}
	for _, m := range t.corners {
		m.Close()
	}
	for _, m := range t.digits {
		m.Close()
	}
	for _, m := range t.digitsJolly {
		m.Close()
	}
}

// readEmbeddedMat reads a file from the embedded FS and decodes it as a gocv Mat.
func readEmbeddedMat(path string) (gocv.Mat, error) {
	data, err := templateFS.ReadFile(path)
	if err != nil {
		return gocv.Mat{}, err
	}
	mat, err := gocv.IMDecode(data, gocv.IMReadColor)
	if err != nil {
		return gocv.Mat{}, fmt.Errorf("IMDecode %s: %w", path, err)
	}
	if mat.Empty() {
		mat.Close()
		return gocv.Mat{}, fmt.Errorf("empty mat from %s", path)
	}
	return mat, nil
}

// loadGrayRaw converts a color Mat to grayscale without any further processing.
// Used for digit templates that are already binarized at extraction time.
func loadGrayRaw(src gocv.Mat) gocv.Mat {
	gray := gocv.NewMat()
	gocv.CvtColor(src, &gray, gocv.ColorBGRToGray)
	return gray
}

// preprocessGray converts a color Mat to grayscale and equalizes the histogram.
func preprocessGray(src gocv.Mat) gocv.Mat {
	gray := gocv.NewMat()
	gocv.CvtColor(src, &gray, gocv.ColorBGRToGray)
	eq := gocv.NewMat()
	gocv.EqualizeHist(gray, &eq)
	gray.Close()
	return eq
}

// matFromBytes decodes JPEG/PNG bytes into a BGR Mat.
func matFromBytes(data []byte) (gocv.Mat, error) {
	mat, err := gocv.IMDecode(data, gocv.IMReadColor)
	if err != nil {
		return gocv.Mat{}, err
	}
	if mat.Empty() {
		mat.Close()
		return gocv.Mat{}, fmt.Errorf("decoded empty mat")
	}
	return mat, nil
}

func trimExt(filename string) string {
	for i := len(filename) - 1; i >= 0; i-- {
		if filename[i] == '.' {
			return filename[:i]
		}
	}
	return filename
}
