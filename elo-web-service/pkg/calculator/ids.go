package calculator

import (
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// calculator_data is a freeform JSON document the generated DTO layer cannot
// type, so its ids convert via a schema-driven walk: every property the
// calculator's JSON Schema marks "x-entity-id": true is an entity id and gets
// rewritten at the boundary, regardless of key naming (ADR-12). This replaces
// the idcodec middleware's name-based rewrite of the whole request body.

// CanonicalizeIDs converts every x-entity-id property of raw from the wire
// form (Base58 or canonical) to the canonical UUID. Runs on ingest, after
// Validate, so stored documents always hold canonical ids.
func CanonicalizeIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	s, err := Lookup(kind)
	if err != nil {
		return nil, err
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	out, err := walkIDs(doc, s.rawSchema, id.CanonicalizeTolerant)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return json.Marshal(out)
}

// ShortenIDs is the inverse of CanonicalizeIDs: canonical UUIDs become the
// Base58 wire form. Runs on egress, before the document is embedded in a
// response. Unknown kinds and malformed documents pass through untouched —
// the migrators keep stored rows current, so failing the response would only
// hurt reads of hand-edited data.
func ShortenIDs(kind string, raw json.RawMessage) (json.RawMessage, error) {
	s, err := Lookup(kind)
	if err != nil {
		return raw, nil
	}
	var doc any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return raw, nil
	}
	out, _ := walkIDs(doc, s.rawSchema, id.ToBase58)
	b, err := json.Marshal(out)
	if err != nil {
		return raw, nil
	}
	return b, nil
}

// walkIDs recursively rewrites id-marked string properties of doc according to
// schema (its properties/items branches only; id markers never sit behind
// oneOf in the calculator schemas).
func walkIDs(doc any, schema map[string]any, convert func(string) string) (any, error) {
	if schema == nil || doc == nil {
		return doc, nil
	}
	switch d := doc.(type) {
	case map[string]any:
		props, _ := schema["properties"].(map[string]any)
		for k, v := range d {
			prop, _ := props[k].(map[string]any)
			if prop == nil {
				continue
			}
			if _, marked := prop["x-entity-id"]; marked {
				if s, ok := v.(string); ok {
					d[k] = convert(s)
				} else if v != nil {
					return nil, fmt.Errorf("x-entity-id property %q is not a string", k)
				}
				continue
			}
			converted, err := walkIDs(v, prop, convert)
			if err != nil {
				return nil, err
			}
			d[k] = converted
		}
		return d, nil
	case []any:
		items, _ := schema["items"].(map[string]any)
		if items == nil {
			return d, nil
		}
		for i, el := range d {
			converted, err := walkIDs(el, items, convert)
			if err != nil {
				return nil, err
			}
			d[i] = converted
		}
		return d, nil
	default:
		return doc, nil
	}
}
