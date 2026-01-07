package db

import (
	"fmt"
	"log"

	"github.com/jmoiron/sqlx"
)

// ExampleInsertAndQuery demonstrates a simple insert and select against the
// example table created by the migration.
func ExampleInsertAndQuery(db *sqlx.DB) error {
	// Insert
	res, err := db.Exec(`INSERT INTO example_players (name, score) VALUES ($1, $2)`, "Alice", 1200)
	if err != nil {
		return fmt.Errorf("insert failed: %w", err)
	}
	rowsAffected, _ := res.RowsAffected()
	log.Printf("insert rows affected: %d", rowsAffected)

	// Query into struct
	var player struct {
		ID    int    `db:"id"`
		Name  string `db:"name"`
		Score int    `db:"score"`
	}
	if err := db.Get(&player, `SELECT id, name, score FROM example_players WHERE name = $1 LIMIT 1`, "Alice"); err != nil {
		return fmt.Errorf("query failed: %w", err)
	}
	log.Printf("got player: id=%d name=%s score=%d", player.ID, player.Name, player.Score)
	return nil
}
