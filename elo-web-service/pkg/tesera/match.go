package tesera

import (
	"regexp"
	"strings"
	"unicode"
)

// Candidate is a matched Tesera game, ready to fill a game row's reference
// and canonical-name columns.
type Candidate struct {
	TeseraRef int64
	// BggRef is 0 when Tesera knows no BoardGameGeek link for the game.
	BggRef int64
	// NameRu is the localized Russian title, empty when Tesera's title is
	// not a localization of the English title (game never published in Russian).
	NameRu string
	// NameEn is the official English title.
	NameEn string
	// Title is Tesera's raw localized title, for display in pickers.
	Title    string
	Year     int32
	Alias    string
	PhotoURL string
	// IsAddition carries Tesera's "addition" flag. It is UNRELIABLE as a
	// filter — some base games (Каркассон itself) carry it — so it is used
	// only to rank suggestions and to prefer base games in auto-match,
	// never to reject a candidate.
	IsAddition bool
}

// yearSuffix strips the trailing edition/year markers Tesera appends to some
// English titles ("Carcassonne, 2001", "7 Wonders (2010)").
var yearSuffix = regexp.MustCompile(`\s*[,(]\s*(?:19|20)\d{2}\s*\)?$`)

// CandidateFromDetail converts a detail object into a storable candidate.
// It returns nil only for rows without a Tesera id; the addition flag rides
// along on the candidate (see its doc for why it must not filter here).
//
// Which title is the localization is decided by script, not field order:
// some Tesera entries carry the Latin title in `title` and the Russian one
// in `title2` (Jaipur), others the reverse (Каркассон).
func CandidateFromDetail(d *GameDetail) *Candidate {
	if d == nil || d.TeseraID == 0 {
		return nil
	}
	english := strings.TrimSpace(yearSuffix.ReplaceAllString(d.Title2, ""))
	if isAllDigits(english) {
		// A bare year in title2 ("2001") is junk, not a title.
		english = ""
	}
	ru := ""
	switch {
	case english == "":
		// No English title recorded: Tesera's title is all we have.
		english = d.Title
	case hasCyrillic(d.Title) && !hasCyrillic(english):
		// Normal order: title is the localization, title2 the English title.
		if NormalizeName(d.Title) != NormalizeName(english) {
			ru = d.Title
		}
	case !hasCyrillic(d.Title) && hasCyrillic(english):
		// Swapped entry: the Russian name sits in title2.
		ru = english
		english = d.Title
	}
	return &Candidate{
		TeseraRef:  d.TeseraID,
		BggRef:     d.BggID,
		NameRu:     ru,
		NameEn:     english,
		Title:      d.Title,
		Year:       d.Year,
		Alias:      d.Alias,
		PhotoURL:   d.PhotoURL,
		IsAddition: d.IsAddition,
	}
}

func hasCyrillic(s string) bool {
	return strings.ContainsFunc(s, func(r rune) bool {
		return unicode.Is(unicode.Cyrillic, r)
	})
}

func isAllDigits(s string) bool {
	return s != "" && strings.TrimFunc(s, unicode.IsDigit) == ""
}

// MatchesName reports whether name equals the candidate's localized or
// English title under NormalizeName. This is the auto-match threshold:
// only exact matches are applied without a human confirming them.
func (c *Candidate) MatchesName(name string) bool {
	n := NormalizeName(name)
	return n != "" &&
		(n == NormalizeName(c.Title) || n == NormalizeName(c.NameEn))
}

// NormalizeName folds a title for comparison: case-insensitive, ё→е,
// punctuation dropped, whitespace collapsed.
func NormalizeName(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range strings.ToLower(s) {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			space = true
			continue
		}
		if r == 'ё' {
			r = 'е'
		}
		if space && b.Len() > 0 {
			b.WriteRune(' ')
		}
		b.WriteRune(r)
		space = false
	}
	return b.String()
}
