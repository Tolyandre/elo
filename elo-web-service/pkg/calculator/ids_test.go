package calculator

import (
	"encoding/json"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

func TestCanonicalizeAndShortenRoundTrip(t *testing.T) {
	t.Parallel()
	canonical := "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"
	short := toBase58ForTest(t, canonical)
	doc := `{
		"schema_version": 1,
		"players": [{"player_id": "` + short + `", "name": "A"}],
		"current_round": 1,
		"current_player_index": 0,
		"rounds": [[{"bid": 1, "bonus": 0}]],
		"fallback_game_id": "` + short + `"
	}`

	canonicalized, err := CanonicalizeIDs(KindSkullKing, json.RawMessage(doc))
	if err != nil {
		t.Fatalf("CanonicalizeIDs: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(canonicalized, &got); err != nil {
		t.Fatal(err)
	}
	players := got["players"].([]any)[0].(map[string]any)
	if players["player_id"] != canonical {
		t.Errorf("player_id = %v, want canonical %s", players["player_id"], canonical)
	}
	if got["fallback_game_id"] != canonical {
		t.Errorf("fallback_game_id = %v, want canonical", got["fallback_game_id"])
	}

	shortened, err := ShortenIDs(KindSkullKing, canonicalized)
	if err != nil {
		t.Fatalf("ShortenIDs: %v", err)
	}
	if err := json.Unmarshal(shortened, &got); err != nil {
		t.Fatal(err)
	}
	players = got["players"].([]any)[0].(map[string]any)
	if players["player_id"] != short {
		t.Errorf("player_id = %v, want short %s", players["player_id"], short)
	}
}

// Non-id strings (IAWW row kinds) must survive both directions untouched.
func TestWalkLeavesNonIdValuesAlone(t *testing.T) {
	t.Parallel()
	doc := `{
		"schema_version": 2,
		"players": [{"player_id": "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f", "name": "A"}],
		"direct_vp": [],
		"multipliers": [{"row": "research", "player_id": "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f", "coeff": 2, "count": 1}]
	}`
	out, err := CanonicalizeIDs(KindIAWW, json.RawMessage(doc))
	if err != nil {
		t.Fatalf("CanonicalizeIDs: %v", err)
	}
	shortened, err := ShortenIDs(KindIAWW, out)
	if err != nil {
		t.Fatalf("ShortenIDs: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(shortened, &got); err != nil {
		t.Fatal(err)
	}
	row := got["multipliers"].([]any)[0].(map[string]any)
	if row["row"] != "research" {
		t.Errorf("row = %v, want untouched %q (ADR-09 non-id key)", row["row"], "research")
	}
}

func toBase58ForTest(t *testing.T, canonical string) string {
	t.Helper()
	return string(id.ID(canonical).Base58())
}
