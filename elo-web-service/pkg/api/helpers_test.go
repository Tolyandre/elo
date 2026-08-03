package api

import "testing"

// TestCanonicalizeUserID covers the ADR-08 / migration 036 mapping of a stale
// pre-migration JWT "sub" (a bare SERIAL int) to its backfilled canonical UUID.
func TestCanonicalizeUserID(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		// Legacy SERIAL int ids → deterministic int_to_uuid(n) from migration 036.
		{"legacy int 1", "1", "00000000-0000-0000-0000-000000000001"},
		{"legacy int 42", "42", "00000000-0000-0000-0000-00000000002a"},
		{"legacy int max int32", "2147483647", "00000000-0000-0000-0000-00007fffffff"},

		// Canonical UUIDs pass through unchanged.
		{"canonical uuidv7", "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f", "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"},
		{"backfilled legacy uuid", "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000001"},

		// Neither a UUID nor an int → passed through for downstream rejection.
		{"garbage", "not-an-id", "not-an-id"},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanonicalizeUserID(tt.in); got != tt.want {
				t.Errorf("CanonicalizeUserID(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
