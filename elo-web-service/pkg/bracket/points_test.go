package bracket

import (
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

func mustID(s string) id.ID { return id.ID(s) }

// match builds a MatchResult from a player→score map with the default win
// reward (the seeded elo_settings row ships win_reward = 1).
func match(mid string, scores map[string]float64) MatchResult {
	return matchW(mid, scores, 1)
}

// matchW is match with an explicit win reward.
func matchW(mid string, scores map[string]float64, winReward float64) MatchResult {
	m := map[id.ID]float64{}
	for pid, sc := range scores {
		m[mustID(pid)] = sc
	}
	return MatchResult{MatchID: mustID(mid), Scores: m, WinReward: winReward}
}

func pointsOf(sts []Standing, pid string) int {
	for _, st := range sts {
		if st.PlayerID == mustID(pid) {
			return st.Points
		}
	}
	return -999999
}

func orderOf(sts []Standing) []string {
	out := make([]string, 0, len(sts))
	for _, st := range sts {
		out = append(out, string(st.PlayerID))
	}
	return out
}

func TestMatchPoints(t *testing.T) {
	// W=1: the share is the score surplus over the worst score, divided by
	// the summed surpluses; tenths rounded.
	cases := []struct {
		name   string
		scores map[string]float64
		w      float64
		want   map[string]int
	}{
		{
			// A 2-seat win always takes the full share: the loser's surplus
			// is 0, so 1.0 / 0.0.
			name:   "two-seat win earns the full 1.0",
			scores: map[string]float64{"A": 10, "B": 2},
			w:      1,
			want:   map[string]int{"A": 10, "B": 0},
		},
		{
			// The ADR-27 motivating example: a tied top (3/3/1) earns the
			// co-winners 0.5 each — the loser is not stranded at a fixed
			// offset and can catch up match by match.
			name:   "shared three-seat top earns 0.5 each",
			scores: map[string]float64{"A": 3, "B": 3, "C": 1},
			w:      1,
			want:   map[string]int{"A": 5, "B": 5, "C": 0},
		},
		{
			// Surpluses 8/5/3/0 of sum 16: 0.5 / 0.3125 / 0.1875 / 0.
			name:   "four seats split by margin",
			scores: map[string]float64{"A": 10, "B": 7, "C": 5, "D": 2},
			w:      1,
			want:   map[string]int{"A": 5, "B": 3, "C": 2, "D": 0},
		},
		{
			// A higher winReward steepens the curve: surpluses 8/2/0 squared
			// give 64/4/0 → 0.941 / 0.059 / 0.
			name:   "winReward 2 punishes low placements",
			scores: map[string]float64{"A": 9, "B": 3, "C": 1},
			w:      2,
			want:   map[string]int{"A": 9, "B": 1, "C": 0},
		},
		{
			// All-equal scores leave the share undefined; the uniform 1/N
			// fallback applies (1/3 → 0.333 → 3 tenths).
			name:   "all-equal scores fall back to uniform thirds",
			scores: map[string]float64{"A": 5, "B": 5, "C": 5},
			w:      1,
			want:   map[string]int{"A": 3, "B": 3, "C": 3},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := map[id.ID]float64{}
			for pid, sc := range tc.scores {
				m[mustID(pid)] = sc
			}
			got := MatchPoints(m, tc.w)
			for pid, want := range tc.want {
				if got[mustID(pid)] != want {
					t.Errorf("MatchPoints(%v, %v)[%s] = %d, want %d", tc.scores, tc.w, pid, got[mustID(pid)], want)
				}
			}
		})
	}
}

func TestMinScoreTenths(t *testing.T) {
	if got := MinScoreTenths(0); got != 0 {
		t.Errorf("MinScoreTenths(0) = %d, want 0", got)
	}
	if got := MinScoreTenths(2); got != 20 {
		t.Errorf("MinScoreTenths(2) = %d, want 20", got)
	}
	if got := MinScoreTenths(2.5); got != 25 {
		t.Errorf("MinScoreTenths(2.5) = %d, want 25", got)
	}
}

