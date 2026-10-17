package elo

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// The typed states must accept exactly the wire shapes the OpenAPI schema
// (and the frontend, which is generated from it) produce — normalize runs on
// every host write, and its re-marshal would silently erase a field the Go
// struct does not know if the decode were lenient (ADR-18).

func TestTableGameNormalizeAcceptsSchemaShape(t *testing.T) {
	playerID := id.ID("00000000-0000-0000-0000-0000000000a1")

	skRaw, err := json.Marshal(skullKingGameState{
		Phase:              "waiting-for-bids",
		Players:            []TablePlayer{{ID: playerID, Name: "Alice"}},
		CurrentRound:       1,
		CurrentPlayerIndex: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (skullKingTableGame{}).normalize(skRaw); err != nil {
		t.Errorf("spec-shaped skull king state rejected: %v", err)
	}

	playerB := id.ID("00000000-0000-0000-0000-0000000000a2")
	iawwRaw, err := json.Marshal(iawwGameState{
		Phase:   "scoring",
		Players: []TablePlayer{{ID: playerID, Name: "Alice"}, {ID: playerB, Name: "Bob"}},
		Entries: []iawwEntryState{
			{PlayerID: playerID, Cells: []IawwCell{}},
			{PlayerID: playerB, Cells: []IawwCell{}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (iawwTableGame{}).normalize(iawwRaw); err != nil {
		t.Errorf("spec-shaped iaww state rejected: %v", err)
	}
}

func TestTableGameNormalizeRejectsUnknownField(t *testing.T) {
	playerID := id.ID("00000000-0000-0000-0000-0000000000a1")

	withExtra := func(in any) json.RawMessage {
		raw, err := json.Marshal(in)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		m["someNewField"] = 1
		out, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}

	if _, err := (skullKingTableGame{}).normalize(withExtra(skullKingGameState{
		Phase: "waiting-for-bids", Players: []TablePlayer{{ID: playerID, Name: "A"}}, CurrentRound: 1,
	})); !errors.Is(err, ErrInvalidState) {
		t.Errorf("skull king normalize must reject unknown fields loudly, got %v", err)
	}
	if _, err := (iawwTableGame{}).normalize(withExtra(iawwGameState{
		Phase: "scoring", Players: []TablePlayer{{ID: playerID, Name: "A"}},
	})); !errors.Is(err, ErrInvalidState) {
		t.Errorf("iaww normalize must reject unknown fields loudly, got %v", err)
	}
}

// ─── Skull King player submissions ────────────────────────────────────────────
//
// 0 is a legal bid (bid zero tricks), so a slot's presence — never its bid
// value — decides whether the player has already bid. A connected player
// cannot override their own input (ErrSlotAlreadySet); the host overrides
// through whole-state cell edits instead.

func skullKingBiddingState(t *testing.T, playerID id.ID) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(skullKingGameState{
		Phase:              "waiting-for-bids",
		Players:            []TablePlayer{{ID: playerID, Name: "Alice"}},
		CurrentRound:       1,
		CurrentPlayerIndex: 0,
		Rounds:             [][]json.RawMessage{nil},
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func skullKingSubmitJSON(t *testing.T, in skullKingSubmit) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// applyResult over a bid-only slot in result-entry keeps the bid and fills
// actual — including the bid-0 slot the old code mistook for "unset".
func assertResultKeepsBid(t *testing.T, bid int) {
	t.Helper()
	playerID := id.ID("00000000-0000-0000-0000-0000000000a1")
	entryJSON, err := json.Marshal(skullKingEntry{Bid: bid})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(skullKingGameState{
		Phase:              "result-entry",
		Players:            []TablePlayer{{ID: playerID, Name: "Alice"}},
		CurrentRound:       1,
		CurrentPlayerIndex: 0,
		Rounds:             [][]json.RawMessage{{entryJSON}},
	})
	if err != nil {
		t.Fatal(err)
	}

	resultState, err := (skullKingTableGame{}).applySubmit(raw, playerID, skullKingSubmitJSON(t, skullKingSubmit{Actual: intPtr(2), Bonus: 10}))
	if err != nil {
		t.Fatalf("result over a bid-only slot must apply, got %v", err)
	}
	var gs skullKingGameState
	if err := json.Unmarshal(resultState, &gs); err != nil {
		t.Fatal(err)
	}
	var entry skullKingEntry
	if err := json.Unmarshal(gs.Rounds[0][0], &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Bid != bid || entry.Actual == nil || *entry.Actual != 2 {
		t.Errorf("result entry = %+v, want bid %d, actual 2", entry, bid)
	}
}

func intPtr(v int) *int { return &v }

func TestSkullKingApplyBidZeroBidFillsTheSlot(t *testing.T) {
	playerID := id.ID("00000000-0000-0000-0000-0000000000a1")
	state := skullKingBiddingState(t, playerID)

	updated, err := (skullKingTableGame{}).applySubmit(state, playerID, skullKingSubmitJSON(t, skullKingSubmit{Bid: intPtr(0)}))
	if err != nil {
		t.Fatalf("bid 0 is legal and must apply, got %v", err)
	}
	var gs skullKingGameState
	if err := json.Unmarshal(updated, &gs); err != nil {
		t.Fatal(err)
	}
	if len(gs.Rounds[0]) != 1 || gs.Rounds[0][0] == nil {
		t.Fatalf("bid 0 must fill the slot, rounds = %v", gs.Rounds)
	}
	var entry skullKingEntry
	if err := json.Unmarshal(gs.Rounds[0][0], &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Bid != 0 || entry.Actual != nil {
		t.Errorf("slot = %+v, want {bid:0, actual:nil}", entry)
	}
}

func TestSkullKingApplyBidRejectsRebidOverZeroBid(t *testing.T) {
	playerID := id.ID("00000000-0000-0000-0000-0000000000a1")
	state := skullKingBiddingState(t, playerID)

	updated, err := (skullKingTableGame{}).applySubmit(state, playerID, skullKingSubmitJSON(t, skullKingSubmit{Bid: intPtr(0)}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (skullKingTableGame{}).applySubmit(updated, playerID, skullKingSubmitJSON(t, skullKingSubmit{Bid: intPtr(3)})); !errors.Is(err, ErrSlotAlreadySet) {
		t.Errorf("rebid over a 0 bid must be ErrSlotAlreadySet, got %v", err)
	}
}

func TestSkullKingApplyBidRejectsRebidOverNonZeroBid(t *testing.T) {
	playerID := id.ID("00000000-0000-0000-0000-0000000000a1")
	state := skullKingBiddingState(t, playerID)

	updated, err := (skullKingTableGame{}).applySubmit(state, playerID, skullKingSubmitJSON(t, skullKingSubmit{Bid: intPtr(2)}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := (skullKingTableGame{}).applySubmit(updated, playerID, skullKingSubmitJSON(t, skullKingSubmit{Bid: intPtr(3)})); !errors.Is(err, ErrSlotAlreadySet) {
		t.Errorf("rebid over a non-zero bid must be ErrSlotAlreadySet, got %v", err)
	}
}

func TestSkullKingApplyResultKeepsBid(t *testing.T) {
	assertResultKeepsBid(t, 0)
	assertResultKeepsBid(t, 2)
}
