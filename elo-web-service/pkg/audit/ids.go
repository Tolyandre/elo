package audit

import (
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Stored details documents hold canonical UUIDs under x-entity-id-marked
// properties (documents are built server-side, so there is no ingest-side
// canonicalization). ShortenIDs rewrites them to the Base58 wire form on
// egress — the same schema-driven walk the calculator package uses (ADR-12).

// ShortenIDs converts every x-entity-id property of raw from the canonical
// UUID to the Base58 wire form. Unknown kinds and malformed documents pass
// through untouched — the startup migration keeps stored rows current, so
// failing the response would only hurt reads of hand-edited data.
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
// oneOf in the audit schemas).
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
