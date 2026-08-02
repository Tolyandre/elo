package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestEncodeIDsMiddleware_PanicReturns500 reproduces the bug where a handler
// panic surfaced as a 200 with an empty body (instead of 500) because gin's
// recovery middleware is registered OUTSIDE EncodeIDsMiddleware. The recovery's
// 500 write flows through the encodingResponseWriter; this test asserts the
// client-visible status is 500, not a stale 200.
func TestEncodeIDsMiddleware_PanicReturns500(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// gin.Recovery is the OUTERMOST handler here, mirroring main.go where
	// gin.Default() (Logger+Recovery) wraps EncodeIDsMiddleware.
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(EncodeIDsMiddleware())

	r.GET("/boom", func(c *gin.Context) {
		// Mimic a handler that sets 200 (as the strict visitor does) then panics
		// before writing a JSON body.
		c.Status(http.StatusOK)
		panic("simulated handler panic")
	})

	req := httptest.NewRequest(http.MethodGet, "/boom", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (a handler panic must not surface as %d)", rec.Code, rec.Code)
	}

	// Whatever body is written, it must be valid and present (not the empty body
	// that masked the bug). gin.Recovery writes nothing by default, so we only
	// require that the status is correct; a dedicated 500 JSON handler (see
	// main.go's recovery) would add a body.
	if rec.Body.Len() == 0 && rec.Code == http.StatusOK {
		t.Errorf("regression: empty body with 200 — panic was masked")
	}
	// Sanity: the buffered 200 must NOT have leaked.
	if rec.Header().Get("Content-Type") == "application/json" && rec.Code != http.StatusInternalServerError {
		t.Errorf("content-type set as JSON but status is %d, want 500", rec.Code)
	}
	_ = json.Marshal // keep import if body checks expand
}
