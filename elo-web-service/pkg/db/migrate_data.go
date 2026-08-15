package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/calculator"
)

func init() {
	// Wire the real data-migration runner. Invoked from MigrateCalculatorData
	// (see migrations.go) after the SQL schema migration in every startup mode.
	MigrateDataRunner = func(ctx context.Context, pool *pgxpool.Pool) error {
		if err := migrateCalculatorData(ctx, pool); err != nil {
			return err
		}
		return migrateMarketShares(ctx, pool)
	}
}

// migrateCalculatorData walks every match whose calculator_schema_version is
// behind the current version for its kind, applies the registered migrators,
// and writes the upgraded document back. Each row is upgraded in its own
// transaction so a single corrupt row cannot roll back an entire batch.
//
// On any error this function returns a non-nil error, which main treats as
// fatal (the application refuses to start) — mirroring how SQL schema
// migration failures are handled.
func migrateCalculatorData(ctx context.Context, pool *pgxpool.Pool) error {
	for _, kind := range calculator.Kinds() {
		schema, err := calculator.Lookup(kind)
		if err != nil {
			// Should not happen — kind came from Kinds().
			return fmt.Errorf("lookup kind %q: %w", kind, err)
		}
		if err := migrateKind(ctx, pool, kind, schema.CurrentVersion); err != nil {
			return fmt.Errorf("kind %q: %w", kind, err)
		}
	}
	return nil
}

func migrateKind(ctx context.Context, pool *pgxpool.Pool, kind string, currentVersion int) error {
	// No migrators for this kind → nothing to do. (Saves a table scan.)
	if !calculator.HasMigrators(kind) {
		return nil
	}

	rows, err := pool.Query(ctx, `
		SELECT id, calculator_schema_version, calculator_data
		FROM matches
		WHERE calculator_kind = $1 AND calculator_schema_version < $2
	`, kind, currentVersion)
	if err != nil {
		return fmt.Errorf("query stale rows: %w", err)
	}
	defer rows.Close()

	stale := make([]staleCalculatorRow, 0)
	for rows.Next() {
		var r staleCalculatorRow
		var version *int32
		if err := rows.Scan(&r.ID, &version, &r.Data); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}
		if version == nil {
			// Defensive: should not happen given the WHERE clause, but CHECK
			// allows NULL only when kind is also NULL — already excluded.
			continue
		}
		r.Kind = kind
		r.SchemaVersion = int(*version)
		stale = append(stale, r)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate rows: %w", err)
	}
	if len(stale) == 0 {
		return nil
	}

	log.Printf("calculator migration: upgrading %d %q rows from older versions", len(stale), kind)
	for _, r := range stale {
		newData, newVersion, err := calculator.MigrateData(r.Kind, r.SchemaVersion, r.Data)
		if err != nil {
			return fmt.Errorf("migrate match %s: %w", r.ID, err)
		}
		if newVersion == r.SchemaVersion {
			continue // no-op
		}
		if err := updateMatchCalculator(ctx, pool, r.ID, newVersion, newData); err != nil {
			return fmt.Errorf("update match %s: %w", r.ID, err)
		}
		log.Printf("calculator migration: match %s %q v%d→v%d", r.ID, r.Kind, r.SchemaVersion, newVersion)
	}
	return nil
}

