package bracket

import (
	"fmt"
	"testing"
)

func pool4() []GameCapacity { return []GameCapacity{{Min: 4, Max: 4}} }

func firstRoundSlots(p Plan) []int {
	out := make([]int, 0, len(p.Rounds[0].Slots))
	for _, s := range p.Rounds[0].Slots {
		out = append(out, s.SeatCount)
	}
	return out
}

func TestEnumerateSingle8Pool4Flagship(t *testing.T) {
	res := Enumerate(8, pool4(), EliminationSingle, 0)
	if res.Truncated {
		t.Fatalf("flagship enumeration must not truncate")
	}
	if len(res.Plans) != 1 {
		var shapes []string
		for _, p := range res.Plans {
			shapes = append(shapes, describe(p))
		}
		t.Fatalf("expected exactly 1 plan for 8/{4}, got %d: %v", len(res.Plans), shapes)
	}
	p := res.Plans[0]
	if err := p.Validate(); err != nil {
		t.Fatalf("enumerated plan invalid: %v", err)
	}
	if len(p.Rounds) != 2 {
		t.Fatalf("expected 2 rounds, got %d", len(p.Rounds))
	}
	r1 := p.Rounds[0]
	if r1.Track != TrackWinners || r1.Index != 1 || r1.Promote != 2 || len(r1.Slots) != 2 ||
		r1.Slots[0].SeatCount != 4 || r1.Slots[1].SeatCount != 4 {
		t.Fatalf("round 1 shape wrong: %+v", r1)
	}
	for _, s := range r1.Slots {
		for _, seat := range s.Seats {
			if seat.Kind != SeatDraw {
				t.Fatalf("round 1 seats must be draw seats: %+v", seat)
			}
		}
	}
	final := p.Rounds[1]
	if final.Track != TrackFinal || final.Promote != 1 || len(final.Slots) != 1 || final.Slots[0].SeatCount != 4 {
		t.Fatalf("final round shape wrong: %+v", final)
	}
	want := []PlanSeat{srcSeat(0, 1), srcSeat(0, 2), srcSeat(1, 1), srcSeat(1, 2)}
	got := final.Slots[0].Seats
	for i := range want {
		if !sameSeat(got[i], want[i]) {
			t.Fatalf("final seats: got %+v, want %+v", got, want)
		}
	}
}

// sameSeat compares seats semantically (SourceSlot is a pointer, and 0 is a
// valid slot index the encoding must preserve).
func sameSeat(a, b PlanSeat) bool {
	if a.Kind != b.Kind || a.SourcePlace != b.SourcePlace {
		return false
	}
	if (a.SourceSlot == nil) != (b.SourceSlot == nil) {
		return false
	}
	return a.SourceSlot == nil || *a.SourceSlot == *b.SourceSlot
}

func describe(p Plan) string {
	out := ""
	for _, r := range p.Rounds {
		out += fmt.Sprintf("[%s%d p%d:", r.Track, r.Index, r.Promote)
		for i, s := range r.Slots {
			if i > 0 {
				out += ","
			}
			out += fmt.Sprint(s.SeatCount)
		}
		out += "]"
	}
	return out
}

func TestEnumerateSingle2Needs2SeatGame(t *testing.T) {
	if res := Enumerate(2, []GameCapacity{{Min: 3, Max: 3}}, EliminationSingle, 0); len(res.Plans) != 0 {
		t.Fatalf("2 players with a 3-seat-only pool must have no plans, got %d", len(res.Plans))
	}
	res := Enumerate(2, []GameCapacity{{Min: 2, Max: 3}}, EliminationSingle, 0)
	if len(res.Plans) != 1 {
		t.Fatalf("2 players with a 2-seat game must have exactly 1 plan, got %d", len(res.Plans))
	}
	p := res.Plans[0]
	if len(p.Rounds) != 1 || p.Rounds[0].Track != TrackFinal || p.Rounds[0].Slots[0].SeatCount != 2 {
		t.Fatalf("n=2 plan must be a single 2-seat grand final: %s", describe(p))
	}
}

func TestEnumerateMixedSeatSets(t *testing.T) {
	// ADR-26's mixed variants: n=8 pool {2,3} offers 3+3+2; n=11 pool {3,4}
	// offers 4+4+3.
	res := Enumerate(8, []GameCapacity{{Min: 2, Max: 2}, {Min: 3, Max: 3}}, EliminationSingle, 0)
	found332 := false
	for _, p := range res.Plans {
		if fmt.Sprint(firstRoundSlots(p)) == "[3 3 2]" {
			found332 = true
		}
	}
	if !found332 {
		var shapes []string
		for _, p := range res.Plans {
			shapes = append(shapes, describe(p))
		}
		t.Fatalf("8/{{2,3}} must offer the 3+3+2 first round, got: %v", shapes)
	}

	res = Enumerate(11, []GameCapacity{{Min: 3, Max: 3}, {Min: 4, Max: 4}}, EliminationSingle, 0)
	found443 := false
	for _, p := range res.Plans {
		if fmt.Sprint(firstRoundSlots(p)) == "[4 4 3]" {
			found443 = true
		}
	}
	if !found443 {
		var shapes []string
		for _, p := range res.Plans {
			shapes = append(shapes, describe(p))
		}
		t.Fatalf("11/{{3,4}} must offer the 4+4+3 first round, got: %v", shapes)
	}
}

