package id

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestBase58RoundTrip(t *testing.T) {
	t.Parallel()
	cases := []ID{
		"018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f",
		"00000000-0000-0000-0000-000000000001", // legacy int-backed id
		"00000000-0000-0000-0000-0000000000ff", // legacy, larger
		"ffffffff-ffff-ffff-ffff-ffffffffffff", // max
		ID(uuid.Nil.String()),
	}
	for _, want := range cases {
		t.Run(string(want), func(t *testing.T) {
			short := want.Base58()
			if len(short) > 22 {
				t.Errorf("Base58() = %q, want <= 22 chars", short)
			}
			if strings.ContainsAny(string(short), "0OIl") {
				t.Errorf("Base58() = %q contains an ambiguous character", short)
			}
			got, err := short.Canonical()
			if err != nil {
				t.Fatalf("Canonical(): %v", err)
			}
			if got != want {
				t.Errorf("round-trip mismatch: got %q, want %q", got, want)
			}
		})
	}
}

func TestBase58RandomUUIDv7(t *testing.T) {
	t.Parallel()
	for range 100 {
		want := New()
		short := want.Base58()
		if len(short) > 22 {
			t.Errorf("Base58() produced %d-char output %q", len(short), short)
		}
		got, err := short.Canonical()
		if err != nil {
			t.Fatalf("Canonical(%q): %v", short, err)
		}
		if got != want {
			t.Errorf("round-trip mismatch: got %q, want %q", got, want)
		}
	}
}

func TestParseTolerant(t *testing.T) {
	t.Parallel()
	canonical := ID("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f")
	short := canonical.Base58()

	if got, err := ParseTolerant(string(short)); err != nil || got != canonical {
		t.Errorf("ParseTolerant(short) = %q, %v; want %q, nil", got, err, canonical)
	}
	if got, err := ParseTolerant(string(canonical)); err != nil || got != canonical {
		t.Errorf("ParseTolerant(canonical) = %q, %v; want %q, nil", got, err, canonical)
	}
	if got, err := ParseTolerant(""); err != nil || !got.IsZero() {
		t.Errorf(`ParseTolerant("") = %q, %v; want zero, nil`, got, err)
	}
	// Only strings that are neither canonical UUIDs nor valid Base58 are
	// rejected. Any Base58 string decodes to *some* UUID (see ADR-09's
	// "research" example), which is unavoidable: that set is exactly what the
	// old middleware accepted, so compatibility is preserved.
	for _, in := range []string{"not-an-id", "0OIl", "####", "-"} {
		if got, err := ParseTolerant(in); err == nil {
			t.Errorf("ParseTolerant(%q) = %q, want error", in, got)
		}
	}
	if got, err := ParseTolerant("research"); err != nil {
		t.Errorf("ParseTolerant(base58-decodable %q) error: %v", "research", err)
	} else if want := ID("00000000-0000-0000-0000-63b5ec8e7172"); got != want {
		t.Errorf("ParseTolerant(%q) = %q, want %q", "research", got, want)
	}
}

func TestParseStrict(t *testing.T) {
	t.Parallel()
	if _, err := Parse("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"); err != nil {
		t.Errorf("Parse(canonical) unexpected error: %v", err)
	}
	// The Base58 form must NOT be accepted by the strict parser.
	if _, err := Parse(string(ID("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f").Base58())); err == nil {
		t.Error("Parse(base58) = nil error, want error")
	}
}

func TestIsBase58(t *testing.T) {
	t.Parallel()
	short := ID("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f").Base58()
	if !IsBase58(string(short)) {
		t.Errorf("IsBase58(%q) = false, want true", short)
	}
	if IsBase58("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f") {
		t.Error("IsBase58(canonical) = true, want false")
	}
	if IsBase58("") {
		t.Error(`IsBase58("") = true, want false`)
	}
}

type dto struct {
	Id     ID     `json:"id"`
	Ids    []ID   `json:"ids,omitempty"`
	Nested *inner `json:"nested,omitempty"`
}

type inner struct {
	OwnerId ID `json:"owner_id"`
}

func TestJSONHooks(t *testing.T) {
	t.Parallel()
	canonical := ID("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f")
	short := canonical.Base58()

	// Marshal emits the wire form everywhere, regardless of field names.
	out, err := json.Marshal(dto{Id: canonical, Ids: []ID{canonical}, Nested: &inner{OwnerId: canonical}})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"id":"` + string(short) + `"`, `"owner_id":"` + string(short) + `"`} {
		if !strings.Contains(string(out), want) {
			t.Errorf("marshaled %s missing %s", out, want)
		}
	}

	// Unmarshal accepts the wire form and canonicalizes it.
	var got dto
	if err := json.Unmarshal([]byte(`{"id":"`+string(short)+`","nested":{"owner_id":"`+string(canonical)+`"}}`), &got); err != nil {
		t.Fatal(err)
	}
	if got.Id != canonical {
		t.Errorf("Id = %q, want %q", got.Id, canonical)
	}
	if got.Nested.OwnerId != canonical {
		t.Errorf("OwnerId = %q, want %q (canonical)", got.Nested.OwnerId, canonical)
	}

	// Malformed ids fail at parse time.
	for _, in := range []string{`{"id":"0OIl"}`, `{"id":123}`} {
		var bad dto
		if err := json.Unmarshal([]byte(in), &bad); err == nil {
			t.Errorf("Unmarshal(%s) = nil error, want error", in)
		}
	}

	// JSON null and empty string parse to the zero id without error.
	var nullID dto
	if err := json.Unmarshal([]byte(`{"id":null}`), &nullID); err != nil {
		t.Errorf("Unmarshal(null) error: %v", err)
	}
	if !nullID.Id.IsZero() {
		t.Errorf("Unmarshal(null) = %q, want zero", nullID.Id)
	}
}

func TestScanValue(t *testing.T) {
	t.Parallel()
	canonical := "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"

	var fromString ID
	if err := fromString.Scan(canonical); err != nil || fromString != ID(canonical) {
		t.Errorf("Scan(string) = %q, %v", fromString, err)
	}

	var fromBytes ID
	if err := fromBytes.Scan([]byte(canonical)); err != nil || fromBytes != ID(canonical) {
		t.Errorf("Scan([]byte) = %q, %v", fromBytes, err)
	}

	u := uuid.MustParse(canonical)
	var fromArray ID
	if err := fromArray.Scan(u); err != nil || fromArray != ID(canonical) {
		t.Errorf("Scan(uuid.UUID) = %q, %v", fromArray, err)
	}

	var fromNil ID
	if err := fromNil.Scan(nil); err != nil || !fromNil.IsZero() {
		t.Errorf("Scan(nil) = %q, %v, want zero", fromNil, err)
	}

	var bad ID
	if err := bad.Scan(42); err == nil {
		t.Error("Scan(int) = nil error, want error")
	}

	v, err := ID(canonical).Value()
	if err != nil || v != canonical {
		t.Errorf("Value() = %v, %v", v, err)
	}
}
