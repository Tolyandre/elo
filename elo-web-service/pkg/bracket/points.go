package bracket

import (
	"math"
	"sort"

	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/ratingmath"
)

// PointsTenths is the slot-points scale (ADR-30): slot points are rounded to
// one decimal per match, so every per-match contribution is an integer number
// of tenths. Integer tenths keep the cumulative sums exact: binary floats
// cannot represent 0.1, and the completion rule (StrictCut) compares points
// with ==.
const PointsTenths = 10

// The per-match share (ADR-30): the leader's surplus over the worst score
// maps to topShareScale with every other score proportionally below, and
// every 1st place holder (a shared top included) adds firstPlaceBonus — so
// the rounded winner sits at exactly 1.0 while nobody else can pass 0.9.
// Rounding therefore never collapses a decisive win into a tie: a near-equal
// finish keeps the winner at least 0.1 ahead, and a genuinely shared top
// still ties and replays.
const (
	topShareScale   = 0.95
	firstPlaceBonus = 0.05
)

// MatchPoints returns the slot points, in tenths, each player earns in one
// match (ADR-30): their score surplus over the worst score as a share of the
// leader's surplus, scaled to [0, 0.95]; every 1st place holder adds the
// bonus and rounds to exactly 1.0. All-equal scores leave nothing to separate
// the players — everybody is a 1st place holder, and the bare bonus rounds to
// a uniform 0.1. Examples: 13/12/−4 → 1.0/0.9/0 (the near-equal runner-up
// stays 0.1 behind); 3/3/1 → 1.0/1.0/0 (a shared top ties); a 2-seat win →
// 1.0/0.
func MatchPoints(scores map[id.ID]float64) map[id.ID]int {
	absoluteLoserScore := ratingmath.GetAbsoluteLoserScore(scores)
	leaderScore := absoluteLoserScore
	for _, sc := range scores {
		if sc > leaderScore {
			leaderScore = sc
		}
	}

	out := make(map[id.ID]int, len(scores))
	if leaderScore == absoluteLoserScore {
		for pid := range scores {
			out[pid] = int(math.Round(firstPlaceBonus * PointsTenths))
		}
		return out
	}
	for pid, sc := range scores {
		share := topShareScale * (sc - absoluteLoserScore) / (leaderScore - absoluteLoserScore)
		if sc == leaderScore {
			share += firstPlaceBonus
		}
		out[pid] = int(math.Round(share * PointsTenths))
	}
	return out
}

// MinScoreTenths converts an organizer-set minimal score (slot points, 0–10)
// into tenths for the completion comparisons.
func MinScoreTenths(minScore float64) int {
	return int(math.Round(minScore * PointsTenths))
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
	// Points is the cumulative slot score in tenths (ADR-30): each match
	// contributes its per-match share rounded to one decimal.
	Points int
	// Order is the player's place in each linked match, most recent first —
	// the display tie-break (a later match can overturn an earlier leader).
	Order []int
	// Place is the 1-based rank in the ordered standings (1 = leader). Equal
	// points share the rank (competition ranking: 1, 1, 3 — the same RANK()
	// semantics as the per-match places); the sort's tie-breaks keep the
	// row order deterministic.
	Place    int
	Advanced bool
}

// Standings accumulates match points (ADR-30) over a slot's linked matches
// (each match's places derived from its scores) and orders them: points DESC,
// then the place-vector from the most recent match backwards, then player id —
// a deterministic total order. The completion rule does not rely on the
// tie-break (see StrictCut): an advanced set is only ever recorded with
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
	for i, places := range derived {
		points := MatchPoints(matches[i].Scores)
		for _, p := range places {
			a := accs[p.PlayerID]
			if a == nil {
				a = &acc{}
				accs[p.PlayerID] = a
				ids = append(ids, p.PlayerID)
			}
			a.points += points[p.PlayerID]
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

// StrictCut reports whether the slot may complete (ADR-26, ADR-30): the
// top-advance set must be strictly separated — every boundary from 1st
// through the (advance+1)-th has strictly decreasing points (ADR-26's
// shared-top example: 4–4–2–1 replays — the cut against the rest is clean,
// but the two co-leaders tie, and the downstream order must never be
// ambiguous) — and, when the organizer set a minimal score (minScoreTenths
// > 0), the leader must hold at least that many points. Ties or a leader
// short of the minimum keep the slot open: the players simply play the same
// slot again.
func StrictCut(sts []Standing, advance int, minScoreTenths int) bool {
	if advance <= 0 || advance >= len(sts) {
		return false
	}
	if minScoreTenths > 0 && sts[0].Points < minScoreTenths {
		return false
	}
	for i := 0; i < advance; i++ {
		if sts[i].Points <= sts[i+1].Points {
			return false
		}
	}
	return true
}