func TestByesOnlyInRound1(t *testing.T) {
	// 5 players, 4-seat pool: 4 seated + 1 bye; the bye plays winners round 2
	// (here the grand final) without a table of their own in round 1.
	res := Enumerate(5, pool4(), EliminationSingle, 0)
	if len(res.Plans) == 0 {
		t.Fatalf("5/{{4}} must be feasible (4 + bye)")
	}
	for _, p := range res.Plans {
		for ri, r := range p.Rounds {
			for _, s := range r.Slots {
				for _, seat := range s.Seats {
					isRound1 := ri == 0
					if seat.Kind == SeatBye && isRound1 {
						t.Fatalf("bye seat in round 1: %s", describe(p))
					}
					if seat.Kind == SeatBye && !(r.Track == TrackWinners && r.Index == 2 || r.Track == TrackFinal) {
						t.Fatalf("bye seat outside winners round 2 / final: %s", describe(p))
					}
				}
			}
		}
		// The bye must appear exactly once, fed forward.
		byes := 0
		for _, r := range p.Rounds {
			for _, s := range r.Slots {
				for _, seat := range s.Seats {
					if seat.Kind == SeatBye {
						byes++
					}
				}
			}
		}
		if byes != 1 {
			t.Fatalf("exactly one bye seat expected, got %d: %s", byes, describe(p))
		}
	}
}

func TestPromoteBoundsUniform(t *testing.T) {
	pools := [][]GameCapacity{
		{{Min: 2, Max: 2}, {Min: 3, Max: 3}, {Min: 4, Max: 4}},
		{{Min: 3, Max: 4}},
	}
	for _, pool := range pools {
		for _, elim := range []string{EliminationSingle, EliminationDouble} {
			res := Enumerate(8, pool, elim, 0)
			if len(res.Plans) == 0 {
				t.Fatalf("8/%v/%s must be feasible", pool, elim)
			}
			for _, p := range res.Plans {
				if err := p.Validate(); err != nil {
					t.Fatalf("enumerated plan invalid: %v\n%s", err, describe(p))
				}
				for _, r := range p.Rounds {
					if r.Promote < 1 {
						t.Fatalf("promote < 1: %s", describe(p))
					}
					for _, s := range r.Slots {
						// Uniform per round + promote < every seat count.
						if r.Promote >= s.SeatCount {
							t.Fatalf("promote %d >= seat count %d: %s", r.Promote, s.SeatCount, describe(p))
						}
					}
				}
			}
		}
	}
}

func TestDouble8Pool2(t *testing.T) {
	res := Enumerate(8, []GameCapacity{{Min: 2, Max: 2}}, EliminationDouble, 0)
	if len(res.Plans) == 0 {
		t.Fatalf("8/{{2}} double must be feasible")
	}
	classicFound := false
	for _, p := range res.Plans {
		if err := p.Validate(); err != nil {
			t.Fatalf("enumerated plan invalid: %v\n%s", err, describe(p))
		}
		// The classic double-elim opening: winners round 1 seats everyone and
		// a losers track actually runs. (Paths that pause the LB forever and
		// merge everyone into the final are also valid — the branches are
		// explored — but they are not the classic shape.)
		if fs := firstRoundSlots(p); fmt.Sprint(fs) == "[2 2 2 2]" && p.Rounds[0].Track == TrackWinners {
			hasLosers := false
			for _, r := range p.Rounds {
				if r.Track == TrackLosers {
					hasLosers = true
				}
			}
			if hasLosers {
				classicFound = true
			}
		}
	}
	if !classicFound {
		var shapes []string
		for _, p := range res.Plans {
			shapes = append(shapes, describe(p))
		}
		t.Fatalf("no plan seats all 8 in winners round 1: %v", shapes)
	}
}

