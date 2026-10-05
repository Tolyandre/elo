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
// The remaining open-coded transactions (PlaceBet, JoinAsGuarantee) have
// post-commit broadcasts that need several in-tx variables — returning them
// through the callback would need a bundle struct that costs more than the
// explicit tx.
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

// runInTxResult is runInTx for linear transactional flows that produce a value.
func runInTxResult[T any](ctx context.Context, pool *pgxpool.Pool, fn func(q *db.Queries) (T, error)) (T, error) {
	var out T
	err := runInTx(ctx, pool, func(q *db.Queries) error {
		var err error
		out, err = fn(q)
		return err
	})
	return out, err
}
