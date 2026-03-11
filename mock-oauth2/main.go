// Package main is a minimal OAuth2/OIDC mock for local development.
// It auto-approves every login and always returns the same static dev user.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
)

func main() {
	http.HandleFunc("/auth", handleAuth)
	http.HandleFunc("/token", handleToken)
	http.HandleFunc("/userinfo", handleUserinfo)

	addr := ":8080"
	if v := os.Getenv("ADDR"); v != "" {
		addr = v
	}
	log.Printf("mock-oauth2 listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

// handleAuth redirects the browser straight to the callback — no login form.
func handleAuth(w http.ResponseWriter, r *http.Request) {
	redirectURI := r.URL.Query().Get("redirect_uri")
	state := r.URL.Query().Get("state")

	if redirectURI == "" {
		http.Error(w, "missing redirect_uri", http.StatusBadRequest)
		return
	}

	cb, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, "invalid redirect_uri", http.StatusBadRequest)
		return
	}

	q := cb.Query()
	q.Set("code", "devcode")
	if state != "" {
		q.Set("state", state)
	}
	cb.RawQuery = q.Encode()

	http.Redirect(w, r, cb.String(), http.StatusFound)
}

// handleToken returns a static token response (no code validation).
func handleToken(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"access_token": "devtoken",
		"id_token":     "devidtoken",
		"token_type":   "bearer",
	})
}

// handleUserinfo returns the static dev user.
func handleUserinfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"sub":  "dev-user-001",
		"name": "Dev User",
	})
}
