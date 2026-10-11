package bgg

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewClientEmptyToken(t *testing.T) {
	if c := NewClient("", ""); c != nil {
		t.Fatalf("empty token must disable the client, got %v", c)
	}
}

const twoThingsXML = `<items total="2" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
<item type="boardgame" id="13">
<thumbnail>https://cf.geekdo-images.com/0XODRpReiZBFUffEcqT5-Q__small/img/a.png</thumbnail>
<image>https://cf.geekdo-images.com/0XODRpReiZBFUffEcqT5-Q__original/img/a.png</image>
<name type="primary" sortindex="1" value="Catan"/>
<name type="alternate" sortindex="1" value="The Settlers of Catan"/>
<yearpublished value="1995"/>
</item>
<item type="boardgame" id="822">
<name type="primary" sortindex="1" value="Carcassonne"/>
<name type="alternate" sortindex="1" value="Carcassonne: Base game"/>
</item>
</items>`

func TestGetThingsParsesItems(t *testing.T) {
	var gotAuth, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "text/xml; charset=UTF-8")
		_, _ = w.Write([]byte(twoThingsXML))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "test-token")
	things, err := c.GetThings(context.Background(), []int64{13, 822})
	if err != nil {
		t.Fatalf("GetThings: %v", err)
	}
	if gotAuth != "Bearer test-token" {
		t.Errorf("Authorization header = %q", gotAuth)
	}
	if gotQuery != "id=13,822&type=boardgame" {
		t.Errorf("query = %q", gotQuery)
	}
	if len(things) != 2 {
		t.Fatalf("got %d things, want 2", len(things))
	}
	if things[0].BggID != 13 || things[0].PrimaryName != "Catan" ||
		things[0].ImageURL == "" || things[0].ThumbURL == "" {
		t.Errorf("thing[0] = %+v", things[0])
	}
	// No image/thumbnail elements — empty strings, not an error.
	if things[1].PrimaryName != "Carcassonne" || things[1].ImageURL != "" || things[1].ThumbURL != "" {
		t.Errorf("thing[1] = %+v", things[1])
	}
}

func TestGetThingsBatchesByIdLimit(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		_, _ = w.Write([]byte(twoThingsXML))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	c.pacing = time.Millisecond // shrink the documented 5s pacing for the test

	ids := make([]int64, 0, thingBatchSize+5)
	for i := range cap(ids) {
		ids = append(ids, int64(1000+i))
	}
	if _, err := c.GetThings(context.Background(), ids); err != nil {
		t.Fatalf("GetThings: %v", err)
	}
	if got := requests.Load(); got != 2 {
		t.Errorf("requests = %d, want 2 (20-id limit + pacing between batches)", got)
	}
}

func TestGetThingsRetriesThrottled(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("too frequent"))
			return
		}
		_, _ = w.Write([]byte(twoThingsXML))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	c.pacing = time.Millisecond
	things, err := c.GetThings(context.Background(), []int64{13})
	if err != nil {
		t.Fatalf("GetThings after retry: %v", err)
	}
	if len(things) != 2 {
		t.Errorf("things = %d, want 2", len(things))
	}
}

func TestGetThingsPartialBatchFailure(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// First batch succeeds, second batch keeps failing.
		if requests.Add(1) > 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(twoThingsXML))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	c.pacing = time.Millisecond

	ids := make([]int64, 0, thingBatchSize+2)
	for i := range cap(ids) {
		ids = append(ids, int64(2000+i))
	}
	things, err := c.GetThings(context.Background(), ids)
	if err == nil {
		t.Fatal("expected an error when a batch keeps failing")
	}
	if len(things) != 2 {
		t.Errorf("partial result = %d things, want the first batch's 2", len(things))
	}
}

