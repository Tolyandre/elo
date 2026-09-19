package bracket

import (
	"sort"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// PlacementPoints returns the placement points a place-i player earns in a
// slot table of s seats (ADR-26): place 1 → s, place 2 → s−1, …, the last
// place → 1. Points are relative only; every place scores. Shared places
// (tied game scores) share points.
func PlacementPoints(place, seats int) int {
	return seats - place + 1
}

// PlayerPlace is one player's derived place in one match.
type PlayerPlace struct {
	PlayerID id.ID
	Place    int // 1-based; tied scores share the place (competition ranking)
	Score    float64
}

// DerivePlaces ranks a match's player→score map with the codebase's derived
// semantics — RANK() … ORDER BY score DESC: ties for a place share it, and
// ties for 1st are normal.
func DerivePlaces(scores map[id.ID]float64) []PlayerPlace {
	pls := make([]PlayerPlace, 0, len(scores))
	for pid, sc := range scores {
		pls = append(pls, PlayerPlace{PlayerID: pid, Score: sc})
	}
	sort.Slice(pls, func(i, j int) bool {
		if pls[i].Score != pls[j].Score {
			return pls[i].Score > pls[j].Score
		}
		return pls[i].PlayerID < pls[j].PlayerID
	})
	for i := range pls {
		if i > 0 && pls[i].Score == pls[i-1].Score {
			pls[i].Place = pls[i-1].Place
		} else {
			pls[i].Place = i + 1
		}
	}
	return pls
}

// MatchResult is one linked match of a slot's series, in chronological order
// (the caller supplies the order — match date, then id) with its player→score
// map. Places are derived internally with the codebase's RANK semantics.
type MatchResult struct {
	MatchID id.ID
	Scores  map[id.ID]float64
}

// Standing is one player's cumulative slot standing.
type Standing struct {
	PlayerID id.ID
	Points   int
	// Order is the player's place in each linked match, most recent first —
	// the display tie-break (a later match can overturn an earlier leader).
	Order []int
	// Place is the 1-based rank in the ordered standings (1 = leader). Equal
	// points share the rank (competition ranking: 1, 1, 3 — the same RANK()
	// semantics as the per-match places); the sort's tie-breaks keep the
	// row order deterministic.
	Place    int
	Promoted bool
}

// Standings accumulates placement points over a slot's linked matches (each
// match's places derived from its scores) and orders them: points DESC, then
// the place-vector from the most recent match backwards, then player id — a
// deterministic total order. The completion rule does not rely on the
// tie-break (see StrictCut): a promoted set is only ever recorded with
// strictly separated points.
func Standings(matches []MatchResult, seats int) []Standing {
	derived := make([][]PlayerPlace, len(matches))
	for i, m := range matches {
		derived[i] = DerivePlaces(m.Scores)
	}

	type acc struct {
		points int
	}
	accs := make(map[id.ID]*acc, seats*2)
	ids := make([]id.ID, 0, seats)
	for _, places := range derived {
		for _, p := range places {
			a := accs[p.PlayerID]
			if a == nil {
				a = &acc{}
				accs[p.PlayerID] = a
				ids = append(ids, p.PlayerID)
			}
			a.points += PlacementPoints(p.Place, seats)
		}
	}

	out := make([]Standing, 0, len(ids))
	for _, pid := range ids {
		st := Standing{PlayerID: pid, Points: accs[pid].points, Order: make([]int, 0, len(matches))}
		for mi := len(derived) - 1; mi >= 0; mi-- {
			for _, p := range derived[mi] {
				if p.PlayerID == pid {
					st.Order = append(st.Order, p.Place)
					break
				}
			}
		}
		out = append(out, st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Points != out[j].Points {
			return out[i].Points > out[j].Points
		}
		for k := 0; k < len(out[i].Order) && k < len(out[j].Order); k++ {
			if out[i].Order[k] != out[j].Order[k] {
				return out[i].Order[k] < out[j].Order[k]
			}
		}
		return out[i].PlayerID < out[j].PlayerID
	})
	for i := range out {
		if i > 0 && out[i].Points == out[i-1].Points {
			out[i].Place = out[i-1].Place // equal points share the rank
		} else {
			out[i].Place = i + 1
		}
	}
	return out
}

// StrictCut reports whether the slot's top-promote set is strictly separated
// — every boundary from 1st through the (promote+1)-th has strictly
// decreasing points (ADR-26's shared-top example: 4–4–2–1 replays — the cut
// against the rest is clean, but the two co-leaders tie, and the downstream
// order must never be ambiguous). Ties keep the slot open: the players
// simply play the same slot again.
func StrictCut(sts []Standing, promote int) bool {
	if promote <= 0 || promote >= len(sts) {
		return false
	}
	for i := 0; i < promote; i++ {
		if sts[i].Points <= sts[i+1].Points {
			return false
		}
	}
	return true
}
