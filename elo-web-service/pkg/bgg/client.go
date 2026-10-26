// Package bgg is a minimal client for the BoardGameGeek XML API2. It powers
// two features: the games-catalogue enrichment with box art (ADR-30) and the
// BGG-first game suggestions — /xmlapi2/search finds candidates by name,
// /xmlapi2/thing carries their localized titles as alternate names (ADR-31).
//
// Access requires a registered application token
// (https://boardgamegeek.com/using_the_xml_api): requests carry an
// Authorization: Bearer header, go to boardgamegeek.com without the www
// prefix, and must be kept to a minimum — the documented guidance is to cache
// results server-side and pace requests at least five seconds apart (floods
// answer 500/503). Every failure is expected to be treated as "no data" by
// callers, never as a hard error.
package bgg

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const DefaultBaseURL = "https://boardgamegeek.com"

// The XML API2 accepts at most 20 ids per /thing request, and BGG's guidance
// asks for at least five seconds between requests.
const (
	thingBatchSize = 20
	minSpacing     = 5 * time.Second
	maxAttempts    = 3
	// Suggestions fire per debounced keystroke, so /search answers are cached;
	// searchCacheMax bounds the memory an open-ended query stream can reach.
	searchCacheTTL = 15 * time.Minute
	searchCacheMax = 512
)

// Thing is the slice of a /xmlapi2/thing item the catalogue stores.
type Thing struct {
	BggID          int64
	PrimaryName    string
	AlternateNames []string
	ImageURL       string
	ThumbURL       string
	Year           int32
	// IsExpansion marks an expansion: BGG links it to its base game with an
	// inbound boardgameexpansion link. A base game's own expansion links —
	// outbound, listing the things that expand it — do not count.
	IsExpansion bool
}

// SearchResult is one row of /xmlapi2/search. Name is the game's name that
// matched the query — the primary title or one of its alternates.
type SearchResult struct {
	BggID    int64
	Name     string
	NameType string
	Year     int32
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
	// pacing is the wait between successive API requests; minSpacing in
	// production, shrunk by tests.
	pacing time.Duration

	mu          sync.Mutex
	searchCache map[string]searchCacheEntry
	// now is stubbed in tests to move cache expiry around.
	now func() time.Time
}

type searchCacheEntry struct {
	results []SearchResult
	expires time.Time
}

// NewClient returns nil when the token is empty: callers treat a nil client
// the same way they treat a nil Tesera client — the feature is unavailable,
// never an error.
func NewClient(baseURL, token string) *Client {
	if token == "" {
		return nil
	}
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		baseURL:     strings.TrimRight(baseURL, "/"),
		token:       token,
		http:        &http.Client{Timeout: 30 * time.Second},
		pacing:      minSpacing,
		searchCache: make(map[string]searchCacheEntry),
		now:         time.Now,
	}
}

// Search fetches boardgame matches for a query via /xmlapi2/search. Answers
// are cached per query (BGG's guidance: cache server-side, request little);
// the cache is per client, so tests get a fresh one with each NewClient.
func (c *Client) Search(ctx context.Context, query string) ([]SearchResult, error) {
	key := strings.ToLower(strings.TrimSpace(query))
	if key == "" {
		return nil, nil
	}
	if results, ok := c.cachedSearch(key); ok {
		return results, nil
	}
	q := "search?query=" + url.QueryEscape(strings.TrimSpace(query)) + "&type=boardgame"
	// The same throttling that hits /thing answers 500/503 here, and a 202
	// means the response is queued — both are retried with a growing pause.
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			if err := sleepCtx(ctx, c.pacing*time.Duration(attempt)); err != nil {
				return nil, err
			}
		}
		results, retryable, err := c.fetchSearch(ctx, q)
		if err == nil {
			c.storeSearch(key, results)
			return results, nil
		}
		lastErr = err
		if !retryable {
			return nil, err
		}
	}
	return nil, lastErr
}

func (c *Client) fetchSearch(ctx context.Context, q string) ([]SearchResult, bool, error) {
	body, retryable, err := c.getXML(ctx, "/xmlapi2/"+q)
	if err != nil {
		return nil, retryable, err
	}
	defer body.Close()
	decoder := xml.NewDecoder(io.LimitReader(body, 4<<20))
	var parsed searchResponse
	if err := decoder.Decode(&parsed); err != nil {
		return nil, false, fmt.Errorf("bgg search decode: %w", err)
	}
	results := make([]SearchResult, 0, len(parsed.Items))
	for _, item := range parsed.Items {
		result := SearchResult{BggID: item.ID}
		if item.YearPublished != nil {
			result.Year = item.YearPublished.Value
		}
		if len(item.Names) > 0 {
			result.Name = item.Names[0].Value
			result.NameType = item.Names[0].Type
		}
		results = append(results, result)
	}
	return results, false, nil
}

func (c *Client) cachedSearch(key string) ([]SearchResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.searchCache[key]
	if !ok || c.now().After(entry.expires) {
		return nil, false
	}
	return entry.results, true
}

func (c *Client) storeSearch(key string, results []SearchResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.searchCache) >= searchCacheMax {
		// Simple bound: drop everything rather than track LRU.
		c.searchCache = make(map[string]searchCacheEntry)
	}
	c.searchCache[key] = searchCacheEntry{results: results, expires: c.now().Add(searchCacheTTL)}
}