func TestDerivePlacesSharesTies(t *testing.T) {
	places := DerivePlaces(map[id.ID]float64{
		mustID("a"): 10, mustID("b"): 10, mustID("c"): 5, mustID("d"): 5, mustID("e"): 1,
	})
	want := []struct {
		pid   string
		place int
	}{
		{"a", 1}, {"b", 1}, {"c", 3}, {"d", 3}, {"e", 5},
	}
	for i, w := range want {
		if places[i].PlayerID != mustID(w.pid) || places[i].Place != w.place {
			t.Fatalf("place %d: got (%s,%d), want (%s,%d)", i, places[i].PlayerID, places[i].Place, w.pid, w.place)
		}
	}
}

// TestADRReplayExample is the ADR-26 slot-play example restated on the ADR-27
// scale (W=1): a slot of 4 advancing 2. Match 1 ends with a shared top game
// score → 5–5–0–0 (tenths), no strict cut, the slot replays. Match 2:
// B 10/A 5/C 1/D 0 earns 6/3/1/0 → cumulative 11–8–1–0 → strict top-2
// {B, A} → completed.
func TestADRReplayExample(t *testing.T) {
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})

	sts := Standings([]MatchResult{m1}, 4)
	if pointsOf(sts, "A") != 5 || pointsOf(sts, "B") != 5 || pointsOf(sts, "C") != 0 || pointsOf(sts, "D") != 0 {
		t.Fatalf("match 1 points: got %v", orderOf(sts))
	}
	if StrictCut(sts, 2, 0) {
		t.Fatalf("5–5–0–0 must replay (the co-leaders tie)")
	}

	m2 := match("m2", map[string]float64{"B": 10, "A": 5, "C": 1, "D": 0})
	sts = Standings([]MatchResult{m1, m2}, 4)
	if pointsOf(sts, "B") != 11 || pointsOf(sts, "A") != 8 || pointsOf(sts, "C") != 1 || pointsOf(sts, "D") != 0 {
		t.Fatalf("cumulative points: got %+v", sts)
	}
	if !StrictCut(sts, 2, 0) {
		t.Fatalf("11–8–1–0 must complete the slot")
	}
	if got := orderOf(sts); got[0] != "B" || got[1] != "A" || got[2] != "C" || got[3] != "D" {
		t.Fatalf("standings order: got %v", got)
	}
	// Distinct points → distinct places 1..4.
	for i, st := range sts {
		if st.Place != i+1 {
			t.Fatalf("place numbering: %+v", sts)
		}
	}
}

func TestTieInsideAdvancedSetBlocks(t *testing.T) {
	// 10–10–0–0 with advance 2: the cut against the rest is clean, but the two
	// leaders tie — the downstream order would be ambiguous, so the slot stays
	// open.
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})
	m2 := match("m2", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})
	sts := Standings([]MatchResult{m1, m2}, 4)
	if StrictCut(sts, 2, 0) {
		t.Fatalf("10–10–0–0 must not complete an advance-2 slot")
	}
}

func TestTieAtCutBoundaryBlocks(t *testing.T) {
	// Cumulative 5–5–5–5 with advance 2: places 2 and 3 share points at the
	// cut — the top-2 set is not strictly separated from the rest.
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 1})
	m2 := match("m2", map[string]float64{"C": 10, "D": 10, "A": 1, "B": 1})
	sts := Standings([]MatchResult{m1, m2}, 4)
	if pointsOf(sts, "A") != 5 || pointsOf(sts, "B") != 5 || pointsOf(sts, "C") != 5 || pointsOf(sts, "D") != 5 {
		t.Fatalf("fixture drift: %+v", sts)
	}
	if StrictCut(sts, 2, 0) {
		t.Fatalf("5–5–5–5 must not complete: the cut boundary ties")
	}
}

func TestStrictCutMinScoreGate(t *testing.T) {
	// The organizer's minimal score (ADR-27) is an extra completion gate on
	// top of the strict cut: the leader must hold at least that many points.
	// One 2-seat match: A earned the full 1.0 (10 tenths), B 0.
	m1 := match("m1", map[string]float64{"A": 10, "B": 2})
	sts := Standings([]MatchResult{m1}, 2)
	if !StrictCut(sts, 1, 0) {
		t.Fatalf("min score 0 keeps the plain strict cut")
	}
	if !StrictCut(sts, 1, 10) {
		t.Fatalf("a leader at the minimum (1.0) completes the slot")
	}
	if StrictCut(sts, 1, 11) {
		t.Fatalf("a leader below the minimum keeps the slot open")
	}

	// A tie at the top blocks completion even when both leaders are far above
	// the minimum — the strict cut always applies.
	m2 := match("m2", map[string]float64{"B": 10, "A": 2})
	sts = Standings([]MatchResult{m1, m2}, 2)
	if pointsOf(sts, "A") != 10 || pointsOf(sts, "B") != 10 {
		t.Fatalf("fixture drift: %+v", sts)
	}
	if StrictCut(sts, 1, 5) {
		t.Fatalf("10–10 with advance 1 must block on the tie")
	}
	if StrictCut(sts, 1, 20) {
		t.Fatalf("10–10 with advance 1 must also block on the minimum score")
	}
}