func updateMatchCalculator(ctx context.Context, pool *pgxpool.Pool, matchID string, version int, data json.RawMessage) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
		UPDATE matches
		SET calculator_schema_version = $2, calculator_data = $3
		WHERE id = $1
	`, matchID, version, []byte(data))
	if err != nil {
		return err
	}
	// Re-serialize to a plain map for validation via the registry (which works
	// on json.RawMessage). We re-validate the persisted form to catch a
	// migrator that wrote a structurally-invalid document.
	if err := validateStored(ctx, tx, matchID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func validateStored(ctx context.Context, tx pgx.Tx, matchID string) error {
	var kind *string
	var data []byte
	if err := tx.QueryRow(ctx, `
		SELECT calculator_kind, calculator_data FROM matches WHERE id = $1
	`, matchID).Scan(&kind, &data); err != nil {
		return fmt.Errorf("re-read: %w", err)
	}
	if kind == nil {
		return nil
	}
	// MigrateData already validated before the write, so this is belt-and-
	// suspenders. Skip if there is nothing to validate.
	if len(data) == 0 {
		return nil
	}
	if err := calculator.Validate(*kind, json.RawMessage(data)); err != nil {
		return fmt.Errorf("post-write validation: %w", err)
	}
	return nil
}

// lmsrDeployCutoff is the instant the fixed-odds share markets (ADR-10) went
// live. Markets created before it are pre-LMSR pari-mutuel markets whose bets
// carry no meaningful shares/AMM state; markets created on/after it hold
// genuine LMSR data and must never be rewritten.
var lmsrDeployCutoff = time.Date(2026, time.August, 14, 0, 0, 0, 0, time.UTC)

// migrateMarketShares backfills bets.shares and the markets AMM state for
// pre-LMSR (pari-mutuel) markets so the historical data looks as if the market
// had genuinely traded under the fixed-odds share model — while keeping the
// historical rating outcomes reproducible byte-for-byte.
//
// The target set is resolved/cancelled markets created before lmsrDeployCutoff
// (ADR-10's deploy precondition guarantees no open/betting_closed ones). The
// backfill simulates the market: the historical bets are replayed through the
// LMSR in their original order, each spending its original amount (amounts are
// never modified), from a fresh q=(0,0). The replay yields realistic
// share counts — prices move bet by bet, and every implied per-bet price
// amount/shares lies in (0,1).
//
// Rating preservation (ADR-10 replay-safety): a recalculation re-running
// SettleMarket over these bets must reproduce the historical pari-mutuel
// payouts exactly, so for resolved markets each player's winning-side share
// total is pinned to the pari-mutuel payout amount_win × totalPool/winPool by
// rescaling the replayed shares (the losing side pays 0 and keeps its replay
// shares; cancelled markets refund amounts regardless of shares). The winning
// shares therefore still sum to the total pool — the guarantor residual stays
// 0 and no guarantor rows appear.
//
// Finally q_yes/q_no are set to the outstanding share sums per side — the
// invariant every native LMSR market satisfies — so the displayed prices are
// consistent with the bets and never negative.
//
// The backfill is deterministic (it reads only amount/outcome/placed_at, none
// of which it modifies) and therefore idempotent.
func migrateMarketShares(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx, `
		SELECT id, status, resolution_outcome, liquidity_b
		FROM markets
		WHERE status IN ('resolved', 'cancelled') AND created_at < $1
	`, lmsrDeployCutoff)
	if err != nil {
		return fmt.Errorf("query pre-lmsr markets: %w", err)
	}

	type staleMarket struct {
		ID                string
		Status            string
		ResolutionOutcome *string
		LiquidityB        float64
	}
	stale := make([]staleMarket, 0)
	for rows.Next() {
		var m staleMarket
		if err := rows.Scan(&m.ID, &m.Status, &m.ResolutionOutcome, &m.LiquidityB); err != nil {
			rows.Close()
			return fmt.Errorf("scan market: %w", err)
		}
		stale = append(stale, m)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate markets: %w", err)
	}
	if len(stale) == 0 {
		return nil
	}

	log.Printf("market migration: backfilling shares for %d pre-lmsr markets", len(stale))
	for _, m := range stale {
		// Only binary resolutions pin payouts; anything else (cancelled, or a
		// NULL/unknown outcome) replays freely — refunds and missing winners
		// don't depend on shares.
		winning := ""
		if m.Status == "resolved" && m.ResolutionOutcome != nil &&
			(*m.ResolutionOutcome == "yes" || *m.ResolutionOutcome == "no") {
			winning = *m.ResolutionOutcome
		}
		if err := backfillMarketShares(ctx, pool, m.ID, winning, m.LiquidityB); err != nil {
			return fmt.Errorf("backfill market %s: %w", m.ID, err)
		}
	}
	return nil
}

// backfillMarketShares rewrites one market's bets.shares and AMM state via the
// LMSR replay described on migrateMarketShares. winning is the winning outcome
// ("yes"/"no") whose per-player share totals must reproduce the pari-mutuel
// payouts, or "" when shares are unconstrained.
func backfillMarketShares(ctx context.Context, pool *pgxpool.Pool, marketID, winning string, liquidityB float64) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	betRows, err := tx.Query(ctx, `
		SELECT id, player_id, outcome, cost
		FROM bets WHERE market_id = $1
		ORDER BY placed_at, id
	`, marketID)
	if err != nil {
		return fmt.Errorf("query bets: %w", err)
	}
	type betRow struct {
		ID       string
		PlayerID string
		Outcome  string
		Cost     float64
	}
	bets := make([]betRow, 0)
	for betRows.Next() {
		var b betRow
		if err := betRows.Scan(&b.ID, &b.PlayerID, &b.Outcome, &b.Cost); err != nil {
			betRows.Close()
			return fmt.Errorf("scan bet: %w", err)
		}
		bets = append(bets, b)
	}
	if err := betRows.Err(); err != nil {
		return fmt.Errorf("iterate bets: %w", err)
	}
	if len(bets) == 0 {
		return nil // nothing to replay; q stays at its creation-time 0/0
	}

	b := liquidityB
	if b <= 0 {
		b = 16
	}

	// Replay: each historical bet spends its amount at the current marginal
	// price, buying lmsrSharesForAmount shares; q accumulates the outstanding
	// shares exactly like a native PlaceBet would.
	qYes, qNo := 0.0, 0.0
	shares := make([]float64, len(bets))
	for i, bet := range bets {
		s := lmsrSharesForAmount(qYes, qNo, b, bet.Outcome, bet.Cost)
		shares[i] = s
		if bet.Outcome == "yes" {
			qYes += s
		} else {
			qNo += s
		}
	}

	// Pin the winning side to the historical pari-mutuel payouts: per player,
	// rescale the replayed shares so they total amount_win × totalPool/winPool
	// (computed from amounts only — never from the shares being rewritten — so
	// repeated runs converge to the same values).
	if winning != "" {
		winPool, totalPool := 0.0, 0.0
		amountWin := make(map[string]float64)
		replayWin := make(map[string]float64)
		for i, bet := range bets {
			totalPool += bet.Cost
			if bet.Outcome == winning {
				winPool += bet.Cost
				amountWin[bet.PlayerID] += bet.Cost
				replayWin[bet.PlayerID] += shares[i]
			}
		}
		if winPool > 0 {
			payoutRatio := totalPool / winPool
			factor := make(map[string]float64, len(replayWin))
			for pid, replayed := range replayWin {
				if replayed > 0 {
					factor[pid] = amountWin[pid] * payoutRatio / replayed
				}
			}
			for i, bet := range bets {
				if bet.Outcome == winning {
					shares[i] *= factor[bet.PlayerID]
				}
			}
			// q must equal the outstanding shares, so re-accumulate the side
			// that was rescaled.
			qYes, qNo = 0.0, 0.0
			for i, bet := range bets {
				if bet.Outcome == "yes" {
					qYes += shares[i]
				} else {
					qNo += shares[i]
				}
			}
		}
	}

	for i, bet := range bets {
		if _, err := tx.Exec(ctx, `
			UPDATE bets SET shares = $2::float8 WHERE id = $1
		`, bet.ID, shares[i]); err != nil {
			return fmt.Errorf("update bet shares: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE markets SET q_yes = $2::float8, q_no = $3::float8 WHERE id = $1
	`, marketID, qYes, qNo); err != nil {
		return fmt.Errorf("seed amm state: %w", err)
	}
	return tx.Commit(ctx)
}

// lmsrSharesForAmount inverts the LMSR cost function: it returns the number of
// `outcome` shares that cost exactly `amount` given the current AMM state.
// With p the outcome's marginal price, cost(amount) satisfies
// e^(amount/b) = p·e^(s/b) + (1−p), hence the closed form below. Mirrors the
// math in pkg/elo/amm.go (which pkg/db cannot import — cycle).
func lmsrSharesForAmount(qYes, qNo, b float64, outcome string, amount float64) float64 {
	p := lmsrPrice(qYes, qNo, b, outcome)
	return b * math.Log((math.Exp(amount/b)-1+p)/p)
}

// lmsrPrice returns the marginal price (probability) of `outcome` in (0,1).
// Same log-sum-exp stabilization as pkg/elo/amm.go.
func lmsrPrice(qYes, qNo, b float64, outcome string) float64 {
	uy := qYes / b
	un := qNo / b
	m := math.Max(uy, un)
	ey := math.Exp(uy - m)
	en := math.Exp(un - m)
	if outcome == "yes" {
		return ey / (ey + en)
	}
	return en / (ey + en)
}
