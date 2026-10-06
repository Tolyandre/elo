// Package bgg is a minimal client for the BoardGameGeek XML API2, used to
// enrich the games catalogue with box art (ADR-30).
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
	"strings"
	"time"
)

const DefaultBaseURL = "https://boardgamegeek.com"

// The XML API2 accepts at most 20 ids per /thing request, and BGG's guidance
// asks for at least five seconds between requests.
const (
	thingBatchSize = 20
	minSpacing     = 5 * time.Second
	maxAttempts    = 3
)

// Thing is the slice of a /xmlapi2/thing item the catalogue stores.
type Thing struct {
	BggID       int64
	PrimaryName string
	ImageURL    string
	ThumbURL    string
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
	// pacing is the wait between successive API requests; minSpacing in
	// production, shrunk by tests.
	pacing time.Duration
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
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
		pacing:  minSpacing,
	}
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
	// DDos-guard style throttling on BGG's side answers 500/503 when
	// requests come too fast, and a 202 means the response is queued —
	// both are retried with a growing pause.
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/xmlapi2/thing?"+q, nil)
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
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		// fall through to parsing
	case resp.StatusCode == http.StatusAccepted,
		resp.StatusCode == http.StatusTooManyRequests,
		resp.StatusCode >= http.StatusInternalServerError:
		io.Copy(io.Discard, io.LimitReader(resp.Body, 512))
		return nil, true, fmt.Errorf("bgg returned %d", resp.StatusCode)
	default:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, false, fmt.Errorf("bgg returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	decoder := xml.NewDecoder(io.LimitReader(resp.Body, 8<<20))
	var parsed thingsResponse
	if err := decoder.Decode(&parsed); err != nil {
		return nil, false, fmt.Errorf("bgg thing decode: %w", err)
	}
	things := make([]Thing, 0, len(parsed.Items))
	for _, item := range parsed.Items {
		thing := Thing{BggID: item.ID, ImageURL: item.Image, ThumbURL: item.Thumbnail}
		for _, n := range item.Names {
			if n.Type == "primary" {
				thing.PrimaryName = n.Value
				break
			}
		}
		things = append(things, thing)
	}
	return things, false, nil
}

type thingsResponse struct {
	Items []thingXML `xml:"item"`
}

type thingXML struct {
	ID        int64     `xml:"id,attr"`
	Names     []nameXML `xml:"name"`
	Image     string    `xml:"image"`
	Thumbnail string    `xml:"thumbnail"`
}

type nameXML struct {
	Type  string `xml:"type,attr"`
	Value string `xml:"value,attr"`
}

func idsParam(ids []int64) string {
	parts := make([]string, len(ids))
	for i, v := range ids {
		parts[i] = fmt.Sprintf("%d", v)
	}
	return "id=" + strings.Join(parts, ",") + "&type=boardgame"
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