func TestLateOverturn(t *testing.T) {
	// A leads after match 1; match 2 flips the order — every match counts,
	// nothing is discarded. With one win apiece the points tie (10–10): the
	// 2-seat slot replays; B taking match 3 completes it 20–10.
	m1 := match("m1", map[string]float64{"A": 10, "B": 2})
	m2 := match("m2", map[string]float64{"B": 10, "A": 2})
	m3 := match("m3", map[string]float64{"B": 10, "A": 2})

	sts := Standings([]MatchResult{m1}, 2)
	if sts[0].PlayerID != mustID("A") {
		t.Fatalf("match 1 leader: %+v", sts)
	}
	sts = Standings([]MatchResult{m1, m2}, 2)
	if StrictCut(sts, 1, 0) {
		t.Fatalf("10–10 in a 2-seat slot must replay")
	}
	if sts[0].PlayerID != mustID("B") {
		t.Fatalf("tie-break must prefer the recent winner: %+v", sts)
	}
	sts = Standings([]MatchResult{m1, m2, m3}, 2)
	if !StrictCut(sts, 1, 0) || sts[0].PlayerID != mustID("B") || pointsOf(sts, "B") != 20 || pointsOf(sts, "A") != 10 {
		t.Fatalf("2–1 series must complete for B: %+v", sts)
	}
}

func TestStandingsTieBreakPrefersRecentMatch(t *testing.T) {
	// Equal cumulative points: the player who placed better most recently
	// ranks higher (the display tie-break; completion needs strict points).
	m1 := match("m1", map[string]float64{"A": 10, "B": 2})
	m2 := match("m2", map[string]float64{"B": 10, "A": 2})
	sts := Standings([]MatchResult{m1, m2}, 2)
	// Both have 10 tenths; B won the most recent match.
	if sts[0].PlayerID != mustID("B") || sts[1].PlayerID != mustID("A") {
		t.Fatalf("tie-break must prefer the recent match: %+v", sts)
	}
	if len(sts[0].Order) != 2 || sts[0].Order[0] != 1 || sts[0].Order[1] != 2 {
		t.Fatalf("order vector must be most-recent-first: %+v", sts[0].Order)
	}
}

func TestStandingsFinalTieBreakIsPlayerID(t *testing.T) {
	// Identical place vectors everywhere: the canonical player id breaks the
	// display tie deterministically.
	m1 := match("m1", map[string]float64{"b": 10, "a": 10, "c": 1, "d": 1})
	sts := Standings([]MatchResult{m1}, 4)
	if string(sts[0].PlayerID) != "a" || string(sts[1].PlayerID) != "b" ||
		string(sts[2].PlayerID) != "c" || string(sts[3].PlayerID) != "d" {
		t.Fatalf("player-id tie-break: %+v", orderOf(sts))
	}
}

func TestStandingsSharesPlaceOnEqualPoints(t *testing.T) {
	// Equal cumulative points share the display rank (competition ranking,
	// 1, 1, 3 — the same semantics as the per-match places); the next place
	// skips accordingly.
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})
	sts := Standings([]MatchResult{m1}, 4)
	if pointsOf(sts, "A") != 5 || pointsOf(sts, "B") != 5 || pointsOf(sts, "C") != 0 || pointsOf(sts, "D") != 0 {
		t.Fatalf("fixture drift: %+v", sts)
	}
	want := map[string]int{"A": 1, "B": 1, "C": 3, "D": 3}
	for _, st := range sts {
		if st.Place != want[string(st.PlayerID)] {
			t.Fatalf("place of %s: got %d, want %d (%+v)", st.PlayerID, st.Place, want[string(st.PlayerID)], sts)
		}
	}
}
