// Package bracket is the pure domain of bracket tournaments (ADR-26): the
// plan document, the plan enumerator (all valid shapes for a participant
// count and game pool), and the placement-points standings that decide slot
// completion. It imports nothing from the database layer — the elo service
// owns transactions and persistence; everything here is deterministic and
// unit-testable without a database.
package bracket

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

// Elimination families (ADR-26): single elimination, or traditional double
// elimination — a WB loss (except in the grand final) drops to the LB, an LB
// loss is elimination, and the LB's winner(s) join the WB finalists in the
// grand final.
const (
	EliminationSingle = "single"
	EliminationDouble = "double"
)

// Bracket tracks. Single-elimination plans use winners for every round but
// the last, which is the grand final; WB+LB plans merge the WB finalists and
// the LB winner set into one grand-final round once neither path can seat a
// round alone — the final track is always exactly that one round.
const (
	TrackWinners = "winners"
	TrackLosers  = "losers"
	TrackFinal   = "final"
)

// Seat kinds (PlanSeat.Kind).
const (
	// SeatDraw: a round-1 winners-track seat filled from the seeded draw.
	SeatDraw = "draw"
	// SeatBye: a round-1 remainder player — unseated in round 1, seated
	// directly (from the draw tail) in the later winners round — or grand
	// final — where he next plays. A winners-round survivor who waits is not
	// a bye: his later seat is a SeatSource of the slot he last played, so
	// every played slot stays connected to where its winners land.
	SeatBye = "bye"
	// SeatSource: filled from a place of an earlier slot when it completes.
	SeatSource = "source"
)

// ErrInvalidPlan marks a plan document that does not parse or violates the
// structural bracket rules. The start action additionally rejects plans that
// a fresh enumeration would not have offered.
var ErrInvalidPlan = errors.New("неверный план турнирной сетки")

// maxRounds is a sanity bound; real plans stay far below it (every round
// strictly shrinks the field).
const maxRounds = 64

// Plan is a complete, pre-computed bracket shape: every round, every slot
// with its seat count and promotion count, and every seat's provenance. It is
// game-free and id-free by design — the server assigns a pool-fitting game to
// every slot at start (seeded), and no identifier ever enters the document,
// so plan equality is plain JSON equality.
type Plan struct {
	Elimination string      `json:"elimination"`
	Rounds      []PlanRound `json:"rounds"`
}

// PlanRound is one elimination round. promote is uniform across the round
// (ADR-26: it cannot differ between slots of the same round) and must be
// smaller than every seat count of the round.
type PlanRound struct {
	Track   string     `json:"track"`
	Index   int        `json:"index"`
	Promote int        `json:"promote"`
	Slots   []PlanSlot `json:"slots"`
}

// PlanSlot is one table. Seats are position-ordered; their provenance kinds
// are draw (round 1), bye (winners round 2), or source (a place of an
// earlier slot, see seatRefKey).
type PlanSlot struct {
	SeatCount int        `json:"seat_count"`
	Seats     []PlanSeat `json:"seats"`
}

// PlanSeat is one seat's provenance in the plan.
type PlanSeat struct {
	Kind string `json:"kind"`
	// SourceSlot is the flat plan slot index (slots numbered in canonical
	// round order, position-ordered within a round) and SourcePlace the
	// 1-based place there. Set only for SeatSource. SourceSlot is a pointer
	// because 0 is a valid slot index the omitempty encoding must still
	// emit; a legacy document without it reads as slot 0.
	SourceSlot  *int `json:"source_slot,omitempty"`
	SourcePlace int  `json:"source_place,omitempty"`
}

// ParsePlan parses a plan document strictly (unknown fields rejected, so the
// canonical-JSON equality against a fresh enumeration cannot be fooled by
// extra keys) and validates the structural bracket rules.
func ParsePlan(raw json.RawMessage) (Plan, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var p Plan
	if err := dec.Decode(&p); err != nil {
		return Plan{}, fmt.Errorf("%w: %v", ErrInvalidPlan, err)
	}
	if err := p.Validate(); err != nil {
		return Plan{}, err
	}
	return p, nil
}

// CanonicalJSON returns the deterministic serialization used for plan
// equality: struct field order and slice order are fixed by construction.
func (p Plan) CanonicalJSON() string {
	b, err := json.Marshal(p)
	if err != nil {
		// Plans carry only strings and ints; marshaling cannot fail.
		panic(fmt.Sprintf("bracket: canonical marshal: %v", err))
	}
	return string(b)
}

