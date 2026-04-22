package skullking

import (
	"os"
	"testing"

	"gocv.io/x/gocv"
)

func TestJollyRogerRecognize(t *testing.T) {
	r, err := NewRecognizer(DefaultConfig())
	if err != nil {
		t.Fatalf("NewRecognizer: %v", err)
	}
	defer r.Close()

	for _, tc := range []struct {
		file      string
		wantType  string
		wantValue int
	}{
		{"testdata/jolly-roger-7.jpg", "jolly-roger", 7},
		{"testdata/map-10.jpg", "map", 10},
	} {
		t.Run(tc.file, func(t *testing.T) {
			data, err := os.ReadFile(tc.file)
			if err != nil {
				t.Skipf("image not found: %v", err)
			}
			result, err := r.Recognize(data)
			if err != nil {
				t.Errorf("Recognize: %v", err)
				return
			}
			v := 0
			if result.Value != nil {
				v = *result.Value
			}
			t.Logf("got type=%s value=%d", result.Type, v)
			if result.Type != tc.wantType || v != tc.wantValue {
				t.Errorf("want %s %d", tc.wantType, tc.wantValue)
			}
		})
	}
}

func TestDigitScores(t *testing.T) {
	r, _ := NewRecognizer(DefaultConfig())
	defer r.Close()

	for _, tc := range []struct{ file string }{
		{"testdata/jolly-roger-7.jpg"},
		{"testdata/map-10.jpg"},
	} {
		data, err := os.ReadFile(tc.file)
		if err != nil {
			continue
		}
		src, _ := matFromBytes(data)
		warped, found := findCardAndWarp(src)
		src.Close()
		if !found {
			continue
		}
		t.Logf("=== %s ===", tc.file)
		for d := 1; d <= 14; d++ {
			_, cj := readNumber(warped, map[int]gocv.Mat{d: r.templates.digitsJolly[d]})
			_, cm := readNumber(warped, map[int]gocv.Mat{d: r.templates.digits[d]})
			t.Logf("  d%2d jolly=%.3f map=%.3f", d, cj, cm)
		}
		warped.Close()
	}
}
