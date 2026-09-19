package bracket

import (
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

func mustID(s string) id.ID { return id.ID(s) }

// match builds a MatchResult from a player→score map.
func match(mid string, scores map[string]float64) MatchResult {
	m := map[id.ID]float64{}
	for pid, sc := range scores {
		m[mustID(pid)] = sc
	}
	return MatchResult{MatchID: mustID(mid), Scores: m}
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

func TestPlacementPoints(t *testing.T) {
	cases := []struct {
		place, seats, want int
	}{
		{1, 4, 4}, {2, 4, 3}, {3, 4, 2}, {4, 4, 1},
		{1, 2, 2}, {2, 2, 1},
		{1, 3, 3}, {2, 3, 2}, {3, 3, 1},
	}
	for _, tc := range cases {
		if got := PlacementPoints(tc.place, tc.seats); got != tc.want {
			t.Errorf("PlacementPoints(%d, %d) = %d, want %d", tc.place, tc.seats, got, tc.want)
		}
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

// TestADRReplayExample is the ADR-26 slot-play example: a slot of 4 promoting
// 2. Match 1 ends with a shared top game score → 4–4–2–1, no strict cut, the
// slot replays. Match 2: 3–4–2–1 → cumulative 7–8–4–2 → strict top-2
// {B, A} → completed.
func TestADRReplayExample(t *testing.T) {
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})

	sts := Standings([]MatchResult{m1}, 4)
	if pointsOf(sts, "A") != 4 || pointsOf(sts, "B") != 4 || pointsOf(sts, "C") != 2 || pointsOf(sts, "D") != 1 {
		t.Fatalf("match 1 points: got %v", orderOf(sts))
	}
	if StrictCut(sts, 2) {
		t.Fatalf("4–4–2–1 must replay (the co-leaders tie)")
	}

	m2 := match("m2", map[string]float64{"B": 10, "A": 5, "C": 1, "D": 0})
	sts = Standings([]MatchResult{m1, m2}, 4)
	if pointsOf(sts, "B") != 8 || pointsOf(sts, "A") != 7 || pointsOf(sts, "C") != 4 || pointsOf(sts, "D") != 2 {
		t.Fatalf("cumulative points: got %+v", sts)
	}
	if !StrictCut(sts, 2) {
		t.Fatalf("7–8–4–2 must complete the slot")
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

func TestTieInsidePromotedSetBlocks(t *testing.T) {
	// 8–8–4–2 with promote 2: the cut against the rest is clean, but the two
	// leaders tie — the downstream order would be ambiguous, so the slot stays
	// open.
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})
	m2 := match("m2", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 0})
	sts := Standings([]MatchResult{m1, m2}, 4)
	if StrictCut(sts, 2) {
		t.Fatalf("8–8–4–2 must not complete a promote-2 slot")
	}
}

func TestTieAtCutBoundaryBlocks(t *testing.T) {
	// Cumulative 6–6–6–6 with promote 2: places 2 and 3 share points at the
	// cut — the top-2 set is not strictly separated from the rest.
	m1 := match("m1", map[string]float64{"A": 10, "B": 10, "C": 1, "D": 1})
	m2 := match("m2", map[string]float64{"C": 10, "D": 10, "A": 1, "B": 1})
	sts := Standings([]MatchResult{m1, m2}, 4)
	if pointsOf(sts, "A") != 6 || pointsOf(sts, "B") != 6 || pointsOf(sts, "C") != 6 || pointsOf(sts, "D") != 6 {
		t.Fatalf("fixture drift: %+v", sts)
	}
	if StrictCut(sts, 2) {
		t.Fatalf("6–6–6–6 must not complete: the cut boundary ties")
	}
}

func TestLateOverturn(t *testing.T) {
	// A leads after match 1; match 2 flips the order — every match counts,
	// nothing is discarded. With one win apiece the points tie (3–3): the
	// 2-seat slot replays; B taking match 3 completes it 5–4.
	m1 := match("m1", map[string]float64{"A": 10, "B": 2})
	m2 := match("m2", map[string]float64{"B": 10, "A": 2})
	m3 := match("m3", map[string]float64{"B": 10, "A": 2})

	sts := Standings([]MatchResult{m1}, 2)
	if sts[0].PlayerID != mustID("A") {
		t.Fatalf("match 1 leader: %+v", sts)
	}
	sts = Standings([]MatchResult{m1, m2}, 2)
	if StrictCut(sts, 1) {
		t.Fatalf("3–3 in a 2-seat slot must replay")
	}
	if sts[0].PlayerID != mustID("B") {
		t.Fatalf("tie-break must prefer the recent winner: %+v", sts)
	}
	sts = Standings([]MatchResult{m1, m2, m3}, 2)
	if !StrictCut(sts, 1) || sts[0].PlayerID != mustID("B") || pointsOf(sts, "B") != 5 || pointsOf(sts, "A") != 4 {
		t.Fatalf("2–1 series must complete for B: %+v", sts)
	}
}

func TestStandingsTieBreakPrefersRecentMatch(t *testing.T) {
	// Equal cumulative points: the player who placed better most recently
	// ranks higher (the display tie-break; completion needs strict points).
	m1 := match("m1", map[string]float64{"A": 10, "B": 2})
	m2 := match("m2", map[string]float64{"B": 10, "A": 2})
	sts := Standings([]MatchResult{m1, m2}, 2)
	// Both have 2 points; B won the most recent match.
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
	if pointsOf(sts, "A") != 4 || pointsOf(sts, "B") != 4 || pointsOf(sts, "C") != 2 || pointsOf(sts, "D") != 1 {
		t.Fatalf("fixture drift: %+v", sts)
	}
	want := map[string]int{"A": 1, "B": 1, "C": 3, "D": 4}
	for _, st := range sts {
		if st.Place != want[string(st.PlayerID)] {
			t.Fatalf("place of %s: got %d, want %d (%+v)", st.PlayerID, st.Place, want[string(st.PlayerID)], sts)
		}
	}
}
