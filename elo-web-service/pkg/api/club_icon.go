package api

import (
	"encoding/xml"
	"fmt"
	"strings"
)

// maxClubIconBytes caps the stored SVG size. Icons are tiny; this is a sanity limit.
const maxClubIconBytes = 32 * 1024

// dangerousSVGElements are element local-names (lowercased) that must never appear in a
// club icon. These either run script / load active content (script, foreignObject, iframe,
// embed, object, audio, video) or animate attributes in ways we'd rather not allow
// (animate*, set, handler, listener), plus <a> which is navigation an icon never needs.
//
// Reference elements like <use> and <image> are intentionally NOT here: they are only
// dangerous when they point at an external/remote document, and checkSVGAttr already
// restricts href/xlink:href/src to local fragments ("#id") or inline "data:image/…". That
// lets a local <use href="#id"> (sprite reuse) through while still rejecting remote refs.
var dangerousSVGElements = map[string]struct{}{
	"script":           {},
	"foreignobject":    {},
	"a":                {},
	"iframe":           {},
	"embed":            {},
	"object":           {},
	"audio":            {},
	"video":            {},
	"animate":          {},
	"animatemotion":    {},
	"animatetransform": {},
	"set":              {},
	"handler":          {},
	"listener":         {},
}

// sanitizeClubIconSVG validates that s is a self-contained, script-free SVG safe to store
// and render. Rendering happens via an <img> data-URI on the frontend (which already
// prevents script execution); this is defense-in-depth so we never persist hostile markup.
// On success it returns the trimmed original markup.
func sanitizeClubIconSVG(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("icon is empty")
	}
	if len(s) > maxClubIconBytes {
		return "", fmt.Errorf("icon is too large (max %d bytes)", maxClubIconBytes)
	}

	dec := xml.NewDecoder(strings.NewReader(s))
	dec.Strict = true

	sawSVGRoot := false
	for {
		tok, err := dec.Token()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return "", fmt.Errorf("icon is not well-formed XML: %w", err)
		}

		switch t := tok.(type) {
		case xml.Directive:
			// <!DOCTYPE …>, <!ENTITY …> — XXE / entity-expansion vectors.
			return "", fmt.Errorf("icon must not contain directives")
		case xml.ProcInst:
			// Allow only the XML declaration (<?xml …?>); reject other instructions.
			if strings.ToLower(t.Target) != "xml" {
				return "", fmt.Errorf("icon must not contain processing instructions")
			}
		case xml.StartElement:
			name := strings.ToLower(t.Name.Local)
			if !sawSVGRoot {
				if name != "svg" {
					return "", fmt.Errorf("icon root element must be <svg>")
				}
				sawSVGRoot = true
			}
			if _, bad := dangerousSVGElements[name]; bad {
				return "", fmt.Errorf("icon must not contain <%s>", name)
			}
			for _, attr := range t.Attr {
				if err := checkSVGAttr(attr); err != nil {
					return "", err
				}
			}
		}
	}

	if !sawSVGRoot {
		return "", fmt.Errorf("icon must be an <svg> document")
	}
	return s, nil
}

func checkSVGAttr(attr xml.Attr) error {
	local := strings.ToLower(attr.Name.Local)
	// Event handlers: onload, onclick, …
	if strings.HasPrefix(local, "on") {
		return fmt.Errorf("icon must not contain event handler attributes")
	}
	value := strings.ToLower(strings.Join(strings.Fields(attr.Value), ""))
	if strings.Contains(value, "javascript:") {
		return fmt.Errorf("icon must not contain javascript: URIs")
	}
	// href / xlink:href / src: only fragments or inline data:image are allowed.
	if local == "href" || local == "src" {
		if value != "" && !strings.HasPrefix(value, "#") && !strings.HasPrefix(value, "data:image/") {
			return fmt.Errorf("icon must not reference external resources")
		}
	}
	return nil
}

// clubIconText converts a validated icon string into the nullable text stored in the DB.
// An empty string clears the icon.
func clubIconText(s string) (string, bool) {
	s = strings.TrimSpace(s)
	return s, s != ""
}
