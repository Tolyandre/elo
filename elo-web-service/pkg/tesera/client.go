// Package tesera is a minimal client for the undocumented public JSON API of
// tesera.ru (the Russian board-game database). It powers game-reference
// suggestions: Tesera game objects carry the localized Russian title, the
// English title, and the BoardGameGeek id, which is exactly the metadata the
// games catalogue stores.
//
// The API has no key and no SLA, and sits behind DDos-Guard, which rejects
// non-browser user agents with 403. Every failure is expected to be treated
// as "no suggestion" by callers, never as a hard error.
package tesera

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const DefaultBaseURL = "https://api.tesera.ru"

// DDoS-Guard rejects the default Go user agent; a plain browser UA passes.
const userAgent = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"

// SearchItem is one row of GET /search/games. It identifies a game but lacks
// bggId/isAddition, which only the detail object carries.
type SearchItem struct {
	Alias    string `json:"alias"`
	TeseraID int64  `json:"teseraId"`
	Title    string `json:"title"`
	Title2   string `json:"title2"`
	PhotoURL string `json:"photoUrl"`
}

// GameDetail is the nested "game" object of GET /games/{alias}.
type GameDetail struct {
	TeseraID   int64  `json:"teseraId"`
	BggID      int64  `json:"bggId"`
	Title      string `json:"title"`
	Title2     string `json:"title2"`
	Alias      string `json:"alias"`
	Year       int32  `json:"year"`
	PhotoURL   string `json:"photoUrl"`
	IsAddition bool   `json:"isAddition"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// SearchGames returns the raw search rows for a query (base games and
// additions alike — filter via CandidateFromDetail).
func (c *Client) SearchGames(ctx context.Context, query string) ([]SearchItem, error) {
	var items []SearchItem
	if err := c.getJSON(ctx, "/search/games?query="+url.QueryEscape(query), &items); err != nil {
		return nil, err
	}
	return items, nil
}

// GetGame fetches the detail object by the search row's alias slug.
func (c *Client) GetGame(ctx context.Context, alias string) (*GameDetail, error) {
	var resp struct {
		Game GameDetail `json:"game"`
	}
	if err := c.getJSON(ctx, "/games/"+url.PathEscape(alias), &resp); err != nil {
		return nil, err
	}
	return &resp.Game, nil
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	// DDos-Guard throttles in bursts: identical requests alternate 403/200.
	// Retry throttled and transient failures with a growing pause.
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt) * 1500 * time.Millisecond):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		err := c.doGetJSON(ctx, path, out)
		if err == nil {
			return nil
		}
		lastErr = err
		if !retryable(err) {
			return err
		}
	}
	return lastErr
}

func (c *Client) doGetJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("tesera request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &httpError{status: resp.StatusCode, path: path, body: strings.TrimSpace(string(body))}
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out); err != nil {
		return fmt.Errorf("tesera %s decode: %w", path, err)
	}
	return nil
}

type httpError struct {
	status int
	path   string
	body   string
}

func (e *httpError) Error() string {
	return fmt.Sprintf("tesera %s returned %d: %s", e.path, e.status, e.body)
}

// retryable covers DDos-Guard 403 flapping, rate limiting, server errors, and
// network hiccups — not genuine 404s or client bugs.
func retryable(err error) bool {
	var he *httpError
	if errors.As(err, &he) {
		return he.status == http.StatusForbidden || he.status == http.StatusTooManyRequests || he.status >= 500
	}
	return true // network-level failure (url.Error etc.)
}
