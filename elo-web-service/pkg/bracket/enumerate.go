package bracket

import (
	"fmt"
	"math/bits"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// GameCapacity is one pool game's table capacity: the seat sizes it can host.
type GameCapacity struct {
	Min int
	Max int
}

// Result is the plan list for one (participant count, pool, filter) triple —
// a pure function, nothing is stored per plan (ADR-26). Truncated reports
// that the cap (or the exploration budget) cut the list short; the returned
// plans are still the documented-order head: the enumeration runs tier by
// tier over the total round count, so every plan with fewer rounds than the
// last returned tier is guaranteed to be in the list.
type Result struct {
	Plans     []Plan `json:"plans"`
	Truncated bool   `json:"truncated"`
	Cap       int    `json:"cap"`
	// Facets is the option space of the explored families, ignoring every
	// non-family filter — the shape picker's chip options.
	Facets Facets `json:"facets"`
}

// Byes filter values (PlanFilter.Byes).
const (
	ByesAny     = ""
	ByesWith    = "with"
	ByesWithout = "without"
)

// PlanFilter narrows the enumeration to the organizer's current chip
// selection (ADR-26 bracket-plans). Eliminations selects the families to
// explore (empty = both); the rest are display filters applied to the plans.
// The cap applies to the filtered list, so a family chip can never hide
// behind the other family's plans.
type PlanFilter struct {
	Eliminations []string
	RoundCounts  []int
	Byes         string
	FirstShapes  []string // canonical "4+4" strings, see FirstShapeOf
}

// matches reports whether a plan satisfies the display filters (the family
// selection is handled by the exploration itself).
func (f PlanFilter) matches(p Plan) bool {
	if len(f.RoundCounts) > 0 && !slices.Contains(f.RoundCounts, len(p.Rounds)) {
		return false
	}
	byes := planHasByes(p)
	switch f.Byes {
	case ByesWith:
		if !byes {
			return false
		}
	case ByesWithout:
		if byes {
			return false
		}
	}
	if len(f.FirstShapes) > 0 && !slices.Contains(f.FirstShapes, FirstShapeOf(p)) {
		return false
	}
	return true
}

// Facets describes the plans the requested families produce: which families
// yielded plans, their round counts, whether byes occur (all/none), and the
// first-round table shapes. Computed over every enumerated plan of the
// explored families regardless of the display filters and the cap, so chips
// never lose options because another chip is active.
type Facets struct {
	Eliminations []string `json:"eliminations"`
	RoundCounts  []int    `json:"round_counts"`
	HasByes      bool     `json:"has_byes"`
	AllByes      bool     `json:"all_byes"`
	FirstShapes  []string `json:"first_shapes"`
}

// planHasByes reports whether any seat of the plan is a bye.
func planHasByes(p Plan) bool {
	for _, r := range p.Rounds {
		for _, s := range r.Slots {
			for _, seat := range s.Seats {
				if seat.Kind == SeatBye {
					return true
				}
			}
		}
	}
	return false
}

// FirstShapeOf renders a plan's first round as its canonical slot multiset,
// e.g. "4+4" — the same string the shape picker's first-round chips display.
func FirstShapeOf(p Plan) string {
	if len(p.Rounds) == 0 {
		return ""
	}
	parts := make([]string, 0, len(p.Rounds[0].Slots))
	for _, s := range p.Rounds[0].Slots {
		parts = append(parts, strconv.Itoa(s.SeatCount))
	}
	return strings.Join(parts, "+")
}

// facetAccum accumulates facet data over every materialized (deduplicated)
// plan of the explored families.
type facetAccum struct {
	fams     map[string]bool
	rounds   map[int]bool
	shapes   map[string]bool
	withByes int
	total    int
}

func newFacetAccum() *facetAccum {
	return &facetAccum{
		fams:   map[string]bool{},
		rounds: map[int]bool{},
		shapes: map[string]bool{},
	}
}

func (a *facetAccum) record(p Plan) {
	a.fams[p.Elimination] = true
	a.rounds[len(p.Rounds)] = true
	a.shapes[FirstShapeOf(p)] = true
	if planHasByes(p) {
		a.withByes++
	}
	a.total++
}

func (a *facetAccum) result() Facets {
	out := Facets{}
	for fam := range a.fams {
		out.Eliminations = append(out.Eliminations, fam)
	}
	sort.Strings(out.Eliminations)
	for n := range a.rounds {
		out.RoundCounts = append(out.RoundCounts, n)
	}
	sort.Ints(out.RoundCounts)
	for s := range a.shapes {
		out.FirstShapes = append(out.FirstShapes, s)
	}
	sort.Strings(out.FirstShapes)
	out.HasByes = a.withByes > 0
	out.AllByes = a.total > 0 && a.withByes == a.total
	return out
}

const (
	// DefaultPlanCap bounds the response for pathological explosions (wide
	// pools, large n); the cap is part of the response.
	DefaultPlanCap = 200
	// dfsBudget bounds the state exploration across all depth tiers. Hitting
	// it marks the result truncated instead of running unbounded on
	// adversarial inputs.
	dfsBudget = 1000000
	// maxParticipants is a sanity bound on the enumeration input.
	maxParticipants = 512
)

var trackRank = map[string]int{TrackWinners: 0, TrackLosers: 1, TrackFinal: 2}

// Enumerate returns the valid bracket plans for one elimination family,
// ordered deterministically: fewer rounds first, then fewer tables, then
// larger slots, then canonical JSON. The search is iterative deepening over
// the total round count, so the response head is exact even when truncated.
func Enumerate(participants int, pool []GameCapacity, elimination string, cap int) Result {
	return EnumerateFiltered(participants, pool, PlanFilter{Eliminations: []string{elimination}}, cap)
}

// EnumerateFiltered is Enumerate over the families the filter selects (empty
// = both) with the display filters applied before the cap: the response is
// the first `cap` plans of the current condition. Facets are computed over
// every plan of those families regardless of the display filters.
func EnumerateFiltered(participants int, pool []GameCapacity, filter PlanFilter, cap int) Result {
	if cap <= 0 {
		cap = DefaultPlanCap
	}
	res := Result{Cap: cap}
	if participants < 2 || participants > maxParticipants {
		return res
	}
	e := &enumerator{
		sizes:  seatSizes(pool),
		filter: filter,
		facets: newFacetAccum(),
		seen:   map[string]struct{}{},
		msMemo: map[int][][]int{},
	}
	if len(e.sizes) == 0 {
		return res
	}

	families := filter.Eliminations
	if len(families) == 0 {
		families = []string{EliminationSingle, EliminationDouble}
	}

	start := drawRefs(participants)
	// Each round strictly shrinks at least one track, so a path never needs
	// more than 2·n rounds (WB rounds move players to the LB without
	// eliminating; every LB/final round eliminates someone).
	maxBound := 2*participants + 2
	if maxBound > maxRounds {
		maxBound = maxRounds
	}
	for bound := 1; bound <= maxBound; bound++ {
		e.depthPruned = false
		for _, family := range families {
			switch family {
			case EliminationSingle:
				e.singleDFS(start, nil, 1, bound)
			case EliminationDouble:
				e.doubleDFS(start, nil, nil, 1, 1, bound)
			}
		}
		if e.truncated || len(e.plans) > cap {
			break // budget exhausted, or the tier filled the cap
		}
		if !e.depthPruned {
			break // the tier explored the whole tree — enumeration complete
		}
	}

	// Deterministic response order with precomputed keys — the canonical
	// JSON is serialized once per plan, not once per comparison.
	keys := make([]planKey, len(e.plans))
	for i, p := range e.plans {
		keys[i] = newPlanKey(p)
	}
	sort.Slice(keys, func(i, j int) bool { return planKeyLess(keys[i], keys[j]) })
	truncated := e.truncated || len(keys) > cap
	if len(keys) > cap {
		keys = keys[:cap]
	}
	res.Truncated = truncated
	res.Facets = e.facets.result()
	res.Plans = make([]Plan, len(keys))
	for i, k := range keys {
		res.Plans[i] = k.p
	}
	return res
}

// planKey carries the sort keys of a plan with the canonical form computed
// once.
type planKey struct {
	p      Plan
	canon  string
	rounds int
	slots  int
	seats  []int
}

func newPlanKey(p Plan) planKey {
	k := planKey{p: p, canon: p.CanonicalJSON(), rounds: len(p.Rounds), seats: seatVector(p)}
	for _, r := range p.Rounds {
		k.slots += len(r.Slots)
	}
	return k
}

// planKeyLess is the documented response order: fewer rounds, then fewer
// tables, then larger slots, then canonical JSON.
func planKeyLess(a, b planKey) bool {
	if a.rounds != b.rounds {
		return a.rounds < b.rounds
	}
	if a.slots != b.slots {
		return a.slots < b.slots
	}
	for i := 0; i < len(a.seats) && i < len(b.seats); i++ {
		if a.seats[i] != b.seats[i] {
			return a.seats[i] > b.seats[i] // larger slots first
		}
	}
	return a.canon < b.canon
}

// seatSizes returns the sorted unique table sizes the pool can seat.
func seatSizes(pool []GameCapacity) []int {
	seen := map[int]bool{}
	for _, g := range pool {
		for k := g.Min; k <= g.Max; k++ {
			if k >= 2 {
				seen[k] = true
			}
		}
	}
	out := make([]int, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}

// enumerator carries one EnumerateFiltered run. Plans are built from
// per-path round lists (seat provenance as seatRef into earlier rounds),
// materialized and deduplicated by canonical JSON at the champion; facets
// are recorded for every deduplicated plan, the filter decides what lands in
// the result.
type enumerator struct {
	sizes       []int
	filter      PlanFilter
	facets      *facetAccum
	seen        map[string]struct{}
	plans       []Plan
	nodes       int
	truncated   bool
	depthPruned bool            // some state wanted another round at the current bound
	msMemo      map[int][][]int // candidate slot sets per (n, allowRemainder)
}

// seatRef is a seat's provenance while the plan is being built: draw/bye
// seats are filled at start from the seeded draw, source seats from a place
// of an earlier round (identified per-path by rid; rewritten to flat plan
// slot indices at emit).
type seatRef struct {
	kind string
	rid  int // builtRound.rid the source points to
	pos  int // slot position within that round
	// place is set for source refs: the 1-based place in the source slot.
	// Places ≤ promote are promotions; places > promote are the drops the
	// losers bracket seats.
	place int
	// lbSurvivor marks a player who has won at least one losers-track round.
	// Only such players — or a lone player who could never be seated in an
	// LB round at all — may pass from the LB into the grand final; see
	// lbResolved.
	lbSurvivor bool
}

// lbResolved reports whether the losers pool is its final winner set — the
// traditional double-elimination precondition for the grand final. Every
// member must have won at least one LB round, so an unplayed WB drop never
// skips the losers bracket straight into the final; a pool of one is always
// resolved (its single member is the LB winner by waiting — the n=2 rematch
// case, where no LB round can exist). While the pool could still seat an LB
// round the merge is not offered at all, so a resolved pool here is also a
// finished one.
func lbResolved(lpool []seatRef) bool {
	if len(lpool) <= 1 {
		return true
	}
	for _, ref := range lpool {
		if !ref.lbSurvivor {
			return false
		}
	}
	return true
}

// builtRound is one round under construction. sizes/seats are slot-ordered
// (canonical: seat counts descending).
type builtRound struct {
	rid     int
	track   string
	index   int
	promote int
	sizes   []int
	seats   [][]seatRef
}

func drawRefs(n int) []seatRef {
	refs := make([]seatRef, n)
	for i := range refs {
		refs[i] = seatRef{kind: SeatDraw}
	}
	return refs
}

// appendRound copies the per-path round list — branches must not share
// backing arrays.
func appendRound(rounds []builtRound, r builtRound) []builtRound {
	out := make([]builtRound, len(rounds)+1)
	copy(out, rounds)
	out[len(rounds)] = r
	return out
}

func (e *enumerator) overBudget() bool {
	e.nodes++
	if e.nodes > dfsBudget {
		e.truncated = true
	}
	return e.truncated
}

// minRoundsNeeded is a lower bound on the rounds still required to seat t
// players down to one: no round can do better than halving the field (a
// 2-seat slot promoting exactly 1). Branches whose horizon cannot possibly
// reach a champion are cut immediately instead of explored.
func minRoundsNeeded(t int) int {
	if t <= 1 {
		return 0
	}
	return bits.Len(uint(t - 1)) // ceil(log2(t))
}

// multisetsFor returns the candidate slot sets for n players: every multiset
// of pool sizes seating exactly n, or — with allowRemainder (round 1 only) —
// seating n−r with r < smallest size as the bye remainder. At least one slot
// per round (a bye-only "round" never shrinks the field). Deterministic
// order, memoized per (n, allowRemainder).
func (e *enumerator) multisetsFor(n int, allowRemainder bool) [][]int {
	key := n * 2
	if allowRemainder {
		key++
	}
	if cached, ok := e.msMemo[key]; ok {
		return cached
	}
	var out [][]int
	var cur []int
	var rec func(i, remaining int)
	rec = func(i, remaining int) {
		if i == len(e.sizes) {
			if len(cur) == 0 {
				return
			}
			if remaining == 0 || (allowRemainder && remaining < e.sizes[0]) {
				m := make([]int, len(cur))
				copy(m, cur)
				sort.Sort(sort.Reverse(sort.IntSlice(m)))
				out = append(out, m)
			}
			return
		}
		for c := 0; c <= remaining/e.sizes[i]; c++ {
			for j := 0; j < c; j++ {
				cur = append(cur, e.sizes[i])
			}
			rec(i+1, remaining-c*e.sizes[i])
			cur = cur[:len(cur)-c]
		}
	}
	rec(0, n)
	sort.Slice(out, func(a, b int) bool { return lessInts(out[a], out[b]) })
	e.msMemo[key] = out
	return out
}

func lessInts(a, b []int) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return len(a) < len(b)
}

// buildRound seats pool refs into the candidate slot set ms (slot-ordered)
// with uniform promotion count p. Slots fill positionally from the pool in
// canonical order (round-1 remainder becomes bye refs). Returns the round
// (track/index set by the caller), the promoted pool (refs into this round;
// byes appended), and the drop pool (places > promote).
func buildRound(rid int, pool []seatRef, ms []int, p int) (builtRound, []seatRef, []seatRef) {
	r := builtRound{
		rid:     rid,
		promote: p,
		sizes:   append([]int(nil), ms...),
		seats:   make([][]seatRef, len(ms)),
	}
	next := make([]seatRef, 0, p*len(ms)+len(pool))
	drops := make([]seatRef, 0, len(pool))
	off := 0
	for i, k := range ms {
		r.seats[i] = pool[off : off+k]
		off += k
		for place := 1; place <= p; place++ {
			next = append(next, seatRef{kind: SeatSource, rid: rid, pos: i, place: place})
		}
		for place := p + 1; place <= k; place++ {
			drops = append(drops, seatRef{kind: SeatSource, rid: rid, pos: i, place: place})
		}
	}
	for range pool[off:] { // round-1 remainder
		next = append(next, seatRef{kind: SeatBye})
	}
	return r, next, drops
}

// singleDFS plays winners-track rounds (no losers bracket) down to one
// player; the round that produces the champion is the grand final.
func (e *enumerator) singleDFS(pool []seatRef, rounds []builtRound, wIdx, depthLeft int) {
	if e.overBudget() {
		return
	}
	if n := len(pool); n >= 2 && depthLeft < minRoundsNeeded(n) {
		if len(e.multisetsFor(n, wIdx == 1)) > 0 {
			e.depthPruned = true
		}
		return
	}
	rid := len(rounds)
	for _, ms := range e.multisetsFor(len(pool), wIdx == 1) {
		for p := 1; p < ms[len(ms)-1]; p++ {
			round, next, _ := buildRound(rid, pool, ms, p)
			if len(next) == 1 {
				round.track, round.index = TrackFinal, 1
				e.emit(appendRound(rounds, round), EliminationSingle)
				continue
			}
			round.track, round.index = TrackWinners, wIdx
			e.singleDFS(next, appendRound(rounds, round), wIdx+1, depthLeft-1)
		}
	}
}

// doubleDFS explores the (winners, losers) state space: run a winners round
// (round 1 may carry byes), run a losers round when the LB pool seats exactly
// (LB non-promoted players are out), or — once both tracks are exhausted —
// merge into the final track. The merge is the traditional grand final: the
// WB must be finished (its survivors can no longer seat a round alone) and
// the LB must be down to its winner set (lbResolved) — a WB drop that the LB
// could never seat dead-ends the branch instead of skipping into the final.
// Both "run LB now" and "run WB next" branches are explored (ADR-26).
func (e *enumerator) doubleDFS(wpool, lpool []seatRef, rounds []builtRound, wIdx, lIdx, depthLeft int) {
	if e.overBudget() {
		return
	}
	nw, nl := len(wpool), len(lpool)
	wSeatable := canSeat(nw, e.sizes)
	total := nw + nl

	// Every continuation (a WB round, an LB round, or a merge followed by
	// final rounds) needs at least ceil(log2(total)) more rounds; beyond that
	// horizon the branch cannot terminate within the bound.
	if total >= 2 && depthLeft < minRoundsNeeded(total) {
		switch {
		case (wSeatable || wIdx == 1) && len(e.multisetsFor(nw, wIdx == 1)) > 0:
			e.depthPruned = true
		case nl >= 2 && canSeat(nl, e.sizes) && len(e.multisetsFor(nl, false)) > 0:
			e.depthPruned = true
		case wIdx > 1 && !wSeatable && lbResolved(lpool) && len(e.multisetsFor(total, false)) > 0:
			e.depthPruned = true
		}
		return
	}

	rid := len(rounds)

	// Winners round: exact, or round 1 with a bye remainder.
	if wSeatable || wIdx == 1 {
		for _, ms := range e.multisetsFor(nw, wIdx == 1) {
			for p := 1; p < ms[len(ms)-1]; p++ {
				round, nextW, drops := buildRound(rid, wpool, ms, p)
				round.track, round.index = TrackWinners, wIdx
				newL := make([]seatRef, 0, len(lpool)+len(drops))
				newL = append(newL, lpool...)
				newL = append(newL, drops...)
				e.doubleDFS(nextW, newL, appendRound(rounds, round), wIdx+1, lIdx, depthLeft-1)
			}
		}
	}

	// Losers round: seats the LB pool exactly; the drops are out for good.
	// Its promotions have now won an LB round — the only way through to the
	// grand final.
	if nl >= 2 && canSeat(nl, e.sizes) {
		for _, ms := range e.multisetsFor(nl, false) {
			for p := 1; p < ms[len(ms)-1]; p++ {
				round, nextL, _ := buildRound(rid, lpool, ms, p)
				for i := range nextL {
					nextL[i].lbSurvivor = true
				}
				round.track, round.index = TrackLosers, lIdx
				e.doubleDFS(wpool, nextL, appendRound(rounds, round), wIdx, lIdx+1, depthLeft-1)
			}
		}
	}

	// Merge into the final track — the grand final: WB finalists and the
	// LB's winner set, once neither track can seat a round alone. No bracket
	// reset, no WB privilege: the final eliminates for everyone. The merge
	// itself adds no round, so it runs within the same depth budget.
	if !wSeatable && wIdx > 1 && lbResolved(lpool) {
		merged := make([]seatRef, 0, nw+nl)
		merged = append(merged, wpool...)
		merged = append(merged, lpool...)
		e.finalDFS(merged, rounds, 1, depthLeft)
	}
}

// finalDFS plays the merged field out to a single champion.
func (e *enumerator) finalDFS(pool []seatRef, rounds []builtRound, fIdx, depthLeft int) {
	if e.overBudget() {
		return
	}
	if n := len(pool); n >= 2 && depthLeft < minRoundsNeeded(n) {
		if len(e.multisetsFor(n, false)) > 0 {
			e.depthPruned = true
		}
		return
	}
	rid := len(rounds)
	for _, ms := range e.multisetsFor(len(pool), false) {
		for p := 1; p < ms[len(ms)-1]; p++ {
			round, next, _ := buildRound(rid, pool, ms, p)
			round.track, round.index = TrackFinal, fIdx
			if len(next) == 1 {
				e.emit(appendRound(rounds, round), EliminationDouble)
				continue
			}
			e.finalDFS(next, appendRound(rounds, round), fIdx+1, depthLeft-1)
		}
	}
}

// emit materializes the finished round list into a Plan of the given family:
// rounds in canonical track order, per-round slot refs rewritten to flat plan
// slot indices, deduplicated by canonical JSON. Facets are recorded for every
// deduplicated plan; the filter decides what joins the result.
func (e *enumerator) emit(rounds []builtRound, family string) {
	if len(rounds) == 0 {
		return
	}
	sorted := append([]builtRound(nil), rounds...)
	sort.SliceStable(sorted, func(i, j int) bool {
		oi, oj := trackRank[sorted[i].track], trackRank[sorted[j].track]
		if oi != oj {
			return oi < oj
		}
		return sorted[i].index < sorted[j].index
	})
	base := make(map[int]int, len(sorted))
	flat := 0
	for _, r := range sorted {
		base[r.rid] = flat
		flat += len(r.sizes)
	}

	plan := Plan{Elimination: family, Rounds: make([]PlanRound, 0, len(sorted))}
	for _, r := range sorted {
		pr := PlanRound{Track: r.track, Index: r.index, Promote: r.promote, Slots: make([]PlanSlot, 0, len(r.sizes))}
		for i, k := range r.sizes {
			ps := PlanSlot{SeatCount: k, Seats: make([]PlanSeat, k)}
			for j, ref := range r.seats[i] {
				ps.Seats[j] = PlanSeat{Kind: ref.kind}
				if ref.kind == SeatSource {
					slot := base[ref.rid] + ref.pos
					ps.Seats[j].SourceSlot = &slot
					ps.Seats[j].SourcePlace = ref.place
				}
			}
			pr.Slots = append(pr.Slots, ps)
		}
		plan.Rounds = append(plan.Rounds, pr)
	}

	if err := plan.Validate(); err != nil {
		// The enumerator's own guarantee; a violation is a bug, not input.
		panic(fmt.Sprintf("bracket: enumerator produced an invalid plan: %v", err))
	}
	key := plan.CanonicalJSON()
	if _, dup := e.seen[key]; dup {
		return
	}
	e.seen[key] = struct{}{}
	e.facets.record(plan)
	if !e.filter.matches(plan) {
		return
	}
	e.plans = append(e.plans, plan)
}

func seatVector(p Plan) []int {
	var v []int
	for _, r := range p.Rounds {
		for _, s := range r.Slots {
			v = append(v, s.SeatCount)
		}
	}
	return v
}

// canSeat reports whether n players can be partitioned into pool-sized
// tables with no remainder.
func canSeat(n int, sizes []int) bool {
	if n == 0 {
		return false
	}
	ok := make([]bool, n+1)
	ok[0] = true
	for i := 1; i <= n; i++ {
		for _, s := range sizes {
			if s <= i && ok[i-s] {
				ok[i] = true
				break
			}
		}
	}
	return ok[n]
}
