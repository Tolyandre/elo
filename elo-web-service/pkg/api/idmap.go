package api

import (
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// IDMap is a JSON object whose KEYS are player ids. encoding/json never calls
// custom marshalers for map keys, so a plain map[id.ID]V would leak canonical
// UUIDs on the wire and accept Base58 keys unconverted on parse — the one hole
// the type-driven boundary (ADR-12) cannot reach. These hooks convert the keys
// explicitly.
type IDMap[V any] map[id.ID]V

func (m IDMap[V]) MarshalJSON() ([]byte, error) {
	out := make(map[string]V, len(m))
	for k, v := range m {
		out[string(k.Base58())] = v
	}
	return json.Marshal(out)
}

func (m *IDMap[V]) UnmarshalJSON(b []byte) error {
	var raw map[string]V
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*m = make(IDMap[V], len(raw))
	for k, v := range raw {
		parsed, err := id.ParseTolerant(k)
		if err != nil {
			return fmt.Errorf("invalid id map key %q: %w", k, err)
		}
		(*m)[parsed] = v
	}
	return nil
}
