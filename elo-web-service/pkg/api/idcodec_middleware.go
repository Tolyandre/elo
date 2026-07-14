package api

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
)

// This file transforms identifiers at the HTTP boundary so that:
//   - On the wire (request + response), ids are short Base58 strings (~22 chars).
//   - Inside Go/Postgres, ids stay canonical UUID strings.
//
// The backend accepts EITHER form on input (tolerant decode), so legacy
// canonical links/bodies keep working. Responses always carry the short form,
// so client code that echoes a returned id into a URL gets short ids for free.
//
// Both middlewares are key-aware: only values under keys named `id`, `*_id`,
// `*_ids`, and the object-map `score` (whose keys are player ids) are touched.
// Opaque values like the `next` pagination cursor (a base64 blob) are ignored.

// idPathParams are path params that carry a single id value.
var idPathParams = map[string]bool{
	"id":       true,
	"userId":   true,
	"playerId": true,
}

// isSingleIDKey reports whether a JSON key holds one id string (id, *_id).
func isSingleIDKey(k string) bool {
	return k == "id" || strings.HasSuffix(k, "_id")
}

// isPluralIDKey reports whether a JSON key holds an array of id strings (*_ids).
func isPluralIDKey(k string) bool {
	return strings.HasSuffix(k, "_ids")
}

// DecodeIDsMiddleware rewrites short ids in the incoming request to canonical
// form before handlers run. It is tolerant: non-id values and already-canonical
// ids pass through untouched.
func DecodeIDsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Path params: rewrite id/userId/playerId in place.
		for i, p := range c.Params {
			if idPathParams[p.Key] {
				c.Params[i].Value = shortid.ToCanonical(p.Value)
			}
		}

		// Query params: rewrite any single-id query key (*_id). Opaque keys
		// like the `next` cursor are not matched and stay as-is.
		q := c.Request.URL.Query()
		changed := false
		for key, vals := range q {
			if !isSingleIDKey(key) {
				continue
			}
			for i, v := range vals {
				if converted := shortid.ToCanonical(v); converted != v {
					vals[i] = converted
					changed = true
				}
			}
		}
		if changed {
			c.Request.URL.RawQuery = q.Encode()
		}

		// Body: decode id-bearing values if JSON.
		if shouldDecodeBody(c) {
			body, err := io.ReadAll(c.Request.Body)
			if err == nil {
				if transformed := decodeJSONIDs(body); transformed != nil {
					c.Request.Body = io.NopCloser(bytes.NewReader(transformed))
					c.Request.ContentLength = int64(len(transformed))
				} else {
					// Restore the body for the handler either way.
					c.Request.Body = io.NopCloser(bytes.NewReader(body))
				}
			} else {
				_ = c.Request.Body.Close()
			}
		}

		c.Next()
	}
}

// shouldDecodeBody reports whether the request has a JSON body worth walking.
func shouldDecodeBody(c *gin.Context) bool {
	ct := c.GetHeader("Content-Type")
	return strings.HasPrefix(ct, "application/json") && c.Request.Body != nil
}

// decodeJSONIDs walks a JSON payload and rewrites id-bearing values to
// canonical form. Returns nil if nothing changed (caller keeps original bytes).
func decodeJSONIDs(raw []byte) []byte {
	var node any
	if err := json.Unmarshal(raw, &node); err != nil {
		return nil // not valid JSON; leave untouched
	}
	if walkDecode(node) == unchanged {
		return nil
	}
	out, err := json.Marshal(node)
	if err != nil {
		return nil
	}
	return out
}

const (
	changed   = true
	unchanged = false
)

// walkDecode recursively rewrites id-bearing values in v in place.
// Returns whether anything was rewritten. Maps decoded from JSON are
// map[string]any, slices are []any, so we mutate them directly.
func walkDecode(v any) bool {
	switch n := v.(type) {
	case map[string]any:
		dirty := false
		for k, val := range n {
			switch {
			case isPluralIDKey(k):
				if arr, ok := val.([]any); ok {
					for i, el := range arr {
						if s, ok := el.(string); ok {
							if c := shortid.ToCanonical(s); c != s {
								arr[i] = c
								dirty = true
							}
						}
					}
				}
			case isSingleIDKey(k):
				if s, ok := val.(string); ok {
					if c := shortid.ToCanonical(s); c != s {
						n[k] = c
						dirty = true
					}
				}
			case k == "score":
				// score is an object whose KEYS are player ids.
				if m, ok := val.(map[string]any); ok {
					newM := make(map[string]any, len(m))
					for pk, pv := range m {
						newM[shortid.ToCanonical(pk)] = pv
						if walkDecode(pv) {
							dirty = true
						}
					}
					n[k] = newM
					dirty = true // always rebuild; key set may differ
				}
			default:
				if walkDecode(val) {
					dirty = true
				}
			}
		}
		return dirty
	case []any:
		dirty := false
		for _, el := range n {
			if walkDecode(el) {
				dirty = true
			}
		}
		return dirty
	default:
		return false
	}
}

