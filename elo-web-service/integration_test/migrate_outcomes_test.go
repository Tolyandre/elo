//go:build integration

package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	sourceiofs "github.com/golang-migrate/migrate/v4/source/iofs"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/tolyandre/elo-web-service/migrations"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
)

// TestMarketOutcomesMigration exercises SQL migration 041 against a legacy
// binary (yes/no) market dataset: it seeds pre-migration state at schema
// version 40, applies the migration, and asserts the n-outcome conversion —
// in particular the status-preserving bet remap that keeps historical payouts
// reproducible (ADR-11):
//
//	M1  target won sole             → player outcome wins; yes-bets follow it
//	M2  target tied at first place  → "other" wins (old rule said yes); yes-bets
//	                                  map to other (still win), no-bets map to
//	                                  the target's outcome (still lose)
//	M3  required player won sole    → that player's outcome wins; no-bets (which
//	                                  won historically) follow it
//	M4  cancelled                   → resolution_outcome NULL, bets remapped for
//	                                  display only
//
// Re-settling the migrated markets must pay the historically winning bets and
// nothing else — the replay-safety guarantee.
func TestMarketOutcomesMigration(t *testing.T) {
	ctx := context.Background()

	pgContainer, err := tcpostgres.Run(ctx, "docker.io/postgres:16-alpine",
		tcpostgres.WithDatabase("elo_test"),
		tcpostgres.WithUsername("elo_test"),
		tcpostgres.WithPassword("test_secret"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	defer func() { _ = pgContainer.Terminate(ctx) }()

	connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	// Apply migrations only up to version 40 (the last pre-n-outcome schema).
	src, err := sourceiofs.New(migrations.MigrationsFS, ".")
	if err != nil {
		t.Fatalf("create migration source: %v", err)
	}
	migrator, err := migrate.NewWithSourceInstance("iofs", src, connStr)
	if err != nil {
		t.Fatalf("create migrate instance: %v", err)
	}
	defer func() { _, _ = migrator.Close() }()
	if err := migrator.Migrate(40); err != nil {
		t.Fatalf("migrate to version 40: %v", err)
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	defer pool.Close()

	// --- Seed players, game, matches and legacy markets/bets ----------------

	seed := `
INSERT INTO users (id, allow_editing, google_oauth_user_id, google_oauth_user_name)
VALUES ('00000000-0000-0000-0000-0000000000aa', true, 'seed-admin', 'SeedAdmin');

INSERT INTO players (id, name) VALUES
	('00000000-0000-0000-0001-000000000001', 'Target'),
	('00000000-0000-0000-0001-000000000002', 'Required'),
	('00000000-0000-0000-0001-000000000003', 'Outsider');

INSERT INTO games (id, name) VALUES ('00000000-0000-0000-0002-000000000001', 'SeedGame');

-- m1: Target wins sole (5 vs 3)
INSERT INTO matches (id, date, game_id) VALUES ('00000000-0000-0000-0003-000000000001', '2026-08-01T18:00:00Z', '00000000-0000-0000-0002-000000000001');
INSERT INTO match_scores (match_id, player_id, score) VALUES
	('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000001', 5),
	('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0001-000000000002', 3);

-- m2: Target and Required tie at the top (5 vs 5)
INSERT INTO matches (id, date, game_id) VALUES ('00000000-0000-0000-0003-000000000002', '2026-08-02T18:00:00Z', '00000000-0000-0000-0002-000000000001');
INSERT INTO match_scores (match_id, player_id, score) VALUES
	('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000001', 5),
	('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0001-000000000002', 5);

-- m3: Required wins sole (2 vs 7)
INSERT INTO matches (id, date, game_id) VALUES ('00000000-0000-0000-0003-000000000003', '2026-08-03T18:00:00Z', '00000000-0000-0000-0002-000000000001');
INSERT INTO match_scores (match_id, player_id, score) VALUES
	('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0001-000000000001', 2),
	('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0001-000000000002', 7);

-- M1: target Target, required Required; resolved yes (Target sole winner).
INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, created_at, resolved_at, resolution_match_id, resolution_outcome, liquidity_b, q_yes, q_no)
VALUES ('00000000-0000-0000-0004-000000000001', 'match_winner', 'resolved', '2026-08-01T00:00:00Z', '2026-08-31T00:00:00Z', '00000000-0000-0000-0000-0000000000aa', '2026-08-01T10:00:00Z', '2026-08-01T18:00:00Z', '00000000-0000-0000-0003-000000000001', 'yes', 16, 2, 1);
INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
VALUES ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0001-000000000001', ARRAY['00000000-0000-0000-0001-000000000002']::uuid[], '{}'::uuid[]);
-- target bet yes (won: 2 winning shares), required bet no (lost).
INSERT INTO bets (id, market_id, player_id, outcome, cost, shares, placed_at) VALUES
	('00000000-0000-0000-0005-000000000001', '00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0001-000000000001', 'yes', 0.9, 2, '2026-08-01T12:00:00Z'),
	('00000000-0000-0000-0005-000000000002', '00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0001-000000000002', 'no', 0.8, 1, '2026-08-01T12:30:00Z');
INSERT INTO market_guarantors (market_id, player_id) VALUES ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0001-000000000003');

-- M2: same params; resolved yes via TIE (old rule: target score >= max).
INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, created_at, resolved_at, resolution_match_id, resolution_outcome, liquidity_b, q_yes, q_no)
VALUES ('00000000-0000-0000-0004-000000000002', 'match_winner', 'resolved', '2026-08-02T00:00:00Z', '2026-08-31T00:00:00Z', '00000000-0000-0000-0000-0000000000aa', '2026-08-02T10:00:00Z', '2026-08-02T18:00:00Z', '00000000-0000-0000-0003-000000000002', 'yes', 16, 3, 2);
INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
VALUES ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0001-000000000001', ARRAY['00000000-0000-0000-0001-000000000002']::uuid[], '{}'::uuid[]);
-- target bet yes (won historically: 3 shares), required bet no (lost).
INSERT INTO bets (id, market_id, player_id, outcome, cost, shares, placed_at) VALUES
	('00000000-0000-0000-0005-000000000003', '00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0001-000000000001', 'yes', 1.2, 3, '2026-08-02T12:00:00Z'),
	('00000000-0000-0000-0005-000000000004', '00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0001-000000000002', 'no', 1.0, 2, '2026-08-02T12:30:00Z');
INSERT INTO market_guarantors (market_id, player_id) VALUES ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0001-000000000003');

-- M3: same params; resolved no (Required, a required player, won sole).
INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, created_at, resolved_at, resolution_match_id, resolution_outcome, liquidity_b, q_yes, q_no)
VALUES ('00000000-0000-0000-0004-000000000003', 'match_winner', 'resolved', '2026-08-03T00:00:00Z', '2026-08-31T00:00:00Z', '00000000-0000-0000-0000-0000000000aa', '2026-08-03T10:00:00Z', '2026-08-03T18:00:00Z', '00000000-0000-0000-0003-000000000003', 'no', 16, 1, 4);
INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
VALUES ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0001-000000000001', ARRAY['00000000-0000-0000-0001-000000000002']::uuid[], '{}'::uuid[]);
-- target bet yes (lost), required bet no (won historically: 4 shares).
INSERT INTO bets (id, market_id, player_id, outcome, cost, shares, placed_at) VALUES
	('00000000-0000-0000-0005-000000000005', '00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0001-000000000001', 'yes', 0.7, 1, '2026-08-03T12:00:00Z'),
	('00000000-0000-0000-0005-000000000006', '00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0001-000000000002', 'no', 1.5, 4, '2026-08-03T12:30:00Z');
INSERT INTO market_guarantors (market_id, player_id) VALUES ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0001-000000000003');

-- M4: cancelled market with one bet per side.
INSERT INTO markets (id, market_type, status, starts_at, closes_at, created_by, created_at, resolved_at, resolution_match_id, resolution_outcome, liquidity_b, q_yes, q_no)
VALUES ('00000000-0000-0000-0004-000000000004', 'match_winner', 'cancelled', '2026-08-04T00:00:00Z', '2026-08-31T00:00:00Z', '00000000-0000-0000-0000-0000000000aa', '2026-08-04T10:00:00Z', '2026-08-31T00:00:00Z', NULL, 'cancelled', 16, 1, 1);
INSERT INTO market_match_winner_params (market_id, target_player_id, required_player_ids, game_ids)
VALUES ('00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0001-000000000001', ARRAY['00000000-0000-0000-0001-000000000002']::uuid[], '{}'::uuid[]);
INSERT INTO bets (id, market_id, player_id, outcome, cost, shares, placed_at) VALUES
	('00000000-0000-0000-0005-000000000007', '00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0001-000000000001', 'yes', 0.5, 1, '2026-08-04T12:00:00Z'),
	('00000000-0000-0000-0005-000000000008', '00000000-0000-0000-0004-000000000004', '00000000-0000-0000-0001-000000000002', 'no', 0.5, 1, '2026-08-04T12:30:00Z');
`
	if _, err := pool.Exec(ctx, seed); err != nil {
		t.Fatalf("seed legacy data: %v", err)
	}

	// --- Apply migration 041 --------------------------------------------------

	if err := migrator.Migrate(41); err != nil {
		t.Fatalf("migrate to version 41: %v", err)
	}

	// --- Assertions -----------------------------------------------------------

	type outcomeRow struct {
		id       string
		kind     string
		playerID *string
		q        float64
	}
	marketOutcomes := func(t *testing.T, marketID string) []outcomeRow {
		t.Helper()
		rows, err := pool.Query(ctx, `SELECT id, kind, player_id, q FROM market_outcomes WHERE market_id = $1`, marketID)
		if err != nil {
			t.Fatalf("query outcomes: %v", err)
		}
		defer rows.Close()
		var out []outcomeRow
		for rows.Next() {
			var o outcomeRow
			if err := rows.Scan(&o.id, &o.kind, &o.playerID, &o.q); err != nil {
				t.Fatalf("scan outcome: %v", err)
			}
			out = append(out, o)
		}
		return out
	}
	outcomeIDByPlayer := func(t *testing.T, outcomes []outcomeRow, playerID string) string {
		t.Helper()
		for _, o := range outcomes {
			if o.kind == "player" && o.playerID != nil && *o.playerID == playerID {
				return o.id
			}
		}
		t.Fatalf("no player outcome for %s", playerID)
		return ""
	}
	otherOutcomeID := func(t *testing.T, outcomes []outcomeRow) string {
		t.Helper()
		for _, o := range outcomes {
			if o.kind == "other" {
				return o.id
			}
		}
		t.Fatalf("no other outcome")
		return ""
	}

	const (
		pTarget   = "00000000-0000-0000-0001-000000000001"
		pRequired = "00000000-0000-0000-0001-000000000002"
		m1        = "00000000-0000-0000-0004-000000000001"
		m2        = "00000000-0000-0000-0004-000000000002"
		m3        = "00000000-0000-0000-0004-000000000003"
		m4        = "00000000-0000-0000-0004-000000000004"
		match1    = "00000000-0000-0000-0003-000000000001"
		match2    = "00000000-0000-0000-0003-000000000002"
		match3    = "00000000-0000-0000-0003-000000000003"
	)

	// Params restructured: targets = required + target, allow_other_players = true.
	var targets []string
	var allowOther bool
	if err := pool.QueryRow(ctx, `SELECT target_player_ids, allow_other_players FROM market_match_winner_params WHERE market_id = $1`, m1).Scan(&targets, &allowOther); err != nil {
		t.Fatalf("read migrated params: %v", err)
	}
	if len(targets) != 2 || !allowOther {
		t.Fatalf("migrated params: targets=%v allow_other=%v, want both players and true", targets, allowOther)
	}

	// Every market has both player outcomes plus "other"; q = share sums.
	for _, marketID := range []string{m1, m2, m3, m4} {
		outs := marketOutcomes(t, marketID)
		if len(outs) != 3 {
			t.Fatalf("market %s: expected 3 outcomes, got %d", marketID, len(outs))
		}
	}

	// M1: player outcome won; yes-bet followed it, no-bet went to other.
	outs1 := marketOutcomes(t, m1)
	var m1Resolution *string
	var m1StartsAt, m1ClosesAt time.Time
	if err := pool.QueryRow(ctx, `SELECT resolution_outcome, starts_at, closes_at FROM markets WHERE id = $1`, m1).
		Scan(&m1Resolution, &m1StartsAt, &m1ClosesAt); err != nil {
		t.Fatalf("read m1: %v", err)
	}
	if m1Resolution == nil || *m1Resolution != outcomeIDByPlayer(t, outs1, pTarget) {
		t.Errorf("M1 resolution_outcome = %v, want Target's player outcome", m1Resolution)
	}
	// Window pinned to the resolution match date.
	var match1Date time.Time
	if err := pool.QueryRow(ctx, `SELECT date FROM matches WHERE id = $1`, match1).Scan(&match1Date); err != nil {
		t.Fatalf("read match1 date: %v", err)
	}
	if !m1StartsAt.Equal(match1Date) || !m1ClosesAt.Equal(match1Date) {
		t.Errorf("M1 window not pinned: [%v, %v], want match date %v", m1StartsAt, m1ClosesAt, match1Date)
	}
	betOutcome := func(t *testing.T, betID string) string {
		t.Helper()
		var o string
		if err := pool.QueryRow(ctx, `SELECT outcome FROM bets WHERE id = $1`, betID).Scan(&o); err != nil {
			t.Fatalf("read bet %s: %v", betID, err)
		}
		return o
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000001"); got != *m1Resolution {
		t.Errorf("M1 yes-bet mapped to %s, want the winning player outcome %s", got, *m1Resolution)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000002"); got != otherOutcomeID(t, outs1) {
		t.Errorf("M1 no-bet mapped to %s, want other", got)
	}

	// M2: tie → "other" won; yes-bet (historical winner) followed other,
	// no-bet (historical loser) went to the old target's outcome.
	outs2 := marketOutcomes(t, m2)
	var m2Resolution *string
	if err := pool.QueryRow(ctx, `SELECT resolution_outcome FROM markets WHERE id = $1`, m2).Scan(&m2Resolution); err != nil {
		t.Fatalf("read m2: %v", err)
	}
	if m2Resolution == nil || *m2Resolution != otherOutcomeID(t, outs2) {
		t.Fatalf("M2 resolution_outcome = %v, want other (tie)", m2Resolution)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000003"); got != otherOutcomeID(t, outs2) {
		t.Errorf("M2 yes-bet mapped to %s, want other (preserves its historical win)", got)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000004"); got != outcomeIDByPlayer(t, outs2, pTarget) {
		t.Errorf("M2 no-bet mapped to %s, want Target's outcome (preserves its historical loss)", got)
	}
	_ = match2

	// M3: required player won sole → that player's outcome won; the historical
	// no-winner followed it, the yes-loser went to other.
	outs3 := marketOutcomes(t, m3)
	var m3Resolution *string
	if err := pool.QueryRow(ctx, `SELECT resolution_outcome FROM markets WHERE id = $1`, m3).Scan(&m3Resolution); err != nil {
		t.Fatalf("read m3: %v", err)
	}
	wantWinner := outcomeIDByPlayer(t, outs3, pRequired)
	if m3Resolution == nil || *m3Resolution != wantWinner {
		t.Fatalf("M3 resolution_outcome = %v, want Required's outcome %s", m3Resolution, wantWinner)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000006"); got != wantWinner {
		t.Errorf("M3 no-bet (historical winner) mapped to %s, want %s", got, wantWinner)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000005"); got != otherOutcomeID(t, outs3) {
		t.Errorf("M3 yes-bet (historical loser) mapped to %s, want other", got)
	}
	_ = match3

	// M4: cancelled → resolution_outcome NULL; yes-bet on the old target's
	// outcome, no-bet on other (display only).
	outs4 := marketOutcomes(t, m4)
	var m4Resolution *string
	if err := pool.QueryRow(ctx, `SELECT resolution_outcome FROM markets WHERE id = $1`, m4).Scan(&m4Resolution); err != nil {
		t.Fatalf("read m4: %v", err)
	}
	if m4Resolution != nil {
		t.Errorf("M4 (cancelled) resolution_outcome = %v, want NULL", *m4Resolution)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000007"); got != outcomeIDByPlayer(t, outs4, pTarget) {
		t.Errorf("M4 yes-bet mapped to %s, want Target's outcome", got)
	}
	if got := betOutcome(t, "00000000-0000-0000-0005-000000000008"); got != otherOutcomeID(t, outs4) {
		t.Errorf("M4 no-bet mapped to %s, want other", got)
	}

	// q = outstanding share sums per outcome (M2: other holds the yes-bet's 3
	// shares, Target's outcome holds the no-bet's 2 shares).
	qOf := func(t *testing.T, outcomes []outcomeRow, pick func(o outcomeRow) bool) float64 {
		t.Helper()
		for _, o := range outcomes {
			if pick(o) {
				return o.q
			}
		}
		t.Fatalf("outcome not found")
		return 0
	}
	if got := qOf(t, outs2, func(o outcomeRow) bool { return o.kind == "other" }); got != 3 {
		t.Errorf("M2 other q = %v, want 3", got)
	}
	if got := qOf(t, outs2, func(o outcomeRow) bool { return o.kind == "player" && o.playerID != nil && *o.playerID == pTarget }); got != 2 {
		t.Errorf("M2 player q = %v, want 2", got)
	}

	// --- Replay safety: re-settling pays the historically winning bets -------

	marketSvc := elo.NewMarketService(pool)
	q := db.New(pool)

	for _, tc := range []struct {
		marketID string
		matchID  string
	}{
		{m1, match1},
		{m2, match2},
		{m3, match3},
	} {
		m, err := q.GetMarket(ctx, tc.marketID)
		if err != nil {
			t.Fatalf("GetMarket %s: %v", tc.marketID, err)
		}
		if err := q.DeleteGlobalArenaSettlementByMarket(ctx, &tc.marketID); err != nil {
			t.Fatalf("delete settlements %s: %v", tc.marketID, err)
		}
		resMatchID := m.ResolutionMatchID
		if err := marketSvc.SettleMarket(ctx, q, tc.marketID, elo.MarketOutcome(*m.ResolutionOutcome), m.ResolvedAt.Time, resMatchID); err != nil {
			t.Fatalf("re-settle %s: %v", tc.marketID, err)
		}
	}

	earnedByPlayerMarket := func(playerID, marketID string) float64 {
		var earned float64
		if err := pool.QueryRow(ctx,
			`SELECT COALESCE(SUM(elo_earned), 0) FROM global_arena_settlement WHERE market_id = $1 AND player_id = $2 AND discriminator = 'market'`,
			marketID, playerID).Scan(&earned); err != nil {
			t.Fatalf("read earned for %s on %s: %v", playerID, marketID, err)
		}
		return earned
	}
	// M1: yes-winner keeps 2 shares paid; loser earns 0.
	if got := earnedByPlayerMarket(pTarget, m1); got != 2 {
		t.Errorf("M1 re-settlement: Target earned %v, want 2 (historical payout preserved)", got)
	}
	if got := earnedByPlayerMarket(pRequired, m1); got != 0 {
		t.Errorf("M1 re-settlement: Required earned %v, want 0", got)
	}
	// M2 (tie): historical yes-winner still wins 3; historical no-loser still 0.
	if got := earnedByPlayerMarket(pTarget, m2); got != 3 {
		t.Errorf("M2 re-settlement: Target earned %v, want 3 (tie case preserves payouts)", got)
	}
	if got := earnedByPlayerMarket(pRequired, m2); got != 0 {
		t.Errorf("M2 re-settlement: Required earned %v, want 0", got)
	}
	// M3: historical no-winner still wins 4; yes-loser still 0.
	if got := earnedByPlayerMarket(pRequired, m3); got != 4 {
		t.Errorf("M3 re-settlement: Required earned %v, want 4", got)
	}
	if got := earnedByPlayerMarket(pTarget, m3); got != 0 {
		t.Errorf("M3 re-settlement: Target earned %v, want 0", got)
	}
}
