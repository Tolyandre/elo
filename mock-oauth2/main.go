// Package main is a minimal OAuth2/OIDC mock for local development.
// Instead of a real login page it shows a user picker: log in as any user
// already stored in the dev database, or enter a new name to log in as a
// fresh user (the backend creates it on first login). The chosen identity
// travels statelessly — it is embedded in the authorization code and carried
// through to the access token — so the mock keeps no session state.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Fallback identity, returned when no selection was made (e.g. an /auth
// redirect whose code never passed through the picker). This is the user the
// mock historically always returned.
const (
	defaultSub  = "dev-user-001"
	defaultName = "Dev User"
)

// identity is the user the mock vouches for.
type identity struct {
	Sub  string `json:"sub"`
	Name string `json:"name"`
}

const identityPrefix = "dev1."

func encodeIdentity(id identity) string {
	b, err := json.Marshal(id)
	if err != nil {
		return identityPrefix + base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"`+defaultSub+`","name":"`+defaultName+`"}`))
	}
	return identityPrefix + base64.RawURLEncoding.EncodeToString(b)
}

func parseIdentity(s string) (identity, bool) {
	var id identity
	enc, ok := strings.CutPrefix(s, identityPrefix)
	if !ok {
		return id, false
	}
	b, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return id, false
	}
	if err := json.Unmarshal(b, &id); err != nil || id.Sub == "" {
		return id, false
	}
	return id, true
}

// dbpool is nil when DB_DSN is unset or invalid; the picker then offers only
// the new-user form.
var dbpool *pgxpool.Pool

func main() {
	connectDB()

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

func connectDB() {
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		log.Printf("DB_DSN not set — the login page will not list existing users")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Printf("invalid DB_DSN (%v) — the login page will not list existing users", err)
		return
	}
	if err := pool.Ping(ctx); err != nil {
		log.Printf("database unreachable (%v) — will retry on every login-page load", err)
	}
	dbpool = pool
}

func listUsers(ctx context.Context) ([]identity, error) {
	if dbpool == nil {
		return nil, fmt.Errorf("DB_DSN is not configured")
	}
	rows, err := dbpool.Query(ctx,
		`SELECT google_oauth_user_id, google_oauth_user_name FROM users ORDER BY google_oauth_user_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []identity
	for rows.Next() {
		var u identity
		if err := rows.Scan(&u.Sub, &u.Name); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// handleAuth renders the user picker on GET. A submission (radio button for an
// existing user, or a display name for a new one) redirects to the OAuth
// callback with the chosen identity embedded in the code.
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

	pick := r.URL.Query().Get("pick")
	newName := strings.TrimSpace(r.URL.Query().Get("new_name"))

	var id identity
	switch {
	case newName != "":
		id = identity{Sub: newSubFor(newName), Name: newName}
	case pick != "":
		var ok bool
		if id, ok = parseIdentity(pick); !ok {
			http.Error(w, "invalid user selection", http.StatusBadRequest)
			return
		}
	default:
		renderPicker(w, r, redirectURI, state, "")
		return
	}

	q := cb.Query()
	q.Set("code", encodeIdentity(id))
	if state != "" {
		q.Set("state", state)
	}
	cb.RawQuery = q.Encode()

	http.Redirect(w, r, cb.String(), http.StatusFound)
}

func renderPicker(w http.ResponseWriter, r *http.Request, redirectURI, state, errMsg string) {
	users, err := listUsers(r.Context())

	var b strings.Builder
	b.WriteString(`<!doctype html>
<html><head><meta charset="utf-8"><title>mock-oauth2</title><style>
body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#222}
h1{font-size:1.3rem} fieldset{margin:1rem 0;border:1px solid #ccc;border-radius:6px}
label{display:block;padding:.25rem 0} code{color:#666;font-size:.85em}
.warn{color:#a33} .err{color:#a33;font-weight:600}
button{padding:.4rem 1.2rem;font-size:1rem}
</style></head><body>
<h1>mock-oauth2 — pick a user</h1>
<p>This is the local development login. Choose who you want to be for this
browser, then log in. Each browser keeps its own choice.</p>`)
	if errMsg != "" {
		fmt.Fprintf(&b, `<p class="err">%s</p>`, html.EscapeString(errMsg))
	}
	b.WriteString(`<form method="get" action="/auth">`)
	fmt.Fprintf(&b, `<input type="hidden" name="redirect_uri" value="%s">`, html.EscapeString(redirectURI))
	fmt.Fprintf(&b, `<input type="hidden" name="state" value="%s">`, html.EscapeString(state))

	switch {
	case err == nil && len(users) > 0:
		b.WriteString(`<fieldset><legend>Existing users</legend>`)
		for _, u := range users {
			fmt.Fprintf(&b,
				`<label><input type="radio" name="pick" value="%s"> %s <code>(%s)</code></label>`,
				html.EscapeString(encodeIdentity(u)), html.EscapeString(u.Name), html.EscapeString(u.Sub))
		}
		b.WriteString(`</fieldset>`)
	case err != nil:
		fmt.Fprintf(&b, `<p class="warn">Could not load users from the database: %s</p>`, html.EscapeString(err.Error()))
	default:
		b.WriteString(`<p class="warn">No users in the database yet.</p>`)
	}

	b.WriteString(`<fieldset><legend>New user</legend>
<label>Display name: <input type="text" name="new_name" placeholder="e.g. Test Admin">
(the sub is derived from the name, so the same name always logs into the same user; the backend creates the user on first login)</label>
</fieldset>
<button type="submit">Log in</button>
</form></body></html>`)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(b.String()))
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// newSubFor derives a stable sub from the display name so logging in twice
// with the same name lands on the same user instead of creating duplicates.
func newSubFor(name string) string {
	slug := strings.Trim(slugRe.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		slug = "user"
	}
	if len(slug) > 24 {
		slug = slug[:24]
	}
	sum := sha256.Sum256([]byte(name))
	return fmt.Sprintf("dev-%s-%s", slug, hex.EncodeToString(sum[:2]))
}

// handleToken returns a token response. The access token carries the chosen
// identity so /userinfo can decode it without server-side state.
func handleToken(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIdentity(r.PostFormValue("code"))
	if !ok {
		id = identity{Sub: defaultSub, Name: defaultName}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"access_token": encodeIdentity(id),
		"id_token":     encodeIdentity(id),
		"token_type":   "bearer",
	})
}

// handleUserinfo reports the identity embedded in the access token (query
// parameter, falling back to the Authorization header), or the static dev
// user for tokens issued by older mock versions.
func handleUserinfo(w http.ResponseWriter, r *http.Request) {
	id, ok := identityFromRequest(r)
	if !ok {
		id = identity{Sub: defaultSub, Name: defaultName}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"sub":  id.Sub,
		"name": id.Name,
	})
}

func identityFromRequest(r *http.Request) (identity, bool) {
	token := r.URL.Query().Get("access_token")
	if token == "" {
		if fields := strings.Fields(r.Header.Get("Authorization")); len(fields) == 2 && strings.EqualFold(fields[0], "Bearer") {
			token = fields[1]
		}
	}
	return parseIdentity(token)
}
