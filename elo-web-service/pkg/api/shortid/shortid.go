// Package shortid encodes/decodes UUIDs as short Base58 strings.
//
// The wire format of every identifier is a Base58 (Bitcoin alphabet) encoding
// of the 16-byte UUID — ~22 chars, no ambiguous characters (0/O/I/l omitted).
// The underlying identifier stays a UUIDv7 (lexicographically sortable); only
// its encoding on the wire changes. The DB stores native canonical UUIDs; this
// package is the single source of truth for the short representation.
package shortid

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/google/uuid"
)

// Alphabet is the Base58 Bitcoin alphabet. It omits the four look-alike
// characters 0, O, I, l to keep ids readable when shared by hand.
const Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

var (
	alphabetIndex [128]byte // Alphabet byte -> index; 0 marks "not in alphabet"
	base          = big.NewInt(int64(len(Alphabet)))
)

func init() {
	for i := range alphabetIndex {
		alphabetIndex[i] = 255
	}
	for i := 0; i < len(Alphabet); i++ {
		alphabetIndex[Alphabet[i]] = byte(i)
	}
}

// Encode converts a canonical UUID string to its short Base58 form.
func Encode(uuidStr string) (string, error) {
	u, err := uuid.Parse(uuidStr)
	if err != nil {
		return "", fmt.Errorf("shortid: parse uuid %q: %w", uuidStr, err)
	}

	b := u[:] // 16 bytes, big-endian (RFC 4122 field order)

	// Leading zero bytes encode to leading '1's (Base58 convention), so legacy
	// ids like 00000000-0000-0000-0000-000000000001 round-trip correctly.
	zeros := 0
	for zeros < len(b) && b[zeros] == 0 {
		zeros++
	}

	// Interpret the full 16 bytes as a big-endian unsigned integer.
	num := new(big.Int).SetBytes(b)
	mod := new(big.Int)
	var rev []byte
	for num.Sign() > 0 {
		num.DivMod(num, base, mod)
		rev = append(rev, Alphabet[mod.Int64()])
	}
	// Reverse so the most-significant digit comes first.
	out := make([]byte, 0, zeros+len(rev))
	for i := 0; i < zeros; i++ {
		out = append(out, '1')
	}
	for i := len(rev) - 1; i >= 0; i-- {
		out = append(out, rev[i])
	}
	return string(out), nil
}

// Decode converts a short Base58 string back to a canonical UUID string.
func Decode(s string) (string, error) {
	if s == "" {
		return "", fmt.Errorf("shortid: empty input")
	}

	// Count leading '1's (each represents one leading zero byte).
	zeros := 0
	for zeros < len(s) && s[zeros] == '1' {
		zeros++
	}
	if zeros > 16 {
		return "", fmt.Errorf("shortid: %q has too many leading zeros", s)
	}

	num := big.NewInt(0)
	for i := zeros; i < len(s); i++ {
		c := s[i]
		if c >= 128 || alphabetIndex[c] == 255 {
			return "", fmt.Errorf("shortid: invalid character %q in %q", string(rune(c)), s)
		}
		num.Mul(num, base)
		num.Add(num, big.NewInt(int64(alphabetIndex[c])))
	}

	b := num.Bytes() // big-endian, no leading zeros

	// A UUID is exactly 16 bytes. Left-pad with zero bytes (one per leading '1').
	if len(b)+zeros > 16 {
		return "", fmt.Errorf("shortid: %q decodes to more than 16 bytes", s)
	}
	var raw [16]byte
	copy(raw[16-len(b):], b)
	// zeros leading bytes are already zeroed in raw.

	u, err := uuid.FromBytes(raw[:])
	if err != nil {
		return "", fmt.Errorf("shortid: reconstruct uuid from %q: %w", s, err)
	}
	return u.String(), nil
}

// ToCanonical returns the canonical UUID form of s, accepting either the short
// Base58 encoding or a canonical UUID. Any other string is returned unchanged
// (tolerant passthrough). This is the inbound decode used by the API boundary.
func ToCanonical(s string) string {
	// Fast path: already a canonical UUID.
	if _, err := uuid.Parse(s); err == nil {
		return s
	}
	if decoded, err := Decode(s); err == nil {
		return decoded
	}
	return s
}

// FromCanonical returns the short Base58 form of s if s is a canonical UUID,
// otherwise s unchanged. This is the outbound encode used by the API boundary.
func FromCanonical(s string) string {
	if encoded, err := Encode(s); err == nil {
		return encoded
	}
	return s
}

// IsShort reports whether s looks like a short Base58 id: non-empty, made only
// of Alphabet characters, and not a canonical UUID. Useful for diagnostics.
func IsShort(s string) bool {
	if s == "" {
		return false
	}
	if strings.ContainsAny(s, "-") {
		return false // canonical UUIDs contain dashes
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 128 || alphabetIndex[c] == 255 {
			return false
		}
	}
	return true
}
