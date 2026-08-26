package id

import (
	"fmt"
	"math/big"
	"strings"
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

// base58Encode converts a canonical UUID string to its Base58 form.
func base58Encode(uuidStr string) (string, error) {
	raw, ok := parseUUIDBytes(uuidStr)
	if !ok {
		return "", fmt.Errorf("id: parse uuid %q failed", uuidStr)
	}

	// Leading zero bytes encode to leading '1's (Base58 convention), so legacy
	// ids like 00000000-0000-0000-0000-000000000001 round-trip correctly.
	zeros := 0
	for zeros < len(raw) && raw[zeros] == 0 {
		zeros++
	}

	// Interpret the full 16 bytes as a big-endian unsigned integer.
	num := new(big.Int).SetBytes(raw[:])
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

// base58Decode converts a Base58 string back to a canonical UUID string.
func base58Decode(s string) (string, error) {
	if s == "" {
		return "", fmt.Errorf("id: empty input")
	}

	// Count leading '1's (each represents one leading zero byte).
	zeros := 0
	for zeros < len(s) && s[zeros] == '1' {
		zeros++
	}
	if zeros > 16 {
		return "", fmt.Errorf("id: %q has too many leading zeros", s)
	}

	num := big.NewInt(0)
	for i := zeros; i < len(s); i++ {
		c := s[i]
		if c >= 128 || alphabetIndex[c] == 255 {
			return "", fmt.Errorf("id: invalid character %q in %q", string(rune(c)), s)
		}
		num.Mul(num, base)
		num.Add(num, big.NewInt(int64(alphabetIndex[c])))
	}

	b := num.Bytes() // big-endian, no leading zeros

	// A UUID is exactly 16 bytes. Left-pad with zero bytes (one per leading '1').
	if len(b)+zeros > 16 {
		return "", fmt.Errorf("id: %q decodes to more than 16 bytes", s)
	}
	var raw [16]byte
	copy(raw[16-len(b):], b)
	// zeros leading bytes are already zeroed in raw.

	return formatUUID(raw), nil
}

// IsBase58 reports whether s looks like a Base58 id: non-empty, made only of
// Alphabet characters, and not a canonical UUID. Useful for diagnostics.
func IsBase58(s string) bool {
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
