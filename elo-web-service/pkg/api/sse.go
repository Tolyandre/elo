package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ─── SSE plumbing ────────────────────────────────────────────────────────────
// Every SSE stream in the service is served through pumpSSE: it owns the
// response headers, the optional initial frame, the heartbeat that keeps
// proxies/NATs from reaping idle connections, and the send loop. Producers
// broadcast to elo.Hub topics; handlers pick topics and a frame renderer
// (serveSSE for single-topic streams, Events for the multiplexed one).

// sseRetryMs is the reconnect interval advertised to browser EventSource
// clients (the `retry:` field), so auto-reconnects are prompt and predictable.
const sseRetryMs = 5000

// serveSSE streams one hub topic as default (payload-only) SSE frames until
// the client goes away — the per-entity streams (a game table, a market).
// subscribe is called after the headers are decided; its cancel is deferred.
// initial (optional) is written as the first data frame so clients sync
// immediately on connect — pass nil for streams whose consumers already fetch
// on mount, where an initial snapshot would double-fetch.
func (a *API) serveSSE(c *gin.Context, subscribe func() (<-chan []byte, func()), initial []byte) {
	pumpSSE(c, subscribe, initial, func(msg []byte) string {
		return fmt.Sprintf("data: %s\n\n", msg)
	})
}

// pumpSSE is the single wire-format owner for every SSE stream: headers,
// reconnect hint, optional initial frame, heartbeat, send loop. render turns
// one received message into a complete SSE block.
func pumpSSE[T any](c *gin.Context, subscribe func() (<-chan T, func()), initial []byte, render func(T) string) {
	ch, cancel := subscribe()
	defer cancel()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Explicit reconnect interval for the browser's built-in EventSource retry.
	fmt.Fprintf(c.Writer, "retry: %d\n\n", sseRetryMs)
	if initial != nil {
		fmt.Fprintf(c.Writer, "data: %s\n\n", initial)
	}
	c.Writer.Flush()

	// Heartbeat keeps the connection alive across proxies/NAT/VPNs that would
	// otherwise reap an idle stream. Sent as a *named* event: comment frames
	// keep the TCP path warm but are discarded by EventSource before any
	// handler runs, so the client's JS liveness watchdog can't see them. A
	// named event is dispatched to `addEventListener("heartbeat", ...)` only
	// (never onmessage), letting clients re-arm their watchdogs on it.
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	clientGone := c.Request.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprint(c.Writer, render(msg))
			c.Writer.Flush()
		case <-heartbeat.C:
			fmt.Fprintf(c.Writer, "event: heartbeat\ndata: %d\n\n", time.Now().Unix())
			c.Writer.Flush()
		}
	}
}

// ─── Producer helpers (handler-side broadcasts) ──────────────────────────────

// broadcastDataChange signals that match/player data changed. Payload-less —
// clients refetch, the same pattern as the lobby streams. Debouncing happens
// client-side, so bursts (e.g. offline sync pushing several matches) collapse
// into a single refetch.
func (a *API) broadcastDataChange(matches, players bool) {
	if matches {
		a.Hub.PublishSignal(elo.TopicData, "matches-changed")
	}
	if players {
		a.Hub.PublishSignal(elo.TopicData, "players-changed")
	}
}

// notifyMatchRecorded sends a match-recorded event to the user controlling
// each match player, except the acting editor (they know what they did).
// Failures are silent: a missed notification must never fail the write.
func (a *API) notifyMatchRecorded(ctx context.Context, matchID id.ID, playerIDs []id.ID, actorUserID id.ID, actorName string) {
	if len(playerIDs) == 0 {
		return
	}
	links, err := a.UserService.ListUserIDsByPlayerIDs(ctx, playerIDs)
	if err != nil {
		return
	}
	payload, err := json.Marshal(elo.SSEEvent{
		Type: "match-recorded",
		Data: map[string]string{
			// SSE frames bypass the JSON DTO layer — wire-form id (ADR-12).
			"match_id":   string(matchID.Base58()),
			"actor_name": actorName,
		},
	})
	if err != nil {
		return
	}
	for _, link := range links {
		if link.UserID == actorUserID {
			continue
		}
		a.Hub.Broadcast(elo.UserTopic(link.UserID), payload)
	}
}
