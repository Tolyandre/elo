// bundle-openapi resolves all external $ref in an OpenAPI spec into a single
// self-contained JSON file that oapi-codegen can process without --import-mapping.
//
// Usage: go run ./tools/bundle-openapi <input.yaml> <output.json>
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: bundle-openapi <input.yaml> <output.json>")
		os.Exit(1)
	}
	input, output := os.Args[1], os.Args[2]

	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = true

	doc, err := loader.LoadFromFile(input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load: %v\n", err)
		os.Exit(1)
	}

	// Build lookup tables from the root document's component aliases.
	// openapi.yaml defines aliases like:
	//   Club:       { $ref: './clubs.yaml#/Club' }
	//   GamePlayer: { $ref: './games.yaml#/GamePlayer' }
	//
	// Two cases appear during InternalizeRefs:
	//  1. External refs like "./clubs.yaml#/Club"   → resolve via refToRootName
	//  2. Fragment-only refs like "#/Club" (from within clubs.yaml itself) → resolve via fragmentToRootName
	refToRootName := map[string]string{}      // "./clubs.yaml#/Club" → "Club"
	fragmentToRootName := map[string]string{} // "Club" → "Club"
	if doc.Components != nil {
		for name, schemaRef := range doc.Components.Schemas {
			ref := schemaRef.RefString()
			if ref == "" {
				continue
			}
			refToRootName[ref] = name
			if _, fragment, ok := strings.Cut(ref, "#/"); ok {
				fragmentToRootName[fragment] = name
			}
		}
	}

	resolver := func(doc *openapi3.T, ref openapi3.ComponentRef) string {
		refStr := ref.RefString()
		if rootName, ok := refToRootName[refStr]; ok {
			return rootName
		}
		// Fragment-only ref from within a sub-file (e.g., "#/GamePlayer")
		if strings.HasPrefix(refStr, "#/") {
			fragment := strings.TrimPrefix(refStr, "#/")
			if rootName, ok := fragmentToRootName[fragment]; ok {
				return rootName
			}
		}
		return openapi3.DefaultRefNameResolver(doc, ref)
	}

	// InternalizeRefs replaces every external $ref with the inlined schema,
	// producing a fully self-contained document.
	doc.InternalizeRefs(context.Background(), resolver)

	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(output, data, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write: %v\n", err)
		os.Exit(1)
	}
}