func TestDoubleMergeTakesLosersAndWinners(t *testing.T) {
	res := Enumerate(8, []GameCapacity{{Min: 2, Max: 2}}, EliminationDouble, 0)
	mergeFound := false
	for _, p := range res.Plans {
		// Flat slot index ranges: winners slots first, then losers, then final
		// (canonical round order).
		flat := 0
		wEnd, lEnd := -1, -1
		winnerSources, loserSources := 0, 0
		for _, r := range p.Rounds {
			if r.Track == TrackWinners {
				flat += len(r.Slots)
				continue
			}
			if r.Track == TrackLosers {
				if wEnd < 0 {
					wEnd = flat
				}
				flat += len(r.Slots)
				continue
			}
			// Final track: sources into earlier tracks prove the merge.
			if wEnd < 0 {
				wEnd = flat
			}
			lEnd = flat
			for _, s := range r.Slots {
				for _, seat := range s.Seats {
					if seat.Kind != SeatSource || seat.SourceSlot == nil {
						continue
					}
					switch {
					case *seat.SourceSlot < wEnd:
						winnerSources++
					case *seat.SourceSlot < lEnd:
						loserSources++
					}
				}
			}
			flat += len(r.Slots)
		}
		if wEnd >= 0 && lEnd > wEnd && winnerSources > 0 && loserSources > 0 {
			mergeFound = true
		}
	}
	if !mergeFound {
		t.Fatalf("no plan merges winners and losers survivors into the final track")
	}
}

func TestOrderingAndCap(t *testing.T) {
	res := Enumerate(8, []GameCapacity{{Min: 2, Max: 2}, {Min: 3, Max: 3}, {Min: 4, Max: 4}}, EliminationSingle, 3)
	if len(res.Plans) != 3 || !res.Truncated {
		t.Fatalf("cap=3 must truncate to 3 plans, got %d truncated=%v", len(res.Plans), res.Truncated)
	}
	if res.Cap != 3 {
		t.Fatalf("cap must echo back, got %d", res.Cap)
	}
	full := Enumerate(8, []GameCapacity{{Min: 2, Max: 2}, {Min: 3, Max: 3}, {Min: 4, Max: 4}}, EliminationSingle, DefaultPlanCap)
	if full.Truncated {
		t.Fatalf("8/{2,3,4} single must fit the default cap")
	}
	for i := 1; i < len(full.Plans); i++ {
		if planKeyLess(newPlanKey(full.Plans[i]), newPlanKey(full.Plans[i-1])) {
			t.Fatalf("plans not in documented order at %d:\n%s\n%s", i, describe(full.Plans[i-1]), describe(full.Plans[i]))
		}
	}
	// The truncation keeps the head of the order.
	for i := 0; i < len(res.Plans); i++ {
		if res.Plans[i].CanonicalJSON() != full.Plans[i].CanonicalJSON() {
			t.Fatalf("capped list must be the ordered head")
		}
	}
	if res := Enumerate(8, pool4(), EliminationSingle, 0); res.Cap != DefaultPlanCap {
		t.Fatalf("cap<=0 must default to %d, got %d", DefaultPlanCap, res.Cap)
	}
}

func TestEnumeratorDeterministic(t *testing.T) {
	run := func() []string {
		res := Enumerate(10, []GameCapacity{{Min: 2, Max: 2}, {Min: 3, Max: 3}}, EliminationDouble, 0)
		var out []string
		for _, p := range res.Plans {
			out = append(out, p.CanonicalJSON())
		}
		return out
	}
	a, b := run(), run()
	if len(a) != len(b) {
		t.Fatalf("nondeterministic plan count: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("nondeterministic plan %d", i)
		}
	}
}

func TestDouble2RematchFinal(t *testing.T) {
	// n=2 double: WB round of 2, the loser drops, merge seats both again —
	// the losers bracket is a second chance even at the smallest size.
	res := Enumerate(2, []GameCapacity{{Min: 2, Max: 2}}, EliminationDouble, 0)
	if len(res.Plans) != 1 {
		t.Fatalf("2/{{2}} double must have exactly 1 plan, got %d", len(res.Plans))
	}
	p := res.Plans[0]
	if len(p.Rounds) != 2 ||
		p.Rounds[0].Track != TrackWinners || p.Rounds[0].Slots[0].SeatCount != 2 ||
		p.Rounds[1].Track != TrackFinal || p.Rounds[1].Slots[0].SeatCount != 2 {
		t.Fatalf("unexpected 2-player double plan: %s", describe(p))
	}
	// The final seats the WB winner (place 1) and the dropped loser (place 2).
	zero := 0
	seats := p.Rounds[1].Slots[0].Seats
	if !sameSeat(seats[0], PlanSeat{Kind: SeatSource, SourceSlot: &zero, SourcePlace: 1}) ||
		!sameSeat(seats[1], PlanSeat{Kind: SeatSource, SourceSlot: &zero, SourcePlace: 2}) {
		t.Fatalf("final seats must be place 1 + place 2 of the WB round: %+v", seats)
	}
}
