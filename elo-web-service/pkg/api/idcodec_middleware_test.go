package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
)

const testUUID = "018f6b48-3e0b-7c3f-8d2b-0a1b2c3d4e5f"

func newTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(EncodeIDsMiddleware())
	r.Use(DecodeIDsMiddleware())
	return r
}

// shortFor returns the short encoding of testUUID, failing the test on error.
func shortFor(t *testing.T, canonical string) string {
	t.Helper()
	s, err := shortid.Encode(canonical)
	if err != nil {
		t.Fatalf("shortid.Encode(%q): %v", canonical, err)
	}
	return s
}

// --- Inbound decode --------------------------------------------------------

func TestDecode_PathParam(t *testing.T) {
	r := newTestRouter()
	var got string
	r.GET("/players/:id", func(c *gin.Context) {
		got = c.Param("id")
		c.Status(http.StatusOK)
	})

	short := shortFor(t, testUUID)
	req := httptest.NewRequest(http.MethodGet, "/players/"+short, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got != testUUID {
		t.Errorf("handler saw path id %q, want canonical %q", got, testUUID)
	}
}

func TestDecode_PathParam_CanonicalPassesThrough(t *testing.T) {
	r := newTestRouter()
	var got string
	r.GET("/players/:id", func(c *gin.Context) {
		got = c.Param("id")
		c.Status(http.StatusOK)
	})

	// A canonical UUID must still work (backward compatibility).
	req := httptest.NewRequest(http.MethodGet, "/players/"+testUUID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if got != testUUID {
		t.Errorf("handler saw path id %q, want %q", got, testUUID)
	}
}

func TestDecode_QueryParam(t *testing.T) {
	r := newTestRouter()
	var gameID, playerID string
	r.GET("/matches", func(c *gin.Context) {
		gameID = c.Query("game_id")
		playerID = c.Query("player_id")
		c.Status(http.StatusOK)
	})

	short := shortFor(t, testUUID)
	req := httptest.NewRequest(http.MethodGet, "/matches?game_id="+short+"&player_id="+short, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if gameID != testUUID {
		t.Errorf("game_id = %q, want %q", gameID, testUUID)
	}
	if playerID != testUUID {
		t.Errorf("player_id = %q, want %q", playerID, testUUID)
	}
}

func TestDecode_QueryParam_NextCursorUntouched(t *testing.T) {
	r := newTestRouter()
	var next string
	r.GET("/matches", func(c *gin.Context) {
		next = c.Query("next")
		c.Status(http.StatusOK)
	})

	cursor := "eyJHYW1lSUQiOiIwMThmNmI0OC0zZTBiLTdjM2YtOGQyYi0wYTFiMmMzZDRlNWYifQ=="
	req := httptest.NewRequest(http.MethodGet, "/matches?next="+cursor, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if next != cursor {
		t.Errorf("next cursor = %q, want %q (must not be decoded)", next, cursor)
	}
}

func TestDecode_Body_SingleIDAndArray(t *testing.T) {
	r := newTestRouter()
	var body []byte
	r.POST("/games", func(c *gin.Context) {
		body, _ = io.ReadAll(c.Request.Body)
		c.Status(http.StatusOK)
	})

	short := shortFor(t, testUUID)
	in := map[string]any{
		"id":                  short,
		"name":                "Chess",
		"target_player_id":    short,
		"required_player_ids": []any{short, short},
		"game_ids":            []any{short},
	}
	raw, _ := json.Marshal(in)

	req := httptest.NewRequest(http.MethodPost, "/games", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("handler body not JSON: %v", err)
	}
	if got["id"] != testUUID {
		t.Errorf("body id = %v, want %q", got["id"], testUUID)
	}
	if got["target_player_id"] != testUUID {
		t.Errorf("body target_player_id = %v, want %q", got["target_player_id"], testUUID)
	}
	arr, _ := got["required_player_ids"].([]any)
	if len(arr) != 2 || arr[0] != testUUID || arr[1] != testUUID {
		t.Errorf("required_player_ids = %v, want all %q", arr, testUUID)
	}
	gids, _ := got["game_ids"].([]any)
	if len(gids) != 1 || gids[0] != testUUID {
		t.Errorf("game_ids = %v, want [%q]", gids, testUUID)
	}
}

func TestDecode_Body_ScoreMapKeys(t *testing.T) {
	r := newTestRouter()
	var body []byte
	r.POST("/matches", func(c *gin.Context) {
		body, _ = io.ReadAll(c.Request.Body)
		c.Status(http.StatusOK)
	})

	short := shortFor(t, testUUID)
	// score is an object whose KEYS are player ids.
	in := map[string]any{
		"id":      short,
		"game_id": short,
		"score": map[string]any{
			short: 3.5,
		},
	}
	raw, _ := json.Marshal(in)

	req := httptest.NewRequest(http.MethodPost, "/matches", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("handler body not JSON: %v", err)
	}
	score, ok := got["score"].(map[string]any)
	if !ok {
		t.Fatalf("score not an object: %v", got["score"])
	}
	if _, ok := score[testUUID]; !ok {
		t.Errorf("score keys = %v, want key %q", scoreKeys(score), testUUID)
	}
}

func TestDecode_Body_NonJSONUntouched(t *testing.T) {
	r := newTestRouter()
	var ct string
	var body []byte
	r.POST("/voice/parse", func(c *gin.Context) {
		ct = c.GetHeader("Content-Type")
		body, _ = io.ReadAll(c.Request.Body)
		c.Status(http.StatusOK)
	})

	raw := []byte("\x00\x01\x02binary-not-json")
	req := httptest.NewRequest(http.MethodPost, "/voice/parse", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/octet-stream")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if ct != "application/octet-stream" {
		t.Errorf("content-type = %q", ct)
	}
	if !bytes.Equal(body, raw) {
		t.Errorf("body mutated: got %v, want %v", body, raw)
	}
}

// --- Outbound encode -------------------------------------------------------

func TestEncode_Response_BodyShortened(t *testing.T) {
	r := newTestRouter()
	r.GET("/players/:id", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data": gin.H{
				"id":   c.Param("id"), // canonical inside the handler
				"name": "Alice",
			},
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/players/"+testUUID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var resp struct {
		Data struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not JSON: %v (body=%q)", err, w.Body.String())
	}
	wantShort := shortFor(t, testUUID)
	if resp.Data.ID != wantShort {
		t.Errorf("response id = %q, want short %q", resp.Data.ID, wantShort)
	}
	if resp.Data.Name != "Alice" {
		t.Errorf("response name = %q (must be untouched)", resp.Data.Name)
	}
	// Content-Length must match the rewritten body.
	if cl := w.Header().Get("Content-Length"); cl != "" && cl != strconv.Itoa(w.Body.Len()) {
		t.Errorf("Content-Length = %q, want %d", cl, w.Body.Len())
	}
}

func TestEncode_Response_ScoreMapKeysShortened(t *testing.T) {
	r := newTestRouter()
	r.GET("/matches/:id", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"id": c.Param("id"),
			"score": gin.H{
				testUUID: 4.0,
			},
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/matches/"+testUUID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp struct {
		ID    string         `json:"id"`
		Score map[string]any `json:"score"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	wantShort := shortFor(t, testUUID)
	if _, ok := resp.Score[wantShort]; !ok {
		t.Errorf("score keys = %v, want key %q", scoreKeys(resp.Score), wantShort)
	}
	for k := range resp.Score {
		if strings.Contains(k, "-") {
			t.Errorf("score key %q still canonical", k)
		}
	}
}

func TestEncode_Response_NonJSONPassthrough(t *testing.T) {
	r := newTestRouter()
	r.GET("/icon", func(c *gin.Context) {
		c.Data(http.StatusOK, "image/svg+xml", []byte("<svg>"+testUUID+"</svg>"))
	})

	req := httptest.NewRequest(http.MethodGet, "/icon", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/svg+xml") {
		t.Fatalf("Content-Type = %q, want image/svg+xml", ct)
	}
	// The canonical UUID must be present verbatim (no encoding in SVG).
	if !strings.Contains(w.Body.String(), testUUID) {
		t.Errorf("SVG body unexpectedly rewritten: %q", w.Body.String())
	}
}

func TestEncode_Response_StatusPreserved(t *testing.T) {
	r := newTestRouter()
	r.POST("/games", func(c *gin.Context) {
		c.JSON(http.StatusCreated, gin.H{"status": "success", "data": gin.H{"id": testUUID}})
	})

	req := httptest.NewRequest(http.MethodPost, "/games", nil)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", w.Code, http.StatusCreated)
	}
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	wantShort := shortFor(t, testUUID)
	if resp.Data.ID != wantShort {
		t.Errorf("response id = %q, want %q", resp.Data.ID, wantShort)
	}
}

// TestEncode_Response_PlayerIDsArrayShortened is a regression test for the
// club-filter / club-icon bug: Club.player_ids (formerly Club.players) is a
// []string of player ids. The encoder must shorten each element so the frontend
// can match them against short player ids.
func TestEncode_Response_PlayerIDsArrayShortened(t *testing.T) {
	r := newTestRouter()
	r.GET("/clubs", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"data": []gin.H{{
				"id":         testUUID,
				"name":       "The Club",
				"player_ids": []string{testUUID, testUUID},
			}},
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/clubs", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp struct {
		Data []struct {
			PlayerIds []string `json:"player_ids"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not JSON: %v (body=%q)", err, w.Body.String())
	}
	wantShort := shortFor(t, testUUID)
	if len(resp.Data) != 1 || len(resp.Data[0].PlayerIds) != 2 {
		t.Fatalf("unexpected shape: %+v", resp)
	}
	for i, pid := range resp.Data[0].PlayerIds {
		if pid != wantShort {
			t.Errorf("player_ids[%d] = %q, want short %q", i, pid, wantShort)
		}
	}
	// The canonical form must NOT leak through.
	if strings.Contains(w.Body.String(), testUUID) {
		t.Errorf("response leaked canonical id: %s", w.Body.String())
	}
}

// --- Tolerant passthrough --------------------------------------------------

func TestRoundTrip_NonIDStringsUntouched(t *testing.T) {
	r := newTestRouter()
	r.GET("/settings", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"key":    "some-opaque-value-not-an-id",
			"next":   "eyJiYXNlNjQiOiJjdXJzb3IifQ==", // opaque cursor
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/settings", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["key"] != "some-opaque-value-not-an-id" {
		t.Errorf("opaque key value rewritten: %v", resp["key"])
	}
	if resp["next"] != "eyJiYXNlNjQiOiJjdXJzb3IifQ==" {
		t.Errorf("next cursor rewritten: %v", resp["next"])
	}
	if resp["status"] != "success" {
		t.Errorf("status rewritten: %v", resp["status"])
	}
}

// scoreKeys returns the keys of a score-like map for error messages.
func scoreKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
