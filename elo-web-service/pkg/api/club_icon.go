package api

import (
	"fmt"
	"regexp"
	"strings"
)

// maxClubIconKeyBytes caps the stored icon-key length.
const maxClubIconKeyBytes = 32

// clubIconKeyPattern matches a lowercase kebab-case key, e.g. "blue-figure",
// "clover", "tbonk". This is the format enforced for the built-in icon set.
var clubIconKeyPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// validateClubIconKey validates that s is a valid built-in icon key. The icon
// itself is a version-controlled static asset in the frontend; the backend only
// stores and validates the key, not the SVG markup.
func validateClubIconKey(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("icon is empty")
	}
	if len(s) > maxClubIconKeyBytes {
		return "", fmt.Errorf("icon key is too long (max %d bytes)", maxClubIconKeyBytes)
	}
	if !clubIconKeyPattern.MatchString(s) {
		return "", fmt.Errorf("icon key must be lowercase kebab-case (a-z, 0-9, hyphens)")
	}
	return s, nil
}
