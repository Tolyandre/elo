package bracket

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
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
	if len(res.Plans) == 0 {
		t.Fatalf("8/{{4}} single must be feasible")
	}
	// The flagship plan (fewest rounds) heads the documented order; longer
	// bye-grinding shapes follow.
	p := res.Plans[0]
	if err := p.Validate(); err != nil {
		t.Fatalf("enumerated plan invalid: %v", err)
	}
	if len(p.Rounds) != 2 {
		t.Fatalf("flagship must have 2 rounds, got %d: %s", len(p.Rounds), describe(p))
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

func TestByesInWinnersRounds(t *testing.T) {
	// 5 players, 4-seat pool: 4 seated + 1 bye; the bye plays winners round 2
	// (here the grand final) without a table of their own in round 1.
	res := Enumerate(5, pool4(), EliminationSingle, 0)
	if len(res.Plans) == 0 {
		t.Fatalf("5/{{4}} must be feasible (4 + bye)")
	}
	for _, p := range res.Plans {
		if err := p.Validate(); err != nil {
			t.Fatalf("enumerated plan invalid: %v\n%s", err, describe(p))
		}
		for ri, r := range p.Rounds {
			for _, s := range r.Slots {
				for _, seat := range s.Seats {
					if seat.Kind != SeatBye {
						continue
					}
					// Bye seats feed forward into later winners rounds or
					// the grand final; round 1 seats the draw and the
					// losers track seats everyone exactly.
					if ri == 0 || r.Track == TrackLosers {
						t.Fatalf("bye seat in round 1 / losers track: %s", describe(p))
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

// TestStrictPool18Feasible pins the case that motivated winners-round byes:
// 18 players with a strictly 4-seat game must offer single- and double-
// elimination plans (round 1 seats 4×4 + 2 byes; the byes keep waiting until
// the survivors seat exactly again).
func TestStrictPool18Feasible(t *testing.T) {
	for _, elim := range []string{EliminationSingle, EliminationDouble} {
		res := Enumerate(18, pool4(), elim, 0)
		if len(res.Plans) == 0 {
			t.Fatalf("18/{{4}} %s must be feasible", elim)
		}
		if err := res.Plans[0].Validate(); err != nil {
			t.Fatalf("enumerated plan invalid: %v\n%s", err, describe(res.Plans[0]))
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
		// a losers track actually runs. (A path that never runs the LB cannot
		// merge — unplayed WB drops may not skip into the final — so every
		// offered plan plays the losers track.)
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
	// the lone drop is the LB winner by waiting (no LB round can exist).
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

// doubleElimPools are the cases the traditional-shape properties run over.
func doubleElimPools() []struct {
	n    int
	pool []GameCapacity
} {
	return []struct {
		n    int
		pool []GameCapacity
	}{
		{8, []GameCapacity{{Min: 2, Max: 2}}},
		{8, []GameCapacity{{Min: 4, Max: 4}}},
		{8, []GameCapacity{{Min: 3, Max: 4}}},
		{12, []GameCapacity{{Min: 2, Max: 2}, {Min: 3, Max: 3}}},
		{5, []GameCapacity{{Min: 3, Max: 4}}},
		{18, []GameCapacity{{Min: 4, Max: 4}}},
	}
}

// TestDoubleTraditionalFlow pins the traditional double-elimination flow of
// ADR-26 on every enumerated plan: a WB drop (a place beyond the source
// slot's promote) can reach the grand final only through the losers track —
// the final seats WB finalists (places within the source slot's promote) and
// LB winners. The lone exception is a plan without losers rounds at all,
// where a single WB drop is the LB winner by waiting (no LB round can exist;
// the n=2/n=3 rematch shapes).
func TestDoubleTraditionalFlow(t *testing.T) {
	for _, tc := range doubleElimPools() {
		res := Enumerate(tc.n, tc.pool, EliminationDouble, 0)
		if len(res.Plans) == 0 {
			t.Fatalf("%d/%v double must be feasible", tc.n, tc.pool)
		}
		for _, p := range res.Plans {
			if err := p.Validate(); err != nil {
				t.Fatalf("enumerated plan invalid: %v\n%s", err, describe(p))
			}
			// Flat slot index → (track, promote).
			trackOf := map[int]string{}
			promoteOf := map[int]int{}
			flat := 0
			hasLosers := false
			finalRounds := 0
			for _, r := range p.Rounds {
				if r.Track == TrackLosers {
					hasLosers = true
				}
				if r.Track == TrackFinal {
					finalRounds++
				}
				for range r.Slots {
					trackOf[flat] = r.Track
					promoteOf[flat] = r.Promote
					flat++
				}
			}
			// The grand final is one round — deeper final tracks are not
			// offered.
			if finalRounds != 1 {
				t.Fatalf("%d/%v: %d final rounds: %s", tc.n, tc.pool, finalRounds, describe(p))
			}
			lbIntoFinal := false
			for _, r := range p.Rounds {
				if r.Track != TrackFinal {
					continue
				}
				for _, s := range r.Slots {
					for _, seat := range s.Seats {
						if seat.Kind != SeatSource || seat.SourceSlot == nil {
							continue
						}
						switch trackOf[*seat.SourceSlot] {
						case TrackLosers:
							lbIntoFinal = true
						case TrackWinners:
							// WB finalists only; a dropped place in the
							// final means the player skipped the LB.
							if seat.SourcePlace > promoteOf[*seat.SourceSlot] && hasLosers {
								t.Fatalf("%d/%v: WB drop %d of slot %d skips the losers track into the final: %s",
									tc.n, tc.pool, seat.SourcePlace, *seat.SourceSlot, describe(p))
							}
						}
					}
				}
			}
			// The grand final is WB finalists vs the LB winner set: when the
			// losers track ran, at least one of its winners must be in it.
			if hasLosers && !lbIntoFinal {
				t.Fatalf("%d/%v: losers track ran but no LB winner reached the final: %s",
					tc.n, tc.pool, describe(p))
			}
		}
	}
}

// TestDouble8Pool2ClassicGrandFinal pins the classic 8-player shape on a
// 2-seat pool: the grand final is one WB finalist vs one LB winner, both
// place-1 of their tracks' last rounds.
func TestDouble8Pool2ClassicGrandFinal(t *testing.T) {
	res := Enumerate(8, []GameCapacity{{Min: 2, Max: 2}}, EliminationDouble, 0)
	if len(res.Plans) == 0 {
		t.Fatalf("8/{{2}} double must be feasible")
	}
	classic := false
	for _, p := range res.Plans {
		final := p.Rounds[len(p.Rounds)-1]
		if len(final.Slots) != 1 || final.Slots[0].SeatCount != 2 {
			continue
		}
		trackOf := map[int]string{}
		flat := 0
		for _, r := range p.Rounds {
			for range r.Slots {
				trackOf[flat] = r.Track
				flat++
			}
		}
		sawW, sawL := false, false
		for _, seat := range final.Slots[0].Seats {
			if seat.Kind != SeatSource || seat.SourceSlot == nil || seat.SourcePlace != 1 {
				sawW, sawL = false, false
				break
			}
			switch trackOf[*seat.SourceSlot] {
			case TrackWinners:
				sawW = true
			case TrackLosers:
				sawL = true
			}
		}
		if sawW && sawL {
			classic = true
		}
	}
	if !classic {
		var shapes []string
		for _, p := range res.Plans {
			shapes = append(shapes, describe(p))
		}
		t.Fatalf("no 8/{{2}} plan ends WB place-1 vs LB place-1: %v", shapes)
	}
}

// TestZeroPlanResponseHasNoNulls pins the API contract on empty results: a
// zero-plan exploration (or a sanity-bound early return) must marshal plans
// and every facet as [] — nil Go slices would come out as null and break
// clients reading .length.
func TestZeroPlanResponseHasNoNulls(t *testing.T) {
	// 2 players with a 3-seat-only pool: no plan can seat the grand final.
	res := Enumerate(2, []GameCapacity{{Min: 3, Max: 3}}, EliminationSingle, 0)
	if len(res.Plans) != 0 {
		t.Fatalf("2/{{3}} single must have no plans, got %d", len(res.Plans))
	}
	for name, raw := range map[string][]byte{
		"zero plans": marshalResult(t, res),
		"n=1 bound":  marshalResult(t, Enumerate(1, pool4(), EliminationSingle, 0)),
		"empty pool": marshalResult(t, Enumerate(8, nil, EliminationSingle, 0)),
	} {
		if strings.Contains(string(raw), "null") {
			t.Fatalf("%s: response must not contain nulls: %s", name, raw)
		}
	}
}

func marshalResult(t *testing.T, r Result) []byte {
	t.Helper()
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestOffersPlanBeyondUnfilteredHead reproduces the start-action bug: the
// shape picker's cap applies after the display filters, so an organizer can
// pick a plan whose unfiltered rank is beyond any capped rescan. OffersPlan
// must accept every genuinely enumerated plan (and still reject hand-forged
// ones).
func TestOffersPlanBeyondUnfilteredHead(t *testing.T) {
	pool34 := []GameCapacity{{Min: 3, Max: 3}, {Min: 4, Max: 4}}
	// The plan at documented rank 250: beyond the list cap of 200, and
	// exactly the depth a filtered view (cap applied after the filters)
	// surfaces when earlier-ranked plans are filtered away.
	const rank = DefaultPlanCap + 50
	deep := Enumerate(18, pool34, EliminationDouble, rank).Plans[rank-1]
	head := Enumerate(18, pool34, EliminationDouble, DefaultPlanCap)
	for _, p := range head.Plans {
		if p.CanonicalJSON() == deep.CanonicalJSON() {
			t.Fatalf("expected the picked plan beyond the unfiltered head of %d", DefaultPlanCap)
		}
	}
	if !OffersPlan(18, pool34, EliminationDouble, deep) {
		t.Fatalf("a genuinely enumerated plan must be offered:\n%s", describe(deep))
	}

	forged := deep
	forged.Rounds[0].Slots[0].SeatCount = 5 // no 5-seat game in the pool
	if OffersPlan(18, pool34, EliminationDouble, forged) {
		t.Fatalf("a hand-forged shape must be rejected")
	}
	if OffersPlan(18, pool34, EliminationSingle, deep) {
		t.Fatalf("a plan of the other family must be rejected")
	}
	if OffersPlan(1, pool34, EliminationDouble, deep) {
		t.Fatalf("a nonsense participant count must be rejected")
	}

	// Sanity: the documented shapes stay offerable.
	if !OffersPlan(8, pool4(), EliminationSingle, Enumerate(8, pool4(), EliminationSingle, 1).Plans[0]) {
		t.Fatalf("the 8/{{4}} single flagship must be offered")
	}
	if !OffersPlan(2, []GameCapacity{{Min: 2, Max: 2}}, EliminationDouble,
		Enumerate(2, []GameCapacity{{Min: 2, Max: 2}}, EliminationDouble, 1).Plans[0]) {
		t.Fatalf("the n=2 rematch plan must be offered")
	}
}

func TestEnumerateFilteredChips(t *testing.T) {
	pool := []GameCapacity{{Min: 2, Max: 2}, {Min: 3, Max: 3}}

	// No family filter: plans of both families interleave, facets cover both.
	both := EnumerateFiltered(8, pool, PlanFilter{}, DefaultPlanCap)
	sawSingle, sawDouble := false, false
	for _, p := range both.Plans {
		switch p.Elimination {
		case EliminationSingle:
			sawSingle = true
		case EliminationDouble:
			sawDouble = true
		}
	}
	if !sawSingle || !sawDouble {
		t.Fatalf("unfiltered enumeration must offer both families")
	}
	if got := both.Facets.Eliminations; len(got) != 2 || got[0] != EliminationDouble || got[1] != EliminationSingle {
		t.Fatalf("facets eliminations: %v", got)
	}
	// Round 1 may seat n−1 and leave the remainder as a bye, so both
	// bye-carrying and exact plans exist here.
	if !both.Facets.HasByes || both.Facets.AllByes {
		t.Fatalf("facets byes: has=%v all=%v", both.Facets.HasByes, both.Facets.AllByes)
	}
	if !slices.Contains(both.Facets.FirstShapes, "3+3+2") || !slices.Contains(both.Facets.FirstShapes, "2+2+2+2") {
		t.Fatalf("facets first shapes: %v", both.Facets.FirstShapes)
	}

	// Family filter: only that family's plans, and the cap counts within it.
	dbl := EnumerateFiltered(8, pool, PlanFilter{Eliminations: []string{EliminationDouble}}, 2)
	if len(dbl.Plans) == 0 || len(dbl.Plans) > 2 {
		t.Fatalf("family-filtered cap must bound the list, got %d", len(dbl.Plans))
	}
	for _, p := range dbl.Plans {
		if p.Elimination != EliminationDouble {
			t.Fatalf("family filter leaked a %s plan", p.Elimination)
		}
	}
	if got := dbl.Facets.Eliminations; len(got) != 1 || got[0] != EliminationDouble {
		t.Fatalf("facets must follow the explored families: %v", got)
	}

	// Round-count filter: plans match, facets still describe the full space.
	r2 := EnumerateFiltered(8, pool, PlanFilter{RoundCounts: []int{2}}, 0)
	if len(r2.Plans) == 0 {
		t.Fatalf("2-round plans must exist for 8/{2,3}")
	}
	for _, p := range r2.Plans {
		if len(p.Rounds) != 2 {
			t.Fatalf("round-count filter leaked: %s", describe(p))
		}
	}
	if !slices.Contains(r2.Facets.RoundCounts, 3) {
		t.Fatalf("facets must ignore the display filters: %v", r2.Facets.RoundCounts)
	}

	// First-shape filter keeps only matching first rounds.
	sh := EnumerateFiltered(8, pool, PlanFilter{FirstShapes: []string{"3+3+2"}}, 0)
	if len(sh.Plans) == 0 {
		t.Fatalf("3+3+2 first-round plans must exist")
	}
	for _, p := range sh.Plans {
		if FirstShapeOf(p) != "3+3+2" {
			t.Fatalf("shape filter leaked %s", FirstShapeOf(p))
		}
	}

	// Byes filter: n=5 on a {3,4} pool cannot seat exactly — every plan
	// carries byes, so "without" must empty the list while facets stay.
	byes := EnumerateFiltered(5, []GameCapacity{{Min: 3, Max: 3}, {Min: 4, Max: 4}}, PlanFilter{Byes: ByesWithout}, 0)
	if len(byes.Plans) != 0 {
		t.Fatalf("without-byes must have no plans for 5/{{3,4}}")
	}
	if !byes.Facets.HasByes || !byes.Facets.AllByes {
		t.Fatalf("facets must ignore the display filters: %+v", byes.Facets)
	}
	with := EnumerateFiltered(5, []GameCapacity{{Min: 3, Max: 3}, {Min: 4, Max: 4}}, PlanFilter{Byes: ByesWith}, 0)
	if len(with.Plans) == 0 {
		t.Fatalf("5/{{3,4}} must be feasible with byes")
	}
	for _, p := range with.Plans {
		if !planHasByes(p) {
			t.Fatalf("byes filter leaked a plan without byes")
		}
	}
}
