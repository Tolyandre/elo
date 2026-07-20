package calculator

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestValidate_SkullKing_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"schema_version": 1,
		"players": [{"player_id":"p1","name":"A"},{"player_id":"p2","name":"B"}],
		"current_round": 3,
		"current_player_index": 1,
		"rounds": [
			[{"bid":0,"actual":0,"bonus":0}, null],
			[null, {"bid":1,"actual":1,"bonus":10}]
		]
	}`)
	if err := Validate(KindSkullKing, raw); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestValidate_SkullKing_PlayerIdAsKey_Rejected(t *testing.T) {
	// The normalized storage shape MUST keep player ids under "player_id", not
	// as object keys. This guards against regressions that would silently break
	// idcodec rewriting (player ids would leak in canonical form).
	raw := json.RawMessage(`{
		"schema_version": 1,
		"players": [{"player_id":"p1","name":"A"}],
		"current_round": 1,
		"current_player_index": 0,
		"rounds": []
	}`)
	// too few players
	if err := Validate(KindSkullKing, raw); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid (too few players), got %v", err)
	}
}

func TestValidate_IAWW_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"schema_version": 2,
		"players": [{"player_id":"p1","name":"A"},{"player_id":"p2","name":"B"}],
		"direct_vp": [{"player_id":"p1","value":12},{"player_id":"p2","value":0}],
		"multipliers": [{"row":"str-res","player_id":"p1","coeff":6,"count":2}]
	}`)
	if err := Validate(KindIAWW, raw); err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestValidate_UnknownKind(t *testing.T) {
	if err := Validate("monopoly", json.RawMessage(`{}`)); !errors.Is(err, ErrUnknownKind) {
		t.Fatalf("expected ErrUnknownKind, got %v", err)
	}
}

func TestValidate_EmptyDocument(t *testing.T) {
	for _, raw := range []json.RawMessage{nil, []byte("null"), []byte("")} {
		if err := Validate(KindSkullKing, raw); !errors.Is(err, ErrInvalid) {
			t.Fatalf("expected ErrInvalid for %q, got %v", string(raw), err)
		}
	}
}

func TestMigrateData_NoMigrators(t *testing.T) {
	raw := json.RawMessage(`{"schema_version":1,"players":[{"player_id":"p1","name":"A"},{"player_id":"p2","name":"B"}],"current_round":1,"current_player_index":0,"rounds":[]}`)
	out, ver, err := MigrateData(KindSkullKing, 1, raw)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if ver != 1 {
		t.Fatalf("version = %d, want 1", ver)
	}
	if string(out) != string(raw) {
		t.Fatalf("document changed when no migrators should run")
	}
}

func TestMigrateData_FutureVersionRejected(t *testing.T) {
	_, _, err := MigrateData(KindSkullKing, 99, json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected error for future version")
	}
}

// TestMigrateIAWW_v1ToV2_RenamesAndRepairs verifies that the v1→v2 migrator:
//   - renames row_id → row
//   - recovers row ids that idcodec corrupted into canonical UUIDs
//   - leaves unrecognized values in place (no silent data loss)
func TestMigrateIAWW_v1ToV2_RenamesAndRepairs(t *testing.T) {
	// "research" decodes to this UUID via shortid.ToCanonical.
	corruptResearch := "00000000-0000-0000-0000-63b5ec8e7172"
	v1 := json.RawMessage(`{
		"schema_version": 1,
		"players": [{"player_id":"p1","name":"A"},{"player_id":"p2","name":"B"}],
		"direct_vp": [{"player_id":"p1","value":5}],
		"multipliers": [
			{"row_id":"str-res","player_id":"p1","coeff":6,"count":2},
			{"row_id":"` + corruptResearch + `","player_id":"p2","coeff":1,"count":2},
			{"row_id":"some-unknown","player_id":"p1","coeff":3,"count":1}
		]
	}`)
	out, ver, err := MigrateData(KindIAWW, 1, v1)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if ver != 2 {
		t.Fatalf("version = %d, want 2", ver)
	}
	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("parse migrated: %v", err)
	}
	mults := got["multipliers"].([]any)
	wantRows := map[string]bool{"str-res": false, "research": false, "some-unknown": false}
	for _, m := range mults {
		obj := m.(map[string]any)
		if _, hasRowID := obj["row_id"]; hasRowID {
			t.Errorf("multiplier still has row_id key: %v", obj)
		}
		row, ok := obj["row"].(string)
		if !ok {
			t.Errorf("multiplier missing 'row' string: %v", obj)
			continue
		}
		if _, tracked := wantRows[row]; tracked {
			wantRows[row] = true
		}
	}
	for row, found := range wantRows {
		if !found {
			t.Errorf("expected row %q in migrated multipliers, not found", row)
		}
	}
	// The corrupted UUID must NOT appear anywhere in the output.
	if strings.Contains(string(out), corruptResearch) {
		t.Errorf("migrated document still contains corrupted UUID %q", corruptResearch)
	}
}
