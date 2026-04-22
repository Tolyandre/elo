package skullking

import (
	"os"
	"testing"

	"gocv.io/x/gocv"
)

// TestFindCardAndWarp verifies that the card locator finds and warps the card
// from real test images (arbitrary background, possible tilt/rotation).
func TestFindCardAndWarp(t *testing.T) {
	cases := []struct {
		file string
		want string // expected card type
	}{
		{"testdata/map-10.jpg", "map"},
		{"testdata/mermaid-alyra.jpg", "mermaid"},
		{"testdata/pirate.jpg", "pirate"},
		{"testdata/jolly-roger-7.jpg", "jolly-roger"},
	}

	r, err := NewRecognizer(DefaultConfig())
	if err != nil {
		t.Fatalf("NewRecognizer: %v", err)
	}
	defer r.Close()

	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			data, err := os.ReadFile(tc.file)
			if err != nil {
				t.Skipf("test image not found: %v", err)
			}

			// Also save the warped card for visual inspection.
			src, err := matFromBytes(data)
			if err != nil {
				t.Fatalf("decode image: %v", err)
			}
			defer src.Close()

			warped, found := findCardAndWarp(src)
			if !found {
				t.Error("card not located in image")
				return
			}
			defer warped.Close()
			t.Logf("warped size: %dx%d", warped.Cols(), warped.Rows())

			// Save warped card for visual inspection (go test -v).
			outPath := tc.file + "_warped.jpg"
			if ok := gocv.IMWrite(outPath, warped); !ok {
				t.Logf("could not save warped image to %s", outPath)
			} else {
				t.Logf("saved warped card: %s", outPath)
			}

			result, err := r.Recognize(data)
			if err != nil {
				t.Errorf("Recognize failed: %v", err)
				return
			}
			if result.Type != tc.want {
				t.Errorf("got type=%q, want %q", result.Type, tc.want)
			} else {
				t.Logf("✓ recognized as %q", result.Type)
				if result.Value != nil {
					t.Logf("  value=%d", *result.Value)
				}
			}
		})
	}
}
