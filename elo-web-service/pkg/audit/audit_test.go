package audit

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

func TestValidateDetailsDocuments(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		kind string
		doc  any
		ok   bool
	}{
		{"entity ok", KindEntity, NewEntityDetails("Скул Кинг"), true},
		{"entity empty name", KindEntity, EntityDetails{SchemaVersion: 1, Name: ""}, false},
		{"entity extra field", KindEntity, map[string]any{"schema_version": 1, "name": "x", "extra": 1}, false},
		{"rename ok", KindRename, NewRenameDetails("Старое", "Новое"), true},
		{"rename missing new", KindRename, map[string]any{"schema_version": 1, "old_name": "a"}, false},
		{"match-update empty ok", KindMatchUpdate, NewMatchUpdateDetails(), true},
		{
			"match-update full ok",
			KindMatchUpdate,
			func() MatchUpdateDetails {
				d := NewMatchUpdateDetails()
				old, new := 3.0, 4.0
				d.Date = &DateChange{Old: time.Now(), New: time.Now().Add(time.Hour)}
				d.Game = &GameChange{OldGameID: "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f", NewGameID: "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e60"}
				d.PlayerChanges = []PlayerChange{
					{PlayerID: "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f", Change: PlayerScore, OldScore: &old, NewScore: &new},
					{PlayerID: "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e60", Change: PlayerAdded, NewScore: &new},
				}
				d.CalculatorChanged = true
				return d
			}(),
			true,
		},
		{"match-update bad change kind", KindMatchUpdate, map[string]any{
			"schema_version": 1, "player_changes": []any{map[string]any{"player_id": "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f", "change": "nope"}}, "calculator_changed": false,
		}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.doc)
			if err != nil {
				t.Fatal(err)
			}
			err = Validate(tt.kind, raw)
			if tt.ok && err != nil {
				t.Errorf("Validate(%s) = %v, want nil", tt.kind, err)
			}
			if !tt.ok && err == nil {
				t.Errorf("Validate(%s) = nil, want error", tt.kind)
			}
		})
	}
}

func TestMatchUpdateDetailsSerialization(t *testing.T) {
	t.Parallel()
	// Untouched fields must serialize as null/false (not be omitted) and
	// player_changes must serialize as [] — never null — to satisfy the schema.
	d := NewMatchUpdateDetails()
	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if _, present := got["date"]; !present {
		t.Error("date key omitted; schema expects explicit null")
	}
	if got["date"] != nil || got["game"] != nil {
		t.Errorf("untouched date/game = %v/%v, want null", got["date"], got["game"])
	}
	if _, ok := got["player_changes"].([]any); !ok {
		t.Errorf("player_changes = %v, want empty array", got["player_changes"])
	}
	if !d.IsEmpty() {
		t.Error("fresh details must be empty")
	}
}

func TestShortenIDsRewritesEntityIds(t *testing.T) {
	t.Parallel()
	canonical := "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"
	short := string(id.ID(canonical).Base58())
	d := NewMatchUpdateDetails()
	d.Game = &GameChange{OldGameID: canonical, NewGameID: canonical}
	d.PlayerChanges = []PlayerChange{{PlayerID: canonical, Change: PlayerRemoved}}

	raw, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	shortened, err := ShortenIDs(KindMatchUpdate, raw)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(shortened, &got); err != nil {
		t.Fatal(err)
	}
	game := got["game"].(map[string]any)
	if game["old_game_id"] != short || game["new_game_id"] != short {
		t.Errorf("game ids = %v/%v, want short %s", game["old_game_id"], game["new_game_id"], short)
	}
	pc := got["player_changes"].([]any)[0].(map[string]any)
	if pc["player_id"] != short {
		t.Errorf("player_id = %v, want short %s", pc["player_id"], short)
	}
	if pc["change"] != PlayerRemoved {
		t.Errorf("change = %v, untouched by the walk", pc["change"])
	}
}

func TestShortenIDsUnknownKindPassesThrough(t *testing.T) {
	t.Parallel()
	raw := json.RawMessage(`{"a":1}`)
	out, err := ShortenIDs("nope", raw)
	if err != nil {
		t.Fatalf("ShortenIDs unknown kind: %v", err)
	}
	if string(out) != string(raw) {
		t.Errorf("out = %s, want passthrough %s", out, raw)
	}
}
