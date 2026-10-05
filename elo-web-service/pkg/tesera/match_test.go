package tesera

import "testing"

func TestNormalizeName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"  Каркассон  ", "каркассон"},
		{"7 Чудес", "7 чудес"},
		{"Тень в бутылке!", "тень в бутылке"},
		{"The Bottle-Imp", "the bottle imp"},
		{"Ёлки-палки, ЁЖ", "елки палки еж"},
		{"Carcassonne   (2000)", "carcassonne 2000"},
		{"", ""},
		{"  ", ""},
	}
	for _, c := range cases {
		if got := NormalizeName(c.in); got != c.want {
			t.Errorf("NormalizeName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCandidateFromDetail(t *testing.T) {
	t.Run("localized game gets ru and original names", func(t *testing.T) {
		got := CandidateFromDetail(&GameDetail{
			TeseraID: 707, BggID: 822,
			Title: "Каркассон", Title2: "Carcassonne",
			Alias: "carcassonne", Year: 2000,
		})
		if got == nil {
			t.Fatal("want candidate, got nil")
		}
		if got.NameRu != "Каркассон" || got.NameEn != "Carcassonne" {
			t.Errorf("names = %q / %q, want Каркассон / Carcassonne", got.NameRu, got.NameEn)
		}
		if got.TeseraRef != 707 || got.BggRef != 822 {
			t.Errorf("refs = %d/%d, want 707/822", got.TeseraRef, got.BggRef)
		}
	})

	t.Run("not published in Russian leaves ru empty", func(t *testing.T) {
		got := CandidateFromDetail(&GameDetail{
			TeseraID: 1, BggID: 2,
			Title: "Splendor", Title2: "Splendor",
		})
		if got == nil || got.NameRu != "" || got.NameEn != "Splendor" {
			t.Fatalf("got %+v, want empty ru / Splendor original", got)
		}
	})

	t.Run("trailing year stripped from original title", func(t *testing.T) {
		got := CandidateFromDetail(&GameDetail{
			TeseraID: 1, Title: "Семь чудес", Title2: "7 Wonders (2010)",
		})
		if got.NameEn != "7 Wonders" {
			t.Errorf("original = %q, want 7 Wonders", got.NameEn)
		}
		if got.NameRu != "Семь чудес" {
			t.Errorf("ru = %q, want Семь чудес", got.NameRu)
		}
	})

	t.Run("swapped titles put the Russian name in name_ru", func(t *testing.T) {
		// Some Tesera entries (Jaipur) carry the Latin title in `title` and
		// the Russian one in `title2`.
		got := CandidateFromDetail(&GameDetail{
			TeseraID: 5114, BggID: 54043, Title: "Jaipur", Title2: "Джайпур",
		})
		if got.NameRu != "Джайпур" || got.NameEn != "Jaipur" {
			t.Errorf("names = %q / %q, want Джайпур / Jaipur", got.NameRu, got.NameEn)
		}
	})

	t.Run("bare-year title2 falls back to the title", func(t *testing.T) {
		got := CandidateFromDetail(&GameDetail{
			TeseraID: 1, Title: "Каркассон. Река", Title2: "2001",
		})
		if got.NameEn != "Каркассон. Река" || got.NameRu != "" {
			t.Errorf("names = %q / %q, want original fallback without ru", got.NameRu, got.NameEn)
		}
	})

	t.Run("missing original falls back to title", func(t *testing.T) {
		got := CandidateFromDetail(&GameDetail{TeseraID: 5, Title: "Бутылочка"})
		if got.NameEn != "Бутылочка" || got.NameRu != "" {
			t.Errorf("got %+v, want original=Бутылочка, ru empty", got)
		}
	})

	t.Run("addition flag rides along, rows without id are rejected", func(t *testing.T) {
		// Tesera's isAddition is unreliable (some base games carry it), so
		// it must NOT reject a candidate — callers use it only for ranking.
		addition := CandidateFromDetail(&GameDetail{TeseraID: 1, Title: "Река", IsAddition: true})
		if addition == nil || !addition.IsAddition {
			t.Errorf("addition candidate = %+v, want IsAddition kept", addition)
		}
		if CandidateFromDetail(&GameDetail{Title: "X"}) != nil {
			t.Error("row without tesera id must not become a candidate")
		}
		if CandidateFromDetail(nil) != nil {
			t.Error("nil detail must not become a candidate")
		}
	})
}

func TestCandidateMatchesName(t *testing.T) {
	c := CandidateFromDetail(&GameDetail{
		TeseraID: 1, Title: "Каркассон", Title2: "Carcassonne",
	})
	for _, name := range []string{"Каркассон", "КАРКАССОН", "Carcassonne!", "carcassonne"} {
		if !c.MatchesName(name) {
			t.Errorf("MatchesName(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"Каркассон. Охотники", "Carcassonne 2", ""} {
		if c.MatchesName(name) {
			t.Errorf("MatchesName(%q) = true, want false", name)
		}
	}
}
