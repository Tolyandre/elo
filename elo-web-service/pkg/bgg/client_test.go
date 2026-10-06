package bgg

import (
	"context"
	"net/http"
	"net/http/httptest"
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
