package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/calculator"
)

func init() {
	// Wire the real data-migration runner. Invoked from MigrateCalculatorData
	// (see migrations.go) after the SQL schema migration in every startup mode.
	//
	// The market data migrations (the pre-LMSR share backfill of ADR-10 and the
	// n-outcome remap of ADR-11) completed at their deploy dates and were
	// removed; the n-outcome conversion lives in SQL migration 041 because sqlc
	// compiles queries against the post-migration schema.
	MigrateDataRunner = runDataMigrations
}

// runDataMigrations applies every in-process data migration family: calculator
// documents (ADR-09), audit details documents (ADR-14), tournament plan
// documents (ADR-30) and arena settings documents (ADR-24). Each family
// is a no-op when nothing is out of date.
func runDataMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	migrations := make([]documentMigration, 0)
	// Kinded families get one pass per registered kind: kinds without
	// migrators skip the table scan entirely.
	for _, kind := range calculator.Kinds() {
		if !calculator.HasMigrators(kind) {
			continue
		}
		migrations = append(migrations, documentMigrateCalculator(kind))
	}
	for _, kind := range audit.Kinds() {
		if !audit.HasMigrators(kind) {
			continue
		}
		migrations = append(migrations, documentMigrateAudit(kind))
	}
	migrations = append(migrations, documentMigratePlans(), documentMigrateArenaSettings())

	for _, m := range migrations {
		if err := runDocumentMigration(ctx, pool, m); err != nil {
			return err
		}
	}
	return nil
}

// PlanSchemaVersion is exported for the tournament-start write path, which
// stores every freshly canonicalized plan at the current version.
const PlanSchemaVersion = 2

// documentMigration describes one versioned-document column family. Every
// family shares the same runner shape: select stale rows, upgrade each row via
// migrate, persist it in its own transaction (a single corrupt row cannot roll
// back an entire batch), re-read and re-validate the persisted form to catch a
// migrator that wrote a structurally-invalid document. Any error is fatal for
// startup, mirroring SQL schema migration failures. A new document family is a
// ~20-line declaration below, not another copy of the loop.
type documentMigration struct {
	// family names the migration in logs and error messages.
	family string
	// query selects stale rows as (id, version, document[, kind]).
	query  string
	args   []any // filter arguments for query (e.g. current version; kind first)
	kinded bool  // rows carry a kind column (selected last)
	// migrate upgrades one row; kind is empty for unkinded families.
	migrate func(kind string, fromVersion int, data json.RawMessage) (json.RawMessage, int, error)
	// update rewrites one row: version = $2, document = $3 where id = $1.
	update string
	// reread re-selects (kind,) document for the post-write validation; when
	// validate is nil the row is not re-read (families without a registry).
	reread   string
	validate func(kind string, data json.RawMessage) error
}

// staleRow is one row selected for upgrade.
type staleRow struct {
	ID      string
	Version int32
	Data    []byte
	Kind    *string
}

func documentMigrateCalculator(kind string) documentMigration {
	current, err := calculator.Lookup(kind)
	if err != nil {
		// Should not happen — kind came from Kinds().
		panic(fmt.Sprintf("calculator migration: lookup kind %q: %v", kind, err))
	}
	return documentMigration{
		family: "calculator migration",
		// One pass per registered kind so the version filter can use the index.
		query: `
			SELECT id, calculator_schema_version, calculator_data, calculator_kind
			FROM matches
			WHERE calculator_kind = $1 AND calculator_schema_version < $2
		`,
		args:   []any{kind, current.CurrentVersion},
		kinded: true,
		migrate: func(kind string, fromVersion int, data json.RawMessage) (json.RawMessage, int, error) {
			return calculator.MigrateData(kind, fromVersion, data)
		},
		update: `
			UPDATE matches
			SET calculator_schema_version = $2, calculator_data = $3
			WHERE id = $1
		`,
		reread: `SELECT calculator_kind, calculator_data FROM matches WHERE id = $1`,
		validate: func(kind string, data json.RawMessage) error {
			if kind == "" {
				return nil
			}
			return calculator.Validate(kind, data)
		},
	}
}

func documentMigrateAudit(kind string) documentMigration {
	current, err := audit.Lookup(kind)
	if err != nil {
		// Should not happen — kind came from Kinds().
		panic(fmt.Sprintf("audit migration: lookup kind %q: %v", kind, err))
	}
	return documentMigration{
		family: "audit migration",
		query: `
			SELECT id, details_schema_version, details, details_kind
			FROM audit_log
			WHERE details_kind = $1 AND details_schema_version < $2
		`,
		args:   []any{kind, current.CurrentVersion},
		kinded: true,
		migrate: func(kind string, fromVersion int, data json.RawMessage) (json.RawMessage, int, error) {
			return audit.MigrateData(kind, fromVersion, data)
		},
		update: `
			UPDATE audit_log
			SET details_schema_version = $2, details = $3
			WHERE id = $1
		`,
		reread: `SELECT details_kind, details FROM audit_log WHERE id = $1`,
		validate: func(kind string, data json.RawMessage) error {
			if kind == "" {
				return nil
			}
			return audit.Validate(kind, data)
		},
	}
}

