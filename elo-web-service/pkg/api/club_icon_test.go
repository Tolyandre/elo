package api

import (
	"strings"
	"testing"
)

func TestSanitizeClubIconSVG_Valid(t *testing.T) {
	valid := []string{
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2563eb"/></svg>`,
		`<?xml version="1.0"?><svg viewBox="0 0 24 24"><path d="M2 2 L20 20" stroke="#000"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><g fill="green"><rect x="1" y="1" width="5" height="5"/></g></svg>`,
		`  <svg viewBox="0 0 10 10"><title>ok</title><circle cx="5" cy="5" r="4"/></svg>  `,
		// Local sprite reuse is safe (href is a fragment).
		`<svg viewBox="0 0 24 24"><defs><circle id="c" cx="5" cy="5" r="4"/></defs><use href="#c"/></svg>`,
		`<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><defs><rect id="r" width="3" height="3"/></defs><use xlink:href="#r"/></svg>`,
	}
	for _, in := range valid {
		out, err := sanitizeClubIconSVG(in)
		if err != nil {
			t.Errorf("expected valid, got error %v for: %s", err, in)
		}
		if out != strings.TrimSpace(in) {
			t.Errorf("expected trimmed original returned")
		}
	}
}

func TestSanitizeClubIconSVG_Rejected(t *testing.T) {
	rejected := map[string]string{
		"empty":           ``,
		"whitespace":      `   `,
		"not svg root":    `<div><svg viewBox="0 0 1 1"></svg></div>`,
		"script":          `<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>`,
		"onload":          `<svg viewBox="0 0 1 1" onload="alert(1)"></svg>`,
		"onclick child":   `<svg viewBox="0 0 1 1"><circle cx="1" cy="1" r="1" onclick="x()"/></svg>`,
		"foreignObject":   `<svg viewBox="0 0 1 1"><foreignObject><body/></foreignObject></svg>`,
		"anchor":          `<svg viewBox="0 0 1 1"><a href="https://evil.test">x</a></svg>`,
		"js href":         `<svg viewBox="0 0 1 1"><path href="javascript:alert(1)"/></svg>`,
		"external image":  `<svg viewBox="0 0 1 1"><image href="https://evil.test/x.png"/></svg>`,
		"external use":    `<svg viewBox="0 0 1 1"><use href="https://evil.test#a"/></svg>`,
		"doctype entity":  `<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"></svg>`,
		"malformed":       `<svg viewBox="0 0 1 1"><circle></svg>`,
		"style js":        `<svg viewBox="0 0 1 1"><rect style="background:url(javascript:alert(1))"/></svg>`,
	}
	for name, in := range rejected {
		if _, err := sanitizeClubIconSVG(in); err == nil {
			t.Errorf("%s: expected rejection, got nil error for: %s", name, in)
		}
	}
}

func TestSanitizeClubIconSVG_TooLarge(t *testing.T) {
	big := `<svg viewBox="0 0 1 1">` + strings.Repeat(`<circle cx="1" cy="1" r="1"/>`, 5000) + `</svg>`
	if _, err := sanitizeClubIconSVG(big); err == nil {
		t.Errorf("expected oversize rejection")
	}
}
