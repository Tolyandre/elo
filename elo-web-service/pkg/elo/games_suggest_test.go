package elo

import (
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/tesera"
)

func TestSuggestionTier(t *testing.T) {
	cases := []struct {
		name  string
		query string
		g     GameSuggestion
		want  int
	}{
		{"exact title", "eclipse", GameSuggestion{Title: "Eclipse"}, 0},
		{"exact via english name", "eclipse", GameSuggestion{Title: "Затмение", NameEn: "Eclipse"}, 0},
		{"exact via russian name", "каркассон", GameSuggestion{Title: "Carcassonne", NameRu: "Каркассон"}, 0},
		{"word-boundary prefix", "eclipse", GameSuggestion{Title: "Eclipse: Second Dawn for the Galaxy"}, 1},
		{"prefix must be a whole word", "eclips", GameSuggestion{Title: "Eclipse"}, 2},
		{"contains", "eclipse", GameSuggestion{Title: "Quel Eclipse"}, 2},
		{"no match", "eclipse", GameSuggestion{Title: "Splendor"}, 3},
		{"empty query", "", GameSuggestion{Title: "Eclipse"}, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := suggestionTier(tesera.NormalizeName(c.query), c.g); got != c.want {
				t.Errorf("suggestionTier(%q, %+v) = %d, want %d", c.query, c.g, got, c.want)
			}
		})
	}
}

// The eclipse case that motivated the tiered ranking: a query matching a
// base game by prefix must surface that base game ahead of the flood of
// same-prefix expansions, however BGG ordered its raw search rows.
func TestMergeSuggestionsRanksBaseGamesAboveExpansionFlood(t *testing.T) {
	// BGG's raw search order (all deduplicated): the exact base game first,
	// then expansions, with the Second Dawn base game buried among them.
	bgg := []GameSuggestion{
		{BggRef: 1, Title: "Eclipse", NameEn: "Eclipse"},
		{BggRef: 2, Title: "Eclipse: Rise of the Ancients", IsAddition: true},
		{BggRef: 3, Title: "Eclipse: Shadow of the Rift", IsAddition: true},
		{BggRef: 4, Title: "Eclipse: Ship Pack One", IsAddition: true},
		{BggRef: 5, Title: "Eclipse: Microcosm", IsAddition: true},
		{BggRef: 6, Title: "Eclipse: Second Dawn for the Galaxy", NameEn: "Eclipse: Second Dawn for the Galaxy"},
		{BggRef: 7, Title: "Quel Eclipse"},
	}
	got := mergeSuggestions(bgg, nil, "eclipse")

	wantTitles := []string{
		"Eclipse",                             // exact match
		"Eclipse: Second Dawn for the Galaxy", // prefix + base game
		// Prefix-tier expansions, shorter titles first.
		"Eclipse: Microcosm",
		"Eclipse: Ship Pack One",
		"Eclipse: Shadow of the Rift",
		"Eclipse: Rise of the Ancients",
		// The contains-tier row falls off the suggestResultLimit cap.
	}
	if len(got) != len(wantTitles) {
		t.Fatalf("got %d suggestions, want %d: %+v", len(got), len(wantTitles), got)
	}
	for i, want := range wantTitles {
		if got[i].Title != want {
			t.Errorf("suggestion[%d] = %q, want %q (full order: %v)", i, got[i].Title, want, titlesOf(got))
		}
	}
}

// A Tesera-only row ranks by the same tiers as BGG rows: an exact localized
// match beats everything BGG found.
func TestMergeSuggestionsRanksTeseraOnlyRowsByTier(t *testing.T) {
	bgg := []GameSuggestion{
		{BggRef: 1, Title: "Carcassonne", NameEn: "Carcassonne"},
		{BggRef: 2, Title: "Carcassonne: Hunters and Gatherers", IsAddition: true},
	}
	// No BGG link and no shared names: the row stays Tesera-only.
	candidates := []*tesera.Candidate{
		{TeseraRef: 707, NameRu: "Каркассон", Title: "Каркассон"},
	}
	got := mergeSuggestions(bgg, candidates, "каркассон")
	if len(got) != 3 {
		t.Fatalf("got %d suggestions, want 3: %+v", len(got), got)
	}
	// The exact Tesera row is the only tier-0 match and leads; the
	// Cyrillic-blind BGG rows keep their stable order behind it, the
	// expansion last as an addition.
	for i, want := range []string{"Каркассон", "Carcassonne", "Carcassonne: Hunters and Gatherers"} {
		if got[i].Title != want {
			t.Errorf("suggestion[%d] = %q, want %q (full order: %v)", i, got[i].Title, want, titlesOf(got))
		}
	}
}

