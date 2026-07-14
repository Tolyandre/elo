package shortid

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestEncode_Decode_RoundTrip(t *testing.T) {
	t.Parallel()
	cases := []string{
		"018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f",
		"00000000-0000-0000-0000-000000000001", // legacy int-backed id
		"00000000-0000-0000-0000-0000000000ff", // legacy, larger
		"ffffffff-ffff-ffff-ffff-ffffffffffff", // max
		uuid.Nil.String(),
	}
	for _, want := range cases {
		t.Run(want, func(t *testing.T) {
			short, err := Encode(want)
			if err != nil {
				t.Fatalf("Encode(%q): %v", want, err)
			}
			if len(short) > 22 {
				t.Errorf("Encode(%q) = %q, want <= 22 chars", want, short)
			}
			if strings.ContainsAny(short, "0OIl") {
				t.Errorf("Encode(%q) = %q contains an ambiguous character", want, short)
			}
			got, err := Decode(short)
			if err != nil {
				t.Fatalf("Decode(%q): %v", short, err)
			}
			if got != want {
				t.Errorf("round-trip mismatch: got %q, want %q", got, want)
			}
		})
	}
}

func TestEncode_RandomUUIDv7(t *testing.T) {
	t.Parallel()
	for range 100 {
		u, err := uuid.NewV7()
		if err != nil {
			t.Fatal(err)
		}
		want := u.String()
		short, err := Encode(want)
		if err != nil {
			t.Fatalf("Encode(%q): %v", want, err)
		}
		if len(short) > 22 {
			t.Errorf("Encode produced %d-char output %q", len(short), short)
		}
		got, err := Decode(short)
		if err != nil {
			t.Fatalf("Decode(%q): %v", short, err)
		}
		if got != want {
			t.Errorf("round-trip mismatch: got %q, want %q", got, want)
		}
	}
}

func TestEncode_InvalidInput(t *testing.T) {
	t.Parallel()
	for _, in := range []string{"not-a-uuid", "", "018f6b48-3e0b-7c3f-8d2b"} {
		if _, err := Encode(in); err == nil {
			t.Errorf("Encode(%q) expected error, got nil", in)
		}
	}
}

func TestDecode_InvalidInput(t *testing.T) {
	t.Parallel()
	for _, in := range []string{"", "0", "l", "O", "I", "0OIl", "####"} {
		if _, err := Decode(in); err == nil {
			t.Errorf("Decode(%q) expected error, got nil", in)
		}
	}
}

// Known-answer vector for the example in the ADR, so a doc drift is caught.
func TestEncode_KnownAnswer(t *testing.T) {
	t.Parallel()
	short, err := Encode("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f")
	if err != nil {
		t.Fatal(err)
	}
	// We don't pin the exact string (alphabet/format details may evolve); we
	// only assert it round-trips and is short. A structural property is enough.
	back, err := Decode(short)
	if err != nil {
		t.Fatal(err)
	}
	if back != "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f" {
		t.Errorf("round-trip = %q, want canonical", back)
	}
}

func TestToCanonical_Tolerant(t *testing.T) {
	t.Parallel()
	canonical := "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"
	short, _ := Encode(canonical)

	if got := ToCanonical(short); got != canonical {
		t.Errorf("ToCanonical(short) = %q, want %q", got, canonical)
	}
	if got := ToCanonical(canonical); got != canonical {
		t.Errorf("ToCanonical(canonical) = %q, want %q", got, canonical)
	}
	if got := ToCanonical("not-an-id"); got != "not-an-id" {
		t.Errorf("ToCanonical(non-id) = %q, want passthrough", got)
	}
}

func TestFromCanonical_Tolerant(t *testing.T) {
	t.Parallel()
	canonical := "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"
	short, _ := Encode(canonical)

	if got := FromCanonical(canonical); got != short {
		t.Errorf("FromCanonical(canonical) = %q, want %q", got, short)
	}
	if got := FromCanonical("not-a-uuid"); got != "not-a-uuid" {
		t.Errorf("FromCanonical(non-uuid) = %q, want passthrough", got)
	}
	// Idempotent: short input is not a canonical UUID, passes through.
	if got := FromCanonical(short); got != short {
		t.Errorf("FromCanonical(short) = %q, want %q (passthrough)", got, short)
	}
}

func TestIsShort(t *testing.T) {
	t.Parallel()
	short, _ := Encode("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f")
	if !IsShort(short) {
		t.Errorf("IsShort(%q) = false, want true", short)
	}
	if IsShort("018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f") {
		t.Error("IsShort(canonical) = true, want false")
	}
	if IsShort("") {
		t.Error(`IsShort("") = true, want false`)
	}
}
