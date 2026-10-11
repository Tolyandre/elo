package tesera

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The guard's HTML challenge page must never surface through an error
// string: these land verbatim in user-facing messages.
func TestErrorsCarryNoResponseBody(t *testing.T) {
	guardPage := "<!doctype html><html><head><title>DDoS-Guard</title></head><body>challenge</body></html>"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(guardPage))
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	c.http.Timeout = time.Second
	c.retryBackoff = time.Millisecond
	_, err := c.SearchGames(context.Background(), "каркассон")
	if err == nil {
		t.Fatal("expected an error from a 403")
	}
	if strings.Contains(err.Error(), "html") || strings.Contains(err.Error(), "DDoS") {
		t.Errorf("error leaks the guard page: %q", err.Error())
	}
}