// GetThings fetches the given BGG ids via /xmlapi2/thing, batching them by
// the API's 20-id limit with the documented pacing between batches.
//
// The result is partial on failure: things from successful batches are
// returned even when err is non-nil, so callers can apply what they got and
// report the rest. Ids BGG answered without are simply absent.
func (c *Client) GetThings(ctx context.Context, ids []int64) ([]Thing, error) {
	var out []Thing
	var lastErr error
	for start := 0; start < len(ids); start += thingBatchSize {
		if start > 0 {
			if err := sleepCtx(ctx, c.pacing); err != nil {
				return out, err
			}
		}
		end := min(start+thingBatchSize, len(ids))
		things, err := c.getThingsBatch(ctx, ids[start:end])
		if err != nil {
			lastErr = errors.Join(lastErr, fmt.Errorf("bgg thing batch %d-%d: %w", start, end, err))
			continue
		}
		out = append(out, things...)
	}
	return out, lastErr
}

func (c *Client) getThingsBatch(ctx context.Context, ids []int64) ([]Thing, error) {
	q := idsParam(ids)
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			if err := sleepCtx(ctx, c.pacing*time.Duration(attempt)); err != nil {
				return nil, err
			}
		}
		things, retryable, err := c.fetchThings(ctx, q)
		if err == nil {
			return things, nil
		}
		lastErr = err
		if !retryable {
			return nil, err
		}
	}
	return nil, lastErr
}

func (c *Client) fetchThings(ctx context.Context, q string) ([]Thing, bool, error) {
	body, retryable, err := c.getXML(ctx, "/xmlapi2/thing?"+q)
	if err != nil {
		return nil, retryable, err
	}
	defer body.Close()
	decoder := xml.NewDecoder(io.LimitReader(body, 8<<20))
	var parsed thingsResponse
	if err := decoder.Decode(&parsed); err != nil {
		return nil, false, fmt.Errorf("bgg thing decode: %w", err)
	}
	things := make([]Thing, 0, len(parsed.Items))
	for _, item := range parsed.Items {
		thing := Thing{BggID: item.ID, ImageURL: item.Image, ThumbURL: item.Thumbnail}
		if item.YearPublished != nil {
			thing.Year = item.YearPublished.Value
		}
		for _, n := range item.Names {
			switch n.Type {
			case "primary":
				thing.PrimaryName = n.Value
			case "alternate":
				thing.AlternateNames = append(thing.AlternateNames, n.Value)
			}
		}
		for _, l := range item.Links {
			if l.Type == "boardgameexpansion" && l.Inbound == "true" {
				thing.IsExpansion = true
			}
		}
		things = append(things, thing)
	}
	return things, false, nil
}

// getXML performs one authenticated GET and returns the response body. The
// bool reports whether the failure is worth retrying: DDoS-guard style
// throttling answers 500/503 when requests come too fast, and a 202 means the
// response is queued.
func (c *Client) getXML(ctx context.Context, pathQuery string) (io.ReadCloser, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+pathQuery, nil)
	if err != nil {
		return nil, false, err
	}
	// The token authenticates; the API host is boardgamegeek.com without
	// the www prefix (the www host may interfere with authorization).
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, true, fmt.Errorf("bgg request failed: %w", err)
	}
	switch {
	case resp.StatusCode == http.StatusOK:
		return resp.Body, false, nil
	case resp.StatusCode == http.StatusAccepted,
		resp.StatusCode == http.StatusTooManyRequests,
		resp.StatusCode >= http.StatusInternalServerError:
		io.Copy(io.Discard, io.LimitReader(resp.Body, 512))
		resp.Body.Close()
		return nil, true, fmt.Errorf("bgg returned %d", resp.StatusCode)
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		resp.Body.Close()
		return nil, false, fmt.Errorf("bgg returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
}

type thingsResponse struct {
	Items []thingXML `xml:"item"`
}

type thingXML struct {
	ID            int64     `xml:"id,attr"`
	Names         []nameXML `xml:"name"`
	Image         string    `xml:"image"`
	Thumbnail     string    `xml:"thumbnail"`
	YearPublished *yearXML  `xml:"yearpublished"`
	Links         []linkXML `xml:"link"`
}

type searchResponse struct {
	Items []searchItemXML `xml:"item"`
}

type searchItemXML struct {
	ID            int64     `xml:"id,attr"`
	Names         []nameXML `xml:"name"`
	YearPublished *yearXML  `xml:"yearpublished"`
}

type nameXML struct {
	Type  string `xml:"type,attr"`
	Value string `xml:"value,attr"`
}

type yearXML struct {
	Value int32 `xml:"value,attr"`
}

type linkXML struct {
	Type    string `xml:"type,attr"`
	Inbound string `xml:"inbound,attr"`
}

// idsParam builds the id list of a /thing request. No type filter: BGG
// scopes it by thing subtype, so a type=boardgame lookup silently drops
// expansion and accessory things (subtype boardgameexpansion/
// boardgameaccessory) — exact-id lookups want the thing whatever it is.
func idsParam(ids []int64) string {
	parts := make([]string, len(ids))
	for i, v := range ids {
		parts[i] = fmt.Sprintf("%d", v)
	}
	return "id=" + strings.Join(parts, ",")
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
