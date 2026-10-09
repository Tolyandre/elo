package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestJSONRecovery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("panic answers 500 with the fail envelope", func(t *testing.T) {
		router := gin.New()
		router.Use(JSONRecovery())
		router.GET("/boom", func(c *gin.Context) {
			panic("arena replay exploded")
		})

		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/boom", nil))

		if res.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", res.Code)
		}
		var body struct {
			Status  string `json:"status"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatalf("body is not JSON: %v (%q)", err, res.Body.String())
		}
		if body.Status != StatusFail {
			t.Errorf("status = %q, want %q", body.Status, StatusFail)
		}
		if body.Message != "panic: arena replay exploded" {
			t.Errorf("message = %q, want the panic value", body.Message)
		}
	})

	t.Run("handler chain continues through a normal request", func(t *testing.T) {
		router := gin.New()
		router.Use(JSONRecovery())
		router.GET("/ok", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": StatusSuccess})
		})

		res := httptest.NewRecorder()
		router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/ok", nil))

		if res.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", res.Code)
		}
	})
}