// Validate enforces the structural rules the enumerator guarantees:
//
//   - rounds are grouped by track in winners → losers → final order, each
//     track's indices contiguous from 1;
//   - every round has ≥ 1 slot of ≥ 2 seats, with promote uniform and
//     promote < min seat count;
//   - draw seats only in the plan's first round; bye seats only in winners
//     round 2 or the grand final (the round-1 remainder fed forward — byes
//     are bare, a waiting round survivor is a source seat);
//   - source seats reference strictly earlier slots with a place within the
//     source slot's seat count, and a source place feeds at most one seat;
//   - the last round is the grand final: final track, single slot, promote 1.
func (p Plan) Validate() error {
	if p.Elimination != EliminationSingle && p.Elimination != EliminationDouble {
		return fmt.Errorf("%w: unknown elimination %q", ErrInvalidPlan, p.Elimination)
	}
	if len(p.Rounds) == 0 || len(p.Rounds) > maxRounds {
		return fmt.Errorf("%w: %d rounds", ErrInvalidPlan, len(p.Rounds))
	}

	trackOrder := map[string]int{TrackWinners: 0, TrackLosers: 1, TrackFinal: 2}
	trackLen := map[string]int{}
	prevOrder := -1
	seatCounts := make([]int, 0, 64) // flat slot index → seat count

	for ri, r := range p.Rounds {
		order, ok := trackOrder[r.Track]
		if !ok {
			return fmt.Errorf("%w: unknown track %q", ErrInvalidPlan, r.Track)
		}
		if order < prevOrder {
			return fmt.Errorf("%w: rounds not grouped winners→losers→final (round %d)", ErrInvalidPlan, ri+1)
		}
		prevOrder = order
		trackLen[r.Track]++
		if r.Index != trackLen[r.Track] {
			return fmt.Errorf("%w: %s round index %d out of order", ErrInvalidPlan, r.Track, r.Index)
		}
		if r.Promote < 1 {
			return fmt.Errorf("%w: round %d promote %d", ErrInvalidPlan, ri+1, r.Promote)
		}
		if len(r.Slots) == 0 {
			return fmt.Errorf("%w: round %d has no slots", ErrInvalidPlan, ri+1)
		}
		minSeat := math.MaxInt
		for _, s := range r.Slots {
			if s.SeatCount < 2 || len(s.Seats) != s.SeatCount {
				return fmt.Errorf("%w: round %d slot seat count %d/%d", ErrInvalidPlan, ri+1, s.SeatCount, len(s.Seats))
			}
			if s.SeatCount < minSeat {
				minSeat = s.SeatCount
			}
		}
		if r.Promote >= minSeat {
			return fmt.Errorf("%w: round %d promote %d >= min seat count %d", ErrInvalidPlan, ri+1, r.Promote, minSeat)
		}

		fed := make(map[[2]int]bool, 16) // (source slot, place) consumed so far, whole round
		for _, s := range r.Slots {
			for _, seat := range s.Seats {
				switch seat.Kind {
				case SeatDraw:
					// Positional rule: draw seats are seeded only in the plan's
					// first round (which is the grand final itself for n=2).
					if ri != 0 {
						return fmt.Errorf("%w: draw seat outside round 1", ErrInvalidPlan)
					}
				case SeatBye:
					// Bye seats are winners-track remainder players fed
					// forward: winners rounds 2+ — or straight in the grand
					// final when the merge happened first (WB+LB). The
					// losers track and the plan's first round seat everyone.
					if !(r.Track == TrackWinners && r.Index >= 2) && !(r.Track == TrackFinal && r.Index == 1) {
						return fmt.Errorf("%w: bye seat outside winners rounds 2+ / final round 1", ErrInvalidPlan)
					}
				case SeatSource:
					// A legacy document may omit source_slot; it reads as
					// slot 0.
					slot := 0
					if seat.SourceSlot != nil {
						slot = *seat.SourceSlot
					}
					if slot < 0 || slot >= len(seatCounts) {
						return fmt.Errorf("%w: source slot %d out of range", ErrInvalidPlan, slot)
					}
					if seat.SourcePlace < 1 || seat.SourcePlace > seatCounts[slot] {
						return fmt.Errorf("%w: source place %d out of range for slot %d",
							ErrInvalidPlan, seat.SourcePlace, slot)
					}
					key := [2]int{slot, seat.SourcePlace}
					if fed[key] {
						return fmt.Errorf("%w: source place %d of slot %d feeds two seats",
							ErrInvalidPlan, seat.SourcePlace, slot)
					}
					fed[key] = true
				default:
					return fmt.Errorf("%w: unknown seat kind %q", ErrInvalidPlan, seat.Kind)
				}
			}
		}
		for _, s := range r.Slots {
			seatCounts = append(seatCounts, s.SeatCount)
		}
	}

	last := p.Rounds[len(p.Rounds)-1]
	if last.Track != TrackFinal || len(last.Slots) != 1 || last.Promote != 1 {
		return fmt.Errorf("%w: the last round must be the grand final (final track, one slot, promote 1)", ErrInvalidPlan)
	}
	return nil
}
