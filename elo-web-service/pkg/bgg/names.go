package bgg

import (
	"strings"
	"unicode"
)

// PickRussianName extracts the localized Russian title from a thing's
// alternate names, or "" when none can be attributed to Russian with
// confidence.
//
// The XML API2 tags alternate names with no language, so the attribution is
// by script: Ukrainian («Пандемія»), Belarusian, Bulgarian and Serbian
// Cyrillic titles sit in the same list as the Russian ones, and a game can
// carry several legitimate Russian spellings plus old re-theme names.
// Candidates are scored (see scoreCyrillic) and only a unique maximum wins —
// on a tie the caller gets "" and another source (Tesera) or the admin fills
// the name.
func PickRussianName(alternates []string) string {
	type scored struct {
		display string
		folded  string
		score   int
	}
	var candidates []scored
	seen := make(map[string]bool)
	for _, alt := range alternates {
		name := extractCyrillic(alt)
		if name == "" {
			continue
		}
		folded := foldCyrillic(name)
		if seen[folded] {
			continue
		}
		seen[folded] = true
		candidates = append(candidates, scored{display: name, folded: folded, score: scoreCyrillic(name)})
	}
	switch len(candidates) {
	case 0:
		return ""
	case 1:
		if candidates[0].score < 0 {
			return ""
		}
		return candidates[0].display
	}
	best := candidates[0]
	unique := true
	for _, c := range candidates[1:] {
		if c.score > best.score {
			best, unique = c, true
		} else if c.score == best.score {
			unique = false
		}
	}
	// A tie at the top (or below a Russian-marked leader) stays unresolved.
	if !unique || best.score < 0 {
		return ""
	}
	return best.display
}

// extractCyrillic pulls the Russian-looking part out of an alternate name.
// Plain Cyrillic names pass through; mixed-script entries like
// "Catan (Колонизаторы)" reduce to their single Cyrillic run, and anything
// with two or more runs ("Караколумбус / Колумб") is skipped as unusable.
// Latin letters and slashes end a run; other punctuation, spaces and digits
// stay inside it («7 Чудес» keeps its shape), with the edges trimmed.
func extractCyrillic(s string) string {
	if !hasCyrillic(s) {
		return ""
	}
	var runs []string
	var current strings.Builder
	hasCyr := false
	flush := func() {
		if current.Len() > 0 && hasCyr {
			if run := strings.TrimFunc(current.String(), func(r rune) bool {
				return !unicode.IsLetter(r) && !unicode.IsDigit(r)
			}); run != "" {
				runs = append(runs, run)
			}
		}
		current.Reset()
		hasCyr = false
	}
	for _, r := range s {
		switch {
		case isCyrillic(r):
			current.WriteRune(r)
			hasCyr = true
		case unicode.IsLetter(r), r == '/':
			flush()
		default:
			current.WriteRune(r)
		}
	}
	flush()
	if len(runs) != 1 {
		return ""
	}
	return runs[0]
}

// scoreCyrillic ranks a Cyrillic candidate for the Russian localization:
// letters that only the Russian alphabet uses push up, letters that belong to
// a neighbouring Cyrillic orthography push down hard.
func scoreCyrillic(s string) int {
	score := 0
	for _, r := range s {
		switch r {
		case 'ы', 'э':
			score++ // Russian-only
		case 'і', 'ї', 'є', 'ґ':
			score -= 2 // Ukrainian-only
		case 'ј', 'љ', 'њ', 'ћ', 'ђ', 'џ':
			score -= 3 // Serbian-only
		}
	}
	return score
}

// foldCyrillic normalizes a candidate for deduplication: case-folded with
// ё→е, so «Каркасон» twice counts once.
func foldCyrillic(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		if r == 'ё' {
			r = 'е'
		}
		b.WriteRune(r)
	}
	return b.String()
}

func hasCyrillic(s string) bool {
	return strings.ContainsFunc(s, isCyrillic)
}

func isCyrillic(r rune) bool {
	return unicode.Is(unicode.Cyrillic, r)
}