// An addition is ranked by its own names, not hidden: when nothing better
// matches, it still occupies the result list.
func TestMergeSuggestionsKeepsAdditionsWhenNothingBetterMatches(t *testing.T) {
	got := mergeSuggestions(nil, []*tesera.Candidate{
		{TeseraRef: 4101, Title: "The River", IsAddition: true},
	}, "river")
	if len(got) != 1 || got[0].Title != "The River" {
		t.Fatalf("got %+v, want the single addition", got)
	}
}

func titlesOf(games []GameSuggestion) []string {
	out := make([]string, len(games))
	for i, g := range games {
		out[i] = g.Title
	}
	return out
}

// The merge attaches Tesera rows to BGG matches by the BGG id first; the
// localized title is the primary Russian name.
func TestMergeSuggestionsAttachesTeseraByBggID(t *testing.T) {
	bgg := []GameSuggestion{
		{BggRef: 822, Title: "Carcassonne", NameEn: "Carcassonne"},
	}
	candidates := []*tesera.Candidate{
		{TeseraRef: 707, BggRef: 822, NameRu: "Каркассон", NameEn: "Carcassonne", Title: "Каркассон"},
	}
	got := mergeSuggestions(bgg, candidates, "carcassonne")
	if len(got) != 1 {
		t.Fatalf("got %+v, want one merged row", got)
	}
	if got[0].TeseraRef != 707 {
		t.Errorf("TeseraRef = %d, want 707 attached by BGG id", got[0].TeseraRef)
	}
	if got[0].NameRu != "Каркассон" {
		t.Errorf("NameRu = %q, want the Tesera localization", got[0].NameRu)
	}
}

// The Russian name prefers Tesera's curated localization (it keeps the full
// form, e.g. «Eclipse. Второй рассвет галактики»); BGG's script heuristic —
// which strips Latin brand words from mixed-script alternates — fills in
// only when the Tesera row carries no localization.
func TestMergeSuggestionsTeseraRussianNameWins(t *testing.T) {
	bgg := []GameSuggestion{
		{BggRef: 246900, Title: "Eclipse: Second Dawn for the Galaxy", NameEn: "Eclipse: Second Dawn for the Galaxy", NameRu: "Второй рассвет галактики"},
		{BggRef: 822, Title: "Carcassonne", NameEn: "Carcassonne", NameRu: "Каркассон"},
	}
	candidates := []*tesera.Candidate{
		{TeseraRef: 1, BggRef: 246900, NameRu: "Eclipse. Второй рассвет галактики", Title: "Eclipse. Второй рассвет галактики"},
		{TeseraRef: 707, BggRef: 822, NameRu: "", NameEn: "Carcassonne", Title: "Carcassonne"},
	}
	got := mergeSuggestions(bgg, candidates, "eclipse second dawn")
	if len(got) != 2 {
		t.Fatalf("got %d rows, want 2: %+v", len(got), got)
	}
	var secondDawn, carcassonne *GameSuggestion
	for i := range got {
		switch got[i].BggRef {
		case 246900:
			secondDawn = &got[i]
		case 822:
			carcassonne = &got[i]
		}
	}
	if secondDawn == nil || carcassonne == nil {
		t.Fatalf("rows = %+v, want both games", got)
	}
	if secondDawn.NameRu != "Eclipse. Второй рассвет галактики" {
		t.Errorf("NameRu = %q, want the full Tesera localization to override the heuristic", secondDawn.NameRu)
	}
	if carcassonne.NameRu != "Каркассон" {
		t.Errorf("NameRu = %q, want the BGG heuristic kept when Tesera has no localization", carcassonne.NameRu)
	}
}
