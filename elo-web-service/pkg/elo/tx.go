package elo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

// runInTx begins a transaction on pool, runs fn with a *db.Queries bound to that
// transaction, and commits on success. The deferred rollback is a no-op once the
// transaction has been committed. This is the project's canonical transaction
// shape; use it for new code instead of open-coding Begin/Rollback/Commit.
//
// Note: the existing services predate this helper and several have multi-step
// control flow (early returns, nested conditionals) that don't fit the single-
// callback shape, so they still open-code their transactions. Prefer this helper
// for new, linear transactional methods.
func runInTx(ctx context.Context, pool *pgxpool.Pool, fn func(q *db.Queries) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := fn(db.New(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
