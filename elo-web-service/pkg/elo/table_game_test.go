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
