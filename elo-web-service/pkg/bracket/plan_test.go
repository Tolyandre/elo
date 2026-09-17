package bracket

import (
	"encoding/json"
	"strings"
	"testing"
)

// Test builders ---------------------------------------------------------------

func drawSeat() PlanSeat { return PlanSeat{Kind: SeatDraw} }
func byeSeat() PlanSeat  { return PlanSeat{Kind: SeatBye} }
func srcSeat(slot, place int) PlanSeat {
	return PlanSeat{Kind: SeatSource, SourceSlot: slot, SourcePlace: place}
}
func tslot(seats ...PlanSeat) PlanSlot { return PlanSlot{SeatCount: len(seats), Seats: seats} }
func trnd(track string, index, promote int, slots ...PlanSlot) PlanRound {
	return PlanRound{Track: track, Index: index, Promote: promote, Slots: slots}
}

// flagshipSingle is the ADR rollout's integration shape: 8 players, 4-seat
// pool, 4+4 promote-2 → final 4 promote-1.
func flagshipSingle() Plan {
	return Plan{Elimination: EliminationSingle, Rounds: []PlanRound{
		trnd(TrackWinners, 1, 2, tslot(drawSeat(), drawSeat(), drawSeat(), drawSeat()), tslot(drawSeat(), drawSeat(), drawSeat(), drawSeat())),
		trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(0, 2), srcSeat(1, 1), srcSeat(1, 2))),
	}}
}

// Parse & validate ------------------------------------------------------------

func TestParsePlanAcceptsFlagship(t *testing.T) {
	raw, err := json.Marshal(flagshipSingle())
	if err != nil {
		t.Fatal(err)
	}
	p, err := ParsePlan(raw)
	if err != nil {
		t.Fatalf("parse flagship: %v", err)
	}
	if p.CanonicalJSON() != string(raw) {
		t.Fatalf("canonical form drift:\n%s\n%s", p.CanonicalJSON(), raw)
	}
}

func TestParsePlanRejectsUnknownField(t *testing.T) {
	raw := []byte(`{"elimination":"single","rounds":[],"sneaky":1}`)
	if _, err := ParsePlan(raw); err == nil || !strings.Contains(err.Error(), ErrInvalidPlan.Error()) {
		t.Fatalf("unknown field must be rejected, got %v", err)
	}
}

func TestValidateRejectsBrokenStructures(t *testing.T) {
	cases := map[string]Plan{
		"unknown elimination": {Elimination: "triple", Rounds: flagshipSingle().Rounds},
		"no rounds":           {Elimination: EliminationSingle},
		"promote >= seat count": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 4, tslot(drawSeat(), drawSeat(), drawSeat(), drawSeat()), tslot(drawSeat(), drawSeat(), drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(0, 2), srcSeat(1, 1), srcSeat(1, 2))),
		}},
		"promote 0": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 0, tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(0, 2))),
		}},
		"draw seat outside round 1": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(drawSeat(), drawSeat())),
		}},
		"bye seat in the losers track": {Elimination: EliminationDouble, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat()), tslot(drawSeat(), drawSeat())),
			trnd(TrackWinners, 2, 1, tslot(srcSeat(0, 1), srcSeat(1, 1))),
			trnd(TrackLosers, 1, 1, tslot(srcSeat(0, 2), byeSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(2, 1), srcSeat(2, 2))),
		}},
		"source slot out of range": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(7, 1), srcSeat(0, 2))),
		}},
		"source place out of range": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 5), srcSeat(0, 2))),
		}},
		"one source place feeds two seats": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(0, 1))),
		}},
		"rounds not grouped by track": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackFinal, 1, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat())),
		}},
		"non-contiguous track index": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 2, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(0, 2))),
		}},
		"last round not the grand final": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat())),
			trnd(TrackWinners, 2, 1, tslot(srcSeat(0, 1), srcSeat(0, 2))),
		}},
		"grand final with two slots": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat()), tslot(drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(1, 1)), tslot(srcSeat(0, 2), srcSeat(1, 2))),
		}},
		"seat count mismatch": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1, tslot(drawSeat(), drawSeat(), drawSeat())),
			trnd(TrackFinal, 1, 1, tslot(srcSeat(0, 1), srcSeat(0, 1))),
		}},
		"empty round": {Elimination: EliminationSingle, Rounds: []PlanRound{
			trnd(TrackWinners, 1, 1),
		}},
	}
	for name, p := range cases {
		if err := p.Validate(); err == nil {
			t.Errorf("%s: must be rejected", name)
		}
	}
}
