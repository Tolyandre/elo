package elo

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
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

func TestBuildGameUpdateDetails(t *testing.T) {
	old := db.Game{Name: "X", NameEn: pgText("X"), GameMode: GameModeCompetitive}
	if !buildGameUpdateDetails(old, old).IsEmpty() {
		t.Error("identical rows must produce an empty diff")
	}

	renamed := old
	renamed.NameEn = pgText("Y")
	renamed.Name = "Y"
	d := buildGameUpdateDetails(old, renamed)
	if d.IsEmpty() || d.Name == nil || d.NameEn == nil {
		t.Errorf("rename diff = %+v, want name and name_en changes", d)
	}

	bggChanged := old
	bggChanged.BggID = pgtype.Int4{Int32: 822, Valid: true}
	d = buildGameUpdateDetails(old, bggChanged)
	if d.IsEmpty() || d.BggRef == nil || d.BggRef.From != nil || d.BggRef.To == nil || *d.BggRef.To != 822 {
		t.Errorf("bgg diff = %+v, want null → 822", d.BggRef)
	}

	modeChanged := old
	modeChanged.GameMode = GameModeCoop
	d = buildGameUpdateDetails(old, modeChanged)
	if d.IsEmpty() || d.GameMode == nil || d.GameMode.To != GameModeCoop {
		t.Errorf("mode diff = %+v, want → coop", d.GameMode)
	}
}