// EncodeIDsMiddleware wraps the response writer so that JSON responses carry
// short ids. Non-JSON responses (SSE streams, SVG icons, redirects) bypass the
// buffer and are written through verbatim.
func EncodeIDsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		w := &encodingResponseWriter{ResponseWriter: c.Writer}
		c.Writer = w
		c.Next()
		// finalize emits the rewritten body for buffered JSON responses. It is
		// deliberately unexported so it does NOT shadow gin's http.Flusher.Flush,
		// which SSE handlers call mid-request via c.Writer.Flush().
		w.finalize()
	}
}

// encodingResponseWriter buffers application/json responses so they can be
// rewritten; all other content is passed through immediately.
//
// The Content-Type is only known once gin's render layer calls
// writeContentType (which runs in Render, AFTER c.Status sets the code). So we
// cannot decide whether to buffer at WriteHeader time. Instead we defer the
// decision to the first Write — by then the Content-Type header is set — and
// capture the status code lazily. For buffered responses both the status and
// the body are emitted in finalize(), so the rewritten Content-Length is set
// before any byte reaches the real ResponseWriter.
type encodingResponseWriter struct {
	gin.ResponseWriter
	buf         bytes.Buffer
	buffering   bool
	decided     bool
	deferred    int // status code captured while buffering
	hasDeferred bool
}

// mediaType returns the Content-Type without parameters ("; charset=utf-8").
func mediaType(ct string) string {
	ct = strings.TrimSpace(strings.Split(ct, ";")[0])
	return strings.ToLower(ct)
}

// decide inspects the now-known Content-Type and picks buffering vs passthrough.
// Called lazily from the first Write (and from finalize as a safety net).
func (w *encodingResponseWriter) decide() {
	if w.decided {
		return
	}
	w.decided = true
	if mediaType(w.Header().Get("Content-Type")) == "application/json" {
		w.buffering = true
	}
}

func (w *encodingResponseWriter) WriteHeader(code int) {
	// Defer the decision; just remember the code. The real header is written
	// either by the inherited WriteHeader (passthrough path, from Write below)
	// or in finalize (buffering path).
	w.deferred = code
	w.hasDeferred = true
	if w.decided && !w.buffering {
		w.ResponseWriter.WriteHeader(code)
	}
}

// WriteHeaderNow is invoked by gin's render layer to flush the status header.
// We must defer this until decide() has run (i.e. until the first Write), so
// here we only forward it once we've committed to the passthrough path.
func (w *encodingResponseWriter) WriteHeaderNow() {
	if w.decided && !w.buffering {
		w.ResponseWriter.WriteHeaderNow()
	}
}

func (w *encodingResponseWriter) Write(b []byte) (int, error) {
	w.decide()
	if !w.buffering {
		// Passthrough: let gin's underlying Write (which calls WriteHeaderNow)
		// send the captured status and the bytes verbatim.
		return w.ResponseWriter.Write(b)
	}
	return w.buf.Write(b)
}

// WriteString mirrors Write so gin's WriteString helper also buffers when we
// are rewriting JSON (it would otherwise bypass Write and write straight through).
func (w *encodingResponseWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// finalize emits the rewritten body for buffered JSON responses (status code
// then body, with the corrected Content-Length). For non-buffered responses it
// is a no-op (writes already went through to the client).
func (w *encodingResponseWriter) finalize() {
	w.decide()
	if !w.buffering || w.buf.Len() == 0 {
		return
	}
	encoded := encodeJSONIDs(w.buf.Bytes())
	w.Header().Set("Content-Length", strconv.Itoa(len(encoded)))
	if w.hasDeferred {
		w.ResponseWriter.WriteHeader(w.deferred)
	} else {
		w.ResponseWriter.WriteHeader(200) // implicit default
	}
	_, _ = w.ResponseWriter.Write(encoded)
}

// encodeJSONIDs walks a JSON payload and rewrites canonical ids under
// id-bearing keys to short form. Falls back to the original bytes on error.
func encodeJSONIDs(raw []byte) []byte {
	var node any
	if err := json.Unmarshal(raw, &node); err != nil {
		return raw
	}
	walkEncode(node)
	if out, err := json.Marshal(node); err == nil {
		return out
	}
	return raw
}

// walkEncode recursively rewrites id-bearing values in v to short form.
func walkEncode(v any) {
	switch n := v.(type) {
	case map[string]any:
		for k, val := range n {
			switch {
			case isPluralIDKey(k):
				if arr, ok := val.([]any); ok {
					for i, el := range arr {
						if s, ok := el.(string); ok {
							arr[i] = shortid.FromCanonical(s)
						}
					}
				}
			case isSingleIDKey(k):
				if s, ok := val.(string); ok {
					n[k] = shortid.FromCanonical(s)
				}
			case k == "score":
				if m, ok := val.(map[string]any); ok {
					newM := make(map[string]any, len(m))
					for pk, pv := range m {
						newM[shortid.FromCanonical(pk)] = pv
						walkEncode(pv)
					}
					n[k] = newM
				}
			default:
				walkEncode(val)
			}
		}
	case []any:
		for _, el := range n {
			walkEncode(el)
		}
	}
}
