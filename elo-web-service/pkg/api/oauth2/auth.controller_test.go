package api

import (
	"testing"

	cfg "github.com/tolyandre/elo-web-service/pkg/configuration"
)

func TestAllowedFrontendUri(t *testing.T) {
	cfg.Config.FrontendUri = "https://tolyandre.github.io/elo"
	cfg.Config.AllowedFrontendUris = []string{"https://toly.is-cool.dev/elo", "http://localhost:3000"}
	defer func() {
		cfg.Config.FrontendUri = ""
		cfg.Config.AllowedFrontendUris = nil
	}()

	tests := []struct {
		name string
		uri  string
		want bool
	}{
		{"primary frontend_uri", "https://tolyandre.github.io/elo", true},
		{"listed mirror", "https://toly.is-cool.dev/elo", true},
		{"dev localhost", "http://localhost:3000", true},
		{"deep path on a listed origin", "https://toly.is-cool.dev/elo/settings", true},
		{"unlisted host", "https://evil.example.com/elo", false},
		{"listed host, wrong scheme", "http://toly.is-cool.dev/elo", false},
		{"listed host, wrong port", "https://toly.is-cool.dev:8443/elo", false},
		{"garbage input", "not a url", false},
		{"empty input", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := allowedFrontendUri(tt.uri); got != tt.want {
				t.Errorf("allowedFrontendUri(%q) = %v, want %v", tt.uri, got, tt.want)
			}
		})
	}
}

func TestFrontendCallbackUri(t *testing.T) {
	tests := []struct {
		uri  string
		want string
	}{
		{"https://tolyandre.github.io/elo", "https://tolyandre.github.io/elo/oauth2-callback"},
		{"https://toly.is-cool.dev/elo/", "https://toly.is-cool.dev/elo/oauth2-callback"},
		{"http://localhost:3000", "http://localhost:3000/oauth2-callback"},
	}
	for _, tt := range tests {
		if got := frontendCallbackUri(tt.uri); got != tt.want {
			t.Errorf("frontendCallbackUri(%q) = %q, want %q", tt.uri, got, tt.want)
		}
	}
}

func TestResolveMirror(t *testing.T) {
	cfg.Config.FrontendUri = "https://tolyandre.github.io/elo"
	cfg.Config.AllowedFrontendUris = []string{"https://toly.is-cool.dev/elo"}
	defer func() {
		cfg.Config.FrontendUri = ""
		cfg.Config.AllowedFrontendUris = nil
	}()

	if got := resolveMirror("https://toly.is-cool.dev/elo/"); got != "https://toly.is-cool.dev/elo" {
		t.Errorf("resolveMirror(allowed with trailing slash) = %q", got)
	}
	if got := resolveMirror("https://evil.example/elo"); got != "" {
		t.Errorf("resolveMirror(unlisted) = %q, want empty", got)
	}
}
