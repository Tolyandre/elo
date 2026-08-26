// Package openapilint enforces the identifier conventions of ADR-12 on the
// OpenAPI sources, so a forgotten or misnamed id field fails `go test ./...`
// instead of surfacing as a runtime "row not found".
//
// Rules:
//   - Every property named id / *_id / *Id MUST reference the shared Base58ID
//     schema (directly, or via the allOf+nullable wrapper); *_ids properties
//     MUST be arrays of Base58ID.
//   - Every reference to Base58ID MUST sit on an id-shaped property name —
//     typing a non-identifier as an id would make its values round-trip
//     through the base58 codec and silently corrupt them.
//   - Path/query parameters with id-shaped names MUST stay plain `type:
//     string`: they carry the wire form and are parsed explicitly by handlers
//     (id.ParseTolerant), so mapping them to the Go identifier type would be
//     a lying type.
//   - `format: uuid` must never appear: canonical UUIDs are not a wire form.
package openapilint

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

var (
	singleIDName = regexp.MustCompile(`^(id|[a-z][a-z0-9_]*_id|[a-z][a-zA-Z0-9]*Id)$`)
	pluralIDName = regexp.MustCompile(`^[a-z][a-z0-9_]*_ids$`)
	paramIDName  = regexp.MustCompile(`^(id|[a-z][a-z0-9_]*_id|[a-z][a-zA-Z0-9]*Id)$`)
)

func isBase58Ref(v any) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}
	ref, ok := m["$ref"].(string)
	return ok && strings.HasSuffix(ref, "#/Base58ID")
}

// refsBase58 reports whether the property schema resolves to Base58ID,
// accepting the allOf+nullable wrapper used for optional ids.
func refsBase58(v any) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}
	if isBase58Ref(m) {
		return true
	}
	if allOf, ok := m["allOf"].([]any); ok {
		for _, el := range allOf {
			if isBase58Ref(el) {
				return true
			}
		}
	}
	if items, ok := m["items"]; ok {
		return isBase58Ref(items)
	}
	return false
}

func lintNode(node any, path string, errs *[]string) {
	switch n := node.(type) {
	case map[string]any:
		if format, ok := n["format"].(string); ok && format == "uuid" {
			*errs = append(*errs, fmt.Sprintf("%s: format: uuid is not a wire form; use $ref Base58ID", path))
		}
		if props, ok := n["properties"].(map[string]any); ok {
			for name, schema := range props {
				sp := path + ".properties." + name
				switch {
				case pluralIDName.MatchString(name):
					m, _ := schema.(map[string]any)
					if m == nil || m["type"] != "array" || !isBase58Ref(m["items"]) {
						*errs = append(*errs, fmt.Sprintf("%s: *_ids property must be an array of $ref Base58ID", sp))
					}
				case singleIDName.MatchString(name):
					if !refsBase58(schema) {
						*errs = append(*errs, fmt.Sprintf("%s: id property must $ref Base58ID (directly or via allOf+nullable)", sp))
					}
				default:
					if refsBase58(schema) {
						*errs = append(*errs, fmt.Sprintf("%s: references Base58ID but its name is not id-shaped", sp))
					}
				}
				lintNode(schema, sp, errs)
			}
		}
		for k, v := range n {
			if k == "properties" {
				continue
			}
			lintNode(v, path+"."+k, errs)
		}
	case []any:
		for i, el := range n {
			if m, ok := el.(map[string]any); ok {
				if in, _ := m["in"].(string); in == "path" || in == "query" {
					if name, _ := m["name"].(string); paramIDName.MatchString(name) {
						schema, _ := m["schema"].(map[string]any)
						pp := fmt.Sprintf("%s.parameters[name=%s]", path, name)
						if schema == nil || schema["type"] != "string" || schema["$ref"] != nil {
							*errs = append(*errs, fmt.Sprintf("%s: id parameter must stay plain `type: string` (wire form, parsed by the handler)", pp))
						}
					}
				}
			}
			lintNode(el, fmt.Sprintf("%s[%d]", path, i), errs)
		}
	}
}

func TestOpenAPISpecIDConventions(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "openapi")
	// The Nix build copies only elo-web-service/ into the sandbox, without the
	// sibling spec directory; enforcement runs wherever the full repo exists.
	if _, err := os.Stat(dir); err != nil {
		t.Skip("openapi/ not reachable from this build context")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read openapi dir: %v", err)
	}
	var errs []string
	checked := 0
	for _, e := range entries {
		if e.IsDir() || (!strings.HasSuffix(e.Name(), ".yaml")) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		var doc any
		if err := yaml.Unmarshal(raw, &doc); err != nil {
			t.Fatalf("parse %s: %v", e.Name(), err)
		}
		checked++
		lintNode(doc, e.Name(), &errs)
	}
	if checked == 0 {
		t.Fatal("no spec files found — wrong working directory?")
	}
	if len(errs) > 0 {
		t.Errorf("%d id-convention violations:\n%s", len(errs), strings.Join(errs, "\n"))
	}
}