// documentMigratePlans rewrites stored tournament plans from v1 (rounds
// carrying "promote") to v2 ("advance", ADR-30). A plain JSON key rename —
// plan documents are validated and canonicalized on write, so a stored plan is
// always well-formed and the rename cannot lose information.
func documentMigratePlans() documentMigration {
	return documentMigration{
		family: "plan migration",
		query: `
			SELECT id, plan_schema_version, plan
			FROM tournaments
			WHERE plan IS NOT NULL AND plan_schema_version < $1
		`,
		args: []any{PlanSchemaVersion},
		migrate: func(_ string, _ int, data json.RawMessage) (json.RawMessage, int, error) {
			var doc struct {
				Rounds []map[string]any `json:"rounds"`
			}
			if err := json.Unmarshal(data, &doc); err != nil {
				return nil, 0, err
			}
			for _, round := range doc.Rounds {
				if v, ok := round["promote"]; ok {
					delete(round, "promote")
					round["advance"] = v
				}
			}
			upgraded, err := json.Marshal(doc)
			if err != nil {
				return nil, 0, err
			}
			return upgraded, PlanSchemaVersion, nil
		},
		update: `
			UPDATE tournaments
			SET plan_schema_version = $2, plan = $3
			WHERE id = $1
		`,
		// Plans have no schema registry, but the typed parser rejects
		// malformed structures — enough for the same post-write
		// belt-and-suspenders the registry families get.
		reread: `SELECT plan FROM tournaments WHERE id = $1`,
		validate: func(_ string, data json.RawMessage) error {
			_, err := bracket.ParsePlan(data)
			return err
		},
	}
}

func documentMigrateArenaSettings() documentMigration {
	return documentMigration{
		family: "arena settings migration",
		query: `
			SELECT id, settings_schema_version, settings
			FROM arenas
			WHERE settings_schema_version < $1
		`,
		args: []any{arenasettings.CurrentVersion},
		migrate: func(_ string, fromVersion int, data json.RawMessage) (json.RawMessage, int, error) {
			return arenasettings.MigrateData(fromVersion, data)
		},
		update: `
			UPDATE arenas
			SET settings_schema_version = $2, settings = $3
			WHERE id = $1
		`,
		reread: `SELECT settings FROM arenas WHERE id = $1`,
		validate: func(_ string, data json.RawMessage) error {
			return arenasettings.Validate(data)
		},
	}
}

// runDocumentMigration upgrades every stale row of one family. Each row is
// upgraded in its own transaction so a single corrupt row cannot roll back an
// entire batch; on any error the error propagates (fatal for startup).
func runDocumentMigration(ctx context.Context, pool *pgxpool.Pool, m documentMigration) error {
	rows, err := pool.Query(ctx, m.query, m.args...)
	if err != nil {
		return fmt.Errorf("%s: query stale rows: %w", m.family, err)
	}
	defer rows.Close()

	stale := make([]staleRow, 0)
	for rows.Next() {
		var r staleRow
		if m.kinded {
			if err := rows.Scan(&r.ID, &r.Version, &r.Data, &r.Kind); err != nil {
				return fmt.Errorf("%s: scan row: %w", m.family, err)
			}
		} else if err := rows.Scan(&r.ID, &r.Version, &r.Data); err != nil {
			return fmt.Errorf("%s: scan row: %w", m.family, err)
		}
		stale = append(stale, r)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("%s: iterate rows: %w", m.family, err)
	}
	if len(stale) == 0 {
		return nil
	}

	log.Printf("%s: upgrading %d rows from older versions", m.family, len(stale))
	for _, r := range stale {
		kind := ""
		if r.Kind != nil {
			kind = *r.Kind
		}
		newData, newVersion, err := m.migrate(kind, int(r.Version), r.Data)
		if err != nil {
			return fmt.Errorf("%s: migrate %s: %w", m.family, r.ID, err)
		}
		if newVersion == int(r.Version) {
			continue // no-op
		}
		if err := persistUpgradedRow(ctx, pool, m, r.ID, kind, newVersion, newData); err != nil {
			return fmt.Errorf("%s: update %s: %w", m.family, r.ID, err)
		}
		log.Printf("%s: %s v%d→v%d", m.family, r.ID, r.Version, newVersion)
	}
	return nil
}

// persistUpgradedRow writes one upgraded row in its own transaction and
// re-validates the persisted form, catching a migrator that produced a
// structurally-invalid document before the transaction commits.
func persistUpgradedRow(ctx context.Context, pool *pgxpool.Pool, m documentMigration, rowID, kind string, version int, data json.RawMessage) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, m.update, rowID, version, []byte(data)); err != nil {
		return err
	}
	if m.validate != nil {
		var storedKind *string
		var stored []byte
		if m.kinded {
			if err := tx.QueryRow(ctx, m.reread, rowID).Scan(&storedKind, &stored); err != nil {
				return fmt.Errorf("re-read: %w", err)
			}
			if storedKind != nil {
				kind = *storedKind
			}
		} else if err := tx.QueryRow(ctx, m.reread, rowID).Scan(&stored); err != nil {
			return fmt.Errorf("re-read: %w", err)
		}
		// MigrateData already validated before the write, so this is
		// belt-and-suspenders. Skip if there is nothing to validate.
		if len(stored) > 0 {
			if err := m.validate(kind, stored); err != nil {
				return fmt.Errorf("post-write validation: %w", err)
			}
		}
	}
	return tx.Commit(ctx)
}
