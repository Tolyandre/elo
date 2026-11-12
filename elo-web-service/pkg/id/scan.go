//go:build !(js && wasm)

package id

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Scan implements sql.Scanner so ID works as a scan target for Postgres uuid
// columns (pgx v5 wraps types implementing sql.Scanner transparently).
//
// The pgtype dependency lives in this build-tagged file only: the offline
// client's wasm build (cmd/settlementwasm, ADR-38) links this package but
// never scans from a database, and pgtype's package-level registry would add
// ~1.2 MB to the binary for dead code.
func (id *ID) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*id = ""
	case string:
		*id = ID(v)
	case []byte:
		*id = ID(string(v))
	case [16]byte:
		*id = ID(formatUUID(v))
	case uuid.UUID:
		*id = ID(v.String())
	case pgtype.UUID:
		if !v.Valid {
			*id = ""
		} else {
			*id = ID(formatUUID(v.Bytes))
		}
	default:
		return fmt.Errorf("id: cannot scan %T", src)
	}
	return nil
}
