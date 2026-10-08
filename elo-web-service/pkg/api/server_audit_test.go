package api

import (
	"encoding/json"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/audit"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// auditDetailsFromStored converts every stored details kind into the wire
// union; a kind missing from the switch 500s the whole audit feed, so each
// entry here is load-bearing.
func TestAuditDetailsFromStored_TenantUpdate(t *testing.T) {
	clubA := idpkg.New()
	clubB := idpkg.New()
	stored := map[string]any{
		"schema_version": 1,
		"arena_membership_mode": map[string]any{
			"from": "any_member",
			"to":   "members_only",
		},
		"starting_rating": map[string]any{
			"from": 500.0,
			"to":   100.0,
		},
		"leagues_changed": false,
		"icon": map[string]any{
			"from": "blue-figure",
			"to":   nil,
		},
		"clubs": map[string]any{
			"added_club_ids":   []string{string(clubA)},
			"removed_club_ids": []string{string(clubB)},
		},
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		t.Fatalf("marshal stored doc: %v", err)
	}

	details, err := auditDetailsFromStored(audit.KindTenantUpdate, raw)
	if err != nil {
		t.Fatalf("auditDetailsFromStored: %v", err)
	}

	// The union payload must carry the tenant-update document with the ids
	// across the ADR-12 boundary: canonical UUID in storage, Base58 on the wire.
	var wire struct {
		ArenaMembershipMode *struct {
			From string `json:"from"`
			To   string `json:"to"`
		} `json:"arena_membership_mode"`
		StartingRating *struct {
			From float64 `json:"from"`
			To   float64 `json:"to"`
		} `json:"starting_rating"`
		Icon *struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"icon"`
		LeaguesChanged bool `json:"leagues_changed"`
		Clubs          *struct {
			AddedClubIds   []string `json:"added_club_ids"`
			RemovedClubIds []string `json:"removed_club_ids"`
		} `json:"clubs"`
	}
	if err := json.Unmarshal(details.union, &wire); err != nil {
		t.Fatalf("unmarshal union payload: %v", err)
	}
	if wire.ArenaMembershipMode == nil || wire.ArenaMembershipMode.From != "any_member" || wire.ArenaMembershipMode.To != "members_only" {
		t.Errorf("arena_membership_mode = %+v", wire.ArenaMembershipMode)
	}
	if wire.StartingRating == nil || wire.StartingRating.From != 500 || wire.StartingRating.To != 100 {
		t.Errorf("starting_rating = %+v", wire.StartingRating)
	}
	if wire.Icon == nil || wire.Icon.From == nil || *wire.Icon.From != "blue-figure" || wire.Icon.To != nil {
		t.Errorf("icon = %+v", wire.Icon)
	}
	if wire.LeaguesChanged {
		t.Errorf("leagues_changed = true, want false")
	}
	if wire.Clubs == nil ||
		len(wire.Clubs.AddedClubIds) != 1 || wire.Clubs.AddedClubIds[0] != string(clubA.Base58()) ||
		len(wire.Clubs.RemovedClubIds) != 1 || wire.Clubs.RemovedClubIds[0] != string(clubB.Base58()) {
		t.Errorf("clubs = %+v, want the club ids shortened to Base58 (%s, %s)", wire.Clubs, clubA.Base58(), clubB.Base58())
	}
}

func TestAuditDetailsFromStored_MatchUpdateStillConverts(t *testing.T) {
	stored := map[string]any{
		"schema_version":     1,
		"player_changes":     []any{},
		"calculator_changed": false,
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		t.Fatalf("marshal stored doc: %v", err)
	}

	details, err := auditDetailsFromStored(audit.KindMatchUpdate, raw)
	if err != nil {
		t.Fatalf("auditDetailsFromStored: %v", err)
	}
	var wire struct {
		PlayerChanges []any `json:"player_changes"`
	}
	if err := json.Unmarshal(details.union, &wire); err != nil {
		t.Fatalf("unmarshal union payload: %v", err)
	}
	if len(wire.PlayerChanges) != 0 {
		t.Errorf("player_changes = %+v, want empty", wire.PlayerChanges)
	}
}
