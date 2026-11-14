// Package id defines the two representations of an entity identifier and the
// conversions between them.
//
//   - ID is the canonical UUID string used inside Go services and Postgres.
//   - Base58ID is the wire form: the UUID's 16 bytes encoded as Base58
//     (Bitcoin alphabet, no 0/O/I/l), ~22 chars (e.g. CB83kiayfV3yUWvyEQtES),
//     used in JSON bodies and URLs so identifiers users see stay short.
//
// ID's JSON hooks make the conversion structural: every struct field typed ID
// marshals to its Base58 form and unmarshals from either form, regardless of
// the field's name. This replaces the old idcodec middleware, which rewrote
// values under keys matching an `*_id` naming pattern (ADR-12).
package id

import (
	crand "crypto/rand"
	"database/sql/driver"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ID is a canonical UUID string (e.g. 018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f).
// This is the representation used inside Go and stored in Postgres; on the
// wire it carries its Base58 form via the JSON hooks below.
type ID string

// Base58ID is the wire form of an ID.
type Base58ID string

// New returns a new client-style ID: a time-ordered UUIDv7.
func New() ID {
	u, err := uuid.NewV7()
	if err != nil {
		panic(err) // uuid.NewV7 only fails on a broken entropy source
	}
	return ID(u.String())
}

// Monotonic UUIDv7 state. Two ids minted in the same millisecond by New()
// order randomly (the non-timestamp bits are random), which is fine for entity
// ids but wrong for settlement rows: the rating queries tie-break equal
// settlement dates by (date, id DESC), so the id must order by creation time
// even within one millisecond.
var (
	monoMu      sync.Mutex
	monoMS      int64 = math.MinInt64
	monoCounter uint64
	monoPrefix  uint16
	monoSeeded  bool
)

// NewMonotonic returns a UUIDv7 that sorts strictly after every id previously
// returned by this function in this process, even within the same millisecond:
// the 12 random bits after the version field carry a per-process prefix, and
// the trailing 62 bits are a monotonically increasing counter (RFC 9562
// "monotonic counter" method). A clock regression is clamped to the last
// timestamp so the ordering guarantee survives NTP adjustments.
func NewMonotonic() ID {
	monoMu.Lock()
	defer monoMu.Unlock()
	if !monoSeeded {
		var b [2]byte
		if _, err := crand.Read(b[:]); err != nil {
			panic(err) // broken entropy source, same failure mode as uuid.NewV7
		}
		monoPrefix = binary.BigEndian.Uint16(b[:]) & 0x0FFF
		monoSeeded = true
	}

	ms := time.Now().UnixMilli()
	if ms <= monoMS {
		ms = monoMS
		monoCounter++
	} else {
		monoMS = ms
		monoCounter = 0
	}

	var b [16]byte
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	b[6] = 0x70 | byte(monoPrefix>>8) // version 7
	b[7] = byte(monoPrefix)
	b[8] = 0x80 | byte(monoCounter>>56) // RFC 4122 variant
	b[9] = byte(monoCounter >> 48)
	b[10] = byte(monoCounter >> 40)
	b[11] = byte(monoCounter >> 32)
	b[12] = byte(monoCounter >> 24)
	b[13] = byte(monoCounter >> 16)
	b[14] = byte(monoCounter >> 8)
	b[15] = byte(monoCounter)
	return ID(uuid.UUID(b).String())
}

// Parse parses a canonical UUID string into an ID.
func Parse(s string) (ID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return "", fmt.Errorf("id: parse %q: %w", s, err)
	}
	return ID(u.String()), nil
}

// ParseTolerant parses either the Base58 wire form or a canonical UUID,
// returning the canonical ID; the empty string parses to the zero ID. This is
// the inbound conversion for anything crossing the API boundary, keeping
// legacy canonical-form links working (ADR-07). Unlike the old middleware it
// rejects any other string, so a malformed id fails here with a clear error
// instead of as a "row not found" deep inside a query.
func ParseTolerant(s string) (ID, error) {
	if s == "" {
		return "", nil
	}
	if u, err := uuid.Parse(s); err == nil {
		return ID(u.String()), nil
	}
	if decoded, err := base58Decode(s); err == nil {
		return ID(decoded), nil
	}
	return "", fmt.Errorf("id: %q is neither a canonical UUID nor a Base58 id", s)
}

// Base58 returns the wire form of the id. Values that are not canonical UUIDs
// (only possible through Go-side mistakes) pass through unchanged, matching
// the tolerant outbound behavior of the old middleware.
func (id ID) Base58() Base58ID {
	s := string(id)
	if s == "" {
		return ""
	}
	if encoded, err := base58Encode(s); err == nil {
		return Base58ID(encoded)
	}
	return Base58ID(s)
}

// CanonicalizeTolerant returns the canonical UUID form of s if s is a
// canonical UUID or a valid Base58 id; any other string is returned unchanged.
// This string-level bridge exists for code that walks raw JSON documents
// (calculator migrators); typed code should use ParseTolerant instead.
func CanonicalizeTolerant(s string) string {
	if parsed, err := ParseTolerant(s); err == nil {
		return string(parsed)
	}
	return s
}

// ToBase58 returns the Base58 wire form of s if s is a canonical UUID;
// any other string is returned unchanged. String-level bridge for raw-JSON
// walkers; typed code should use ID.Base58 instead.
func ToBase58(s string) string {
	return string(ID(s).Base58())
}

// Canonical returns the canonical form of the wire id, accepting either form.
func (b Base58ID) Canonical() (ID, error) {
	return ParseTolerant(string(b))
}

// IsZero reports whether the id is the empty zero value.
func (id ID) IsZero() bool { return id == "" }

// UUID returns the id as a uuid.UUID.
func (id ID) UUID() (uuid.UUID, error) { return uuid.Parse(string(id)) }

// String returns the canonical form.
func (id ID) String() string { return string(id) }

// String returns the wire form.
func (b Base58ID) String() string { return string(b) }

// MarshalJSON encodes the id in its short Base58 wire form, so response DTOs
// built with canonical ids emit short ids with no field-name-dependent
// rewriting at the HTTP layer.
func (id ID) MarshalJSON() ([]byte, error) {
	return json.Marshal(string(id.Base58()))
}

// UnmarshalJSON accepts either the Base58 wire form or a canonical UUID and
// stores the canonical form. Malformed strings are an error, which surfaces
// as a 400 at request-parse time.
func (id *ID) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("id: %w", err)
	}
	parsed, err := ParseTolerant(s)
	if err != nil {
		return err
	}
	*id = parsed
	return nil
}

// Scan implements sql.Scanner so ID works as a scan target for Postgres uuid
// columns (pgx v5 wraps types implementing sql.Scanner transparently).
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

// Value implements driver.Valuer so ID encodes as its canonical string form.
func (id ID) Value() (driver.Value, error) {
	return string(id), nil
}

func parseUUIDBytes(s string) ([16]byte, bool) {
	var raw [16]byte
	u, err := uuid.Parse(s)
	if err != nil {
		return raw, false
	}
	copy(raw[:], u[:])
	return raw, true
}

func formatUUID(raw [16]byte) string {
	u, err := uuid.FromBytes(raw[:])
	if err != nil { // unreachable: raw is always 16 bytes
		return ""
	}
	return u.String()
}
