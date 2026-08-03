package api

import (
	"strings"
	"testing"
)

func TestValidateClubIconKey_Valid(t *testing.T) {
	valid := map[string]string{
		"simple":      "tbonk",
		"kebab":       "blue-figure",
		"alphanumeric": "icon2",
		"multi-segment": "a-b-c",
		"with-spaces":  "  clover  ",
	}
	for name, in := range valid {
		out, err := validateClubIconKey(in)
		if err != nil {
			t.Errorf("%s: expected valid, got error %v for: %q", name, err, in)
			continue
		}
		if out != strings.TrimSpace(in) {
			t.Errorf("%s: expected trimmed key %q, got %q", name, strings.TrimSpace(in), out)
		}
	}
}

func TestValidateClubIconKey_Rejected(t *testing.T) {
	rejected := map[string]string{
		"empty":            ``,
		"whitespace":       `   `,
		"uppercase":        `Tbonk`,
		"leading hyphen":   `-tbonk`,
		"trailing hyphen":  `tbonk-`,
		"double hyphen":    `blue--figure`,
		"underscore":       `blue_figure`,
		"space inside":     `blue figure`,
		"svg markup":       `<svg viewBox="0 0 1 1"></svg>`,
		"slash":            `icons/tbonk`,
		"special chars":    `tbonk!`,
		"non-ascii":        `тбонк`,
	}
	for name, in := range rejected {
		if _, err := validateClubIconKey(in); err == nil {
			t.Errorf("%s: expected rejection, got nil error for: %q", name, in)
		}
	}
}

func TestValidateClubIconKey_TooLong(t *testing.T) {
	big := strings.Repeat("a", maxClubIconKeyBytes+1)
	if _, err := validateClubIconKey(big); err == nil {
		t.Errorf("expected oversize rejection")
	}
}
