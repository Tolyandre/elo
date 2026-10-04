package elo

import (
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/tesera"
)

func TestCanonicalizeNames(t *testing.T) {
	cases := []struct {
		name, typed, ru, original, wantDisplay, wantAlias string
	}{
		// Custom name over both canonical names becomes an alias.
		{"custom name", "Бутылочка", "Тень в бутылке", "The Bottle Imp", "Бутылочка", "Бутылочка"},
		// Typed name equals the localized name: no alias, display canonicalized.
		{"equals ru", "тень в бутылке", "Тень в бутылке", "The Bottle Imp", "Тень в бутылке", ""},
		// Typed name equals the original name (case/punctuation-insensitive).
		{"equals original", "The Bottle Imp!", "", "The Bottle Imp", "The Bottle Imp", ""},
		// Only the original exists; punctuation-only differences fold to the
		// canonical name instead of creating an alias.
		{"no ru, punctuation folds", "Splendor: Duel", "", "Splendor Duel", "Splendor Duel", ""},
		// Only the original exists; a genuinely different name is an alias.
		{"no ru, custom name", "Блеск", "", "Splendor Duel", "Блеск", "Блеск"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			display, alias := canonicalizeNames(c.typed, c.ru, c.original)
			if display != c.wantDisplay || alias != c.wantAlias {
				t.Errorf("canonicalizeNames(%q, %q, %q) = (%q, %q), want (%q, %q)",
					c.typed, c.ru, c.original, display, alias, c.wantDisplay, c.wantAlias)
			}
		})
	}
}

func TestDisplayName(t *testing.T) {
	if got := displayName("", "", ""); got != "" {
		t.Errorf("displayName(empty) = %q, want empty", got)
	}
	if got := displayName("", "Тень в бутылке", "The Bottle Imp"); got != "Тень в бутылке" {
		t.Errorf("displayName ru fallback = %q", got)
	}
	if got := displayName("Бутылочка", "Тень в бутылке", "The Bottle Imp"); got != "Бутылочка" {
		t.Errorf("displayName alias precedence = %q", got)
	}
	if got := displayName("", "", "The Bottle Imp"); got != "The Bottle Imp" {
		t.Errorf("displayName original fallback = %q", got)
	}
}

func TestGameMetaChanged(t *testing.T) {
	old := db.Game{Name: "X", NameOriginal: pgText("X")}
	same := GameMetaPatch{
		Alias:        nil,
		NameOriginal: strPtr("X"),
		NameRu:       nil,
		BggRef:       nil,
		TeseraRef:    nil,
	}
	if gameMetaChanged(old, "", "X", "", same) {
		t.Error("identical metadata must not report a change")
	}
	changed := same
	changed.BggRef = int64Ptr(822)
	if !gameMetaChanged(old, "", "X", "", changed) {
		t.Error("bgg ref change must be detected")
	}
}

// int64Ptr mirrors the wire layer's *int for the patch struct.
func int64Ptr(v int64) *int64 { return &v }

func TestNormalizeNameCompat(t *testing.T) {
	// The elo layer relies on tesera.NormalizeName for alias derivation; a
	// title pair that differs only by case/punctuation must fold equal.
	if tesera.NormalizeName("Ёжик") != tesera.NormalizeName("ежик") {
		t.Error("ё folding broken")
	}
}
