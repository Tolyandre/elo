package api

// ─── Multiplexed global event stream ─────────────────────────────────────────
// GET /events serves every app-global topic over one SSE connection: global
// data-change signals, both lobby signals, and per-user events. Per-entity
// streams (a game table, a market) keep their dedicated endpoints — their
// full-state snapshot on connect and page-local lifetime fit a private
// connection, and riding them here would tear down every global topic on
// every navigation.
//
// The client picks topics with ?topics= (comma-separated). Each frame is
// written with the topic as the SSE *event name*, so the browser dispatches
// per topic via addEventListener(topic, ...) while the payload stays the
// usual {"type":...} envelope. "me" requires a session and is silently
// skipped for anonymous callers: the frontend only requests it while
// authenticated, and a skipped topic keeps a connection that raced a
// logout working (heartbeat-only) instead of erroring into a retry loop.

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// muxTopicMe is the client-facing name of the caller's per-user topic.
const muxTopicMe = "me"

// knownMuxTopics is the whitelist a client may request.
var knownMuxTopics = map[string]bool{
	elo.TopicData:         true,
	elo.TopicLobbyTables:  true,
	elo.TopicLobbyMarkets: true,
	muxTopicMe:            true,
}

// Events streams the requested global topics until the client goes away.
func (a *API) Events(c *gin.Context) {
	requested, ok := parseMuxTopics(c)
	if !ok {
		return // 400 already written
	}

	// "me" resolves to this caller's per-user hub topic; anonymous callers
	// just don't get it.
	userTopic := ""
	hubTopics := make([]string, 0, len(requested))
	for _, topic := range requested {
		if topic == muxTopicMe {
			if user := c.GetString(CurrentUserKey); user != "" {
				userTopic = elo.UserTopic(id.ID(user))
				hubTopics = append(hubTopics, userTopic)
			}
			continue
		}
		hubTopics = append(hubTopics, topic)
	}

	pumpSSE(c, func() (<-chan elo.TaggedFrame, func()) {
		return a.Hub.SubscribeMany(hubTopics...)
	}, nil, func(msg elo.TaggedFrame) string {
		// Re-tag the caller's user-topic frames back to the client-facing
		// "me" name; data/lobby hub topics pass through unchanged.
		topic := msg.Topic
		if topic == userTopic {
			topic = muxTopicMe
		}
		return fmt.Sprintf("event: %s\ndata: %s\n\n", topic, msg.Payload)
	})
}

// parseMuxTopics validates and dedups the ?topics= query parameter.
func parseMuxTopics(c *gin.Context) ([]string, bool) {
	fields := strings.Split(c.Query("topics"), ",")
	seen := make(map[string]struct{}, len(fields))
	topics := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if !knownMuxTopics[f] {
			ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("unknown topic %q", f))
			return nil, false
		}
		if _, dup := seen[f]; !dup {
			seen[f] = struct{}{}
			topics = append(topics, f)
		}
	}
	if len(topics) == 0 {
		ErrorResponse(c, http.StatusBadRequest, fmt.Errorf("topics query parameter required (one of: data, lobby:tables, lobby:markets, me)"))
		return nil, false
	}
	sort.Strings(topics)
	return topics, true
}
