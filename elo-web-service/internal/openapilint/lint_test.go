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
//   - Every path+method in the spec MUST be registered in main.go. The router
//     is wired by hand there (RegisterHandlers is not used), and the
//     integration-test router is a hand-picked subset — so a spec route
//     nobody copied into main.go would 404 in production with every test
//     green (that actually happened with the first tag endpoints).
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

// specRoutes collects every (method, path) the OpenAPI spec exposes. Path
// items in openapi.yaml are $refs into the sibling yaml files
// ("./games.yaml#/GameTagsPath"); inline path items are also accepted.
func specRoutes(t *testing.T, dir string) [][2]string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join(dir, "openapi.yaml"))
	if err != nil {
		t.Fatalf("read openapi.yaml: %v", err)
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse openapi.yaml: %v", err)
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok {
		t.Fatal("openapi.yaml has no paths section")
	}

	methods := map[string]bool{
		"get": true, "post": true, "put": true, "patch": true, "delete": true,
		"head": true, "options": true, "trace": true,
	}
	loaded := map[string]map[string]any{"openapi.yaml": doc}
	readRef := func(ref string) map[string]any {
		file, key, _ := strings.Cut(strings.TrimPrefix(ref, "./"), "#/")
		m, ok := loaded[file]
		if !ok {
			r, err := os.ReadFile(filepath.Join(dir, file))
			if err != nil {
				t.Fatalf("read %s: %v", file, err)
			}
			m = map[string]any{}
			if err := yaml.Unmarshal(r, &m); err != nil {
				t.Fatalf("parse %s: %v", file, err)
			}
			loaded[file] = m
		}
		item, ok := m[key].(map[string]any)
		if !ok {
			t.Fatalf("%s: path item %q not found", ref, key)
		}
		return item
	}

	var routes [][2]string
	for path, v := range paths {
		var item map[string]any
		switch pv := v.(type) {
		case map[string]any:
			if ref, ok := pv["$ref"].(string); ok {
				item = readRef(ref)
			} else {
				item = pv
			}
		default:
			t.Fatalf("path %s: unsupported path item", path)
		}
		for op := range item {
			if methods[op] {
				routes = append(routes, [2]string{op, path})
			}
		}
	}
	return routes
}

// TestMainRegistersAllSpecRoutes fails when a spec route is missing from the
// hand-wired gin router in main.go. The {param} placeholders become :param gin
// wildcards; the /auth and /tables route groups register their subpaths.
func TestMainRegistersAllSpecRoutes(t *testing.T) {
	specDir := filepath.Join("..", "..", "..", "openapi")
	// Same guard as the id-convention test: the Nix sandbox copies only
	// elo-web-service/, so enforcement runs wherever the full repo exists.
	if _, err := os.Stat(specDir); err != nil {
		t.Skip("openapi/ not reachable from this build context")
	}
	mainGo := filepath.Join("..", "..", "main.go")
	raw, err := os.ReadFile(mainGo)
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	source := string(raw)

	routeCall := func(router, method, subpath string) bool {
		re := regexp.MustCompile(router + `\.` + strings.ToUpper(method) + `\(\s*"` + regexp.QuoteMeta(subpath) + `"`)
		return re.MatchString(source)
	}
	registered := func(method, path string) bool {
		// Sub-router groups in main.go register relative subpaths.
		for _, g := range []struct{ prefix, router string }{{"/auth", "authRouter"}, {"/tables", "tbl"}} {
			if sub, ok := strings.CutPrefix(path, g.prefix); ok {
				return routeCall(g.router, method, sub)
			}
		}
		return routeCall("router", method, path)
	}

	ginPath := func(p string) string {
		// {id} → :id, {tagId} → :tagId
		return regexp.MustCompile(`\{(\w+)\}`).ReplaceAllString(p, ":$1")
	}

	routes := specRoutes(t, specDir)
	if len(routes) == 0 {
		t.Fatal("spec exposes no routes — path resolution broken?")
	}
	var errs []string
	for _, r := range routes {
		method, path := r[0], ginPath(r[1])
		if !registered(method, path) {
			errs = append(errs, fmt.Sprintf("%-6s %-34s is in the spec but not registered in main.go", strings.ToUpper(method), path))
		}
	}
	if len(errs) > 0 {
		t.Errorf("%d spec route(s) missing from the main.go router:\n%s", len(errs), strings.Join(errs, "\n"))
	}
}