func TestGetThingsFatalStatusNotRetried(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("Unauthorized"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	c.pacing = time.Millisecond
	if _, err := c.GetThings(context.Background(), []int64{13}); err == nil {
		t.Fatal("expected an error for a 401")
	}
	if got := requests.Load(); got != 1 {
		t.Errorf("requests = %d, want 1 (401 is not retryable)", got)
	}
}

const thingWithExpansionLinkXML = `<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
<item type="boardgame" id="4101">
<name type="primary" sortindex="1" value="Carcassonne: The River"/>
<name type="alternate" sortindex="1" value="Каркассон. Река"/>
<yearpublished value="2001"/>
<link type="boardgameexpansion" id="822" value="Carcassonne"/>
</item>
<item type="boardgame" id="822">
<name type="primary" sortindex="1" value="Carcassonne"/>
<link type="boardgameexpansion" id="4101" inbound="true" value="The River"/>
</item>
</items>`

func TestGetThingsParsesAlternatesYearsAndExpansionLinks(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(thingWithExpansionLinkXML))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	things, err := c.GetThings(context.Background(), []int64{4101, 822})
	if err != nil {
		t.Fatalf("GetThings: %v", err)
	}
	if len(things) != 2 {
		t.Fatalf("things = %d, want 2", len(things))
	}
	river := things[0]
	if river.PrimaryName != "Carcassonne: The River" || river.Year != 2001 || !river.IsExpansion {
		t.Errorf("river = %+v, want primary name, year and the expansion mark", river)
	}
	if len(river.AlternateNames) != 1 || river.AlternateNames[0] != "Каркассон. Река" {
		t.Errorf("river alternates = %v", river.AlternateNames)
	}
	base := things[1]
	// Inbound links are the base game's list of expansions, not a mark.
	if base.IsExpansion || base.Year != 0 || len(base.AlternateNames) != 0 {
		t.Errorf("base = %+v, want no expansion mark, year or alternates", base)
	}
}

func TestSearchParsesRowsAndCaches(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "Bearer t" {
			t.Errorf("missing auth header")
		}
		if want := "query=" + url.QueryEscape(r.URL.Query().Get("query")) + "&type=boardgame"; r.URL.RawQuery != want {
			t.Errorf("query = %q, want %q", r.URL.RawQuery, want)
		}
		_, _ = w.Write([]byte(`<items total="2" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
<item type="boardgame" id="822"><name type="alternate" value="Каркассон"/><yearpublished value="2000"/></item>
<item type="boardgame" id="4101"><name type="primary" value="Carcassonne: The River"/><yearpublished value="2001"/></item>
</items>`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	first, err := c.Search(context.Background(), "Каркассон")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(first) != 2 {
		t.Fatalf("rows = %+v", first)
	}
	if first[0].BggID != 822 || first[0].Name != "Каркассон" || first[0].NameType != "alternate" || first[0].Year != 2000 {
		t.Errorf("row[0] = %+v", first[0])
	}
	if first[1].NameType != "primary" || first[1].Name != "Carcassonne: The River" || first[1].Year != 2001 {
		t.Errorf("row[1] = %+v", first[1])
	}

	// The cached answer serves the repeated query without a request.
	if _, err := c.Search(context.Background(), " каркассон "); err != nil {
		t.Fatalf("cached Search: %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("requests = %d, want 1 (second call must hit the cache)", got)
	}

	// And the cache expires.
	c.now = func() time.Time { return time.Now().Add(2 * searchCacheTTL) }
	if _, err := c.Search(context.Background(), "каркассон"); err != nil {
		t.Fatalf("expired Search: %v", err)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("requests = %d, want 2 after expiry", got)
	}
}

func TestSearchRetriesThrottled(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`<items total="0"></items>`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	c.pacing = time.Millisecond
	rows, err := c.Search(context.Background(), "catan")
	if err != nil {
		t.Fatalf("Search after retry: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("rows = %+v, want empty", rows)
	}
}

func TestSearchEmptyQuerySkipsRequest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("empty query must not reach the API")
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "t")
	rows, err := c.Search(context.Background(), "   ")
	if err != nil || rows != nil {
		t.Errorf("Search(whitespace) = %v, %v", rows, err)
	}
}
