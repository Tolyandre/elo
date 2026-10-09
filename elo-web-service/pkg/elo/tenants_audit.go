package elo

import (
	"context"
	"slices"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Tenant-update audit (ADR-14, ADR-36): a settings or composition change is
// recorded as a structured diff document in the match-edit style, so the
// admin journal can expand exactly what moved.

// recordTenantUpdate writes one tenant update row: the structured
// tenant-update diff when anything changed, the plain entity shape when the
// update was a no-op (the PUT still happened).
func recordTenantUpdate(ctx context.Context, q *db.Queries, actor id.ID, tenantID id.ID, details audit.TenantUpdateDetails, tenantName string) error {
	if details.IsEmpty() {
		return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionUpdated, tenantID, audit.KindEntity, audit.NewEntityDetails(tenantName))
	}
	return recordAuditEvent(ctx, q, actor, audit.EntityTenant, audit.ActionUpdated, tenantID, audit.KindTenantUpdate, details)
}

// setNameDiff records a tenant rename.
func setNameDiff(details *audit.TenantUpdateDetails, old, new string) {
	if old != new {
		details.Name = &audit.ValueChange{From: &old, To: &new}
	}
}

// setModeDiff records an arena_membership_mode change.
func setModeDiff(details *audit.TenantUpdateDetails, old, new string) {
	if old != new {
		details.ArenaMembershipMode = &audit.StringChange{From: old, To: new}
	}
}

// setOpennessDiff records a tournaments_openness change.
func setOpennessDiff(details *audit.TenantUpdateDetails, old, new string) {
	if old != new {
		details.TournamentsOpenness = &audit.StringChange{From: old, To: new}
	}
}

// setIconDiff records an icon change; an empty new value clears the icon (a
// null "to" side).
func setIconDiff(details *audit.TenantUpdateDetails, old pgtype.Text, new string) {
	if textValue(old) == new {
		return
	}
	var from, to *string
	if old.Valid {
		from = &old.String
	}
	if new != "" {
		to = &new
	}
	details.Icon = &audit.ValueChange{From: from, To: to}
}

// textValue dereferences a nullable text column, null → "".
func textValue(s pgtype.Text) string {
	if !s.Valid {
		return ""
	}
	return s.String
}

// setSettingsDiff records a main-arena settings document change: the
// starting rating and catch-up parameters as value pairs, league-parameter
// changes as a flag.
func setSettingsDiff(details *audit.TenantUpdateDetails, old, new arenasettings.Settings) {
	if old.StartingRating != new.StartingRating {
		details.StartingRating = &audit.NumberChange{From: old.StartingRating, To: new.StartingRating}
	}
	if old.CatchUp != new.CatchUp {
		details.CatchUpChanged = true
	}
	if !leaguesEqual(old.Leagues, new.Leagues) {
		details.LeaguesChanged = true
	}
}

// setClubsDiff records a club composition replacement.
func setClubsDiff(details *audit.TenantUpdateDetails, before, after []id.ID) {
	var added, removed []id.ID
	for _, b := range before {
		if !slices.Contains(after, b) {
			removed = append(removed, b)
		}
	}
	for _, a := range after {
		if !slices.Contains(before, a) {
			added = append(added, a)
		}
	}
	details.Clubs = &audit.TenantClubsChange{
		AddedClubIDs:   stringsOfIDs(added),
		RemovedClubIDs: stringsOfIDs(removed),
	}
}

// stringsOfIDs converts ids to the canonical UUID strings the stored details
// document holds (the schema's x-entity-id walk shortens them on egress).
func stringsOfIDs(ids []id.ID) []string {
	out := make([]string, 0, len(ids))
	for _, v := range ids {
		out = append(out, string(v))
	}
	if out == nil {
		out = []string{}
	}
	return out
}
