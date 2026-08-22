package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
)

// ─── Markets SSE ────────────────────────────────────────────────────────────
// Two streams, mirroring the Skull King hub:
//   GET /markets/:id/events       — per-market price/pool updates (PlaceBet)
//   GET /markets/lobby/events     — markets-list change signal (refetch client-side)
// Like Skull King, this is in-process only (no Redis) → single backend instance.

// marketPricesEvent is the wire shape for both the initial connect frame and the
// PlaceBet broadcast (see elo.pricesPayload). Defined here so the initial state
// uses the same JSON the client parses on every update.
type marketPricesEvent struct {
	Type string `json:"type"`
	Data struct {
		Outcomes []elo.LiveOutcome `json:"outcomes"`
	} `json:"data"`
}

func (a *API) MarketEvents(c *gin.Context) {
	marketID := c.Param("id")
	ctx := c.Request.Context()

	row, err := a.MarketService.GetMarket(ctx, marketID)
	if err != nil {
		ErrorResponse(c, http.StatusNotFound, "market not found")
		return
	}
	outcomeRows, err := a.MarketService.ListMarketOutcomesWithPools(ctx, marketID)
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, "failed to load outcomes")
		return
	}

	ch, cancel := a.MarketsHub.Subscribe(marketID)
	defer cancel()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Send current prices immediately on connect. The frame bypasses
	// EncodeIDsMiddleware (SSE is not buffered application/json), so the short
	// id encoding is applied here to match every other payload.
	q := make([]float64, len(outcomeRows))
	for i, o := range outcomeRows {
		q[i] = o.Q
	}
	prices := elo.MarginalPricesN(q, row.LiquidityB)
	evt := marketPricesEvent{Type: "prices"}
	for i, o := range outcomeRows {
		evt.Data.Outcomes = append(evt.Data.Outcomes, elo.LiveOutcome{
			ID:     shortid.FromCanonical(o.ID),
			Price:  prices[i],
			Shares: o.Q,
			Pool:   o.Pool,
		})
	}
	if payload, err := json.Marshal(evt); err == nil {
		fmt.Fprintf(c.Writer, "data: %s\n\n", payload)
		c.Writer.Flush()
	}

	// Heartbeat keeps the connection alive across proxies/NAT/VPNs (see
	// SkullKingTableEvents for rationale). Sent as an SSE comment frame.
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	clientGone := ctx.Done()
	for {
		select {
		case <-clientGone:
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(c.Writer, "data: %s\n\n", msg)
			c.Writer.Flush()
		case <-heartbeat.C:
			fmt.Fprintf(c.Writer, ": heartbeat\n\n")
			c.Writer.Flush()
		}
	}
}

// MarketsLobbyEvents signals subscribers whenever the set of markets changes
// (create/delete/bet/close). Carries no payload — clients refetch on each signal.
func (a *API) MarketsLobbyEvents(c *gin.Context) {
	ctx := c.Request.Context()

	ch, cancel := a.MarketsHub.SubscribeLobby()
	defer cancel()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Send an initial signal so the client syncs immediately on connect.
	if payload, err := json.Marshal(sseTableEvent{Type: "markets-changed"}); err == nil {
		fmt.Fprintf(c.Writer, "data: %s\n\n", payload)
		c.Writer.Flush()
	}

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	clientGone := ctx.Done()
	for {
		select {
		case <-clientGone:
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(c.Writer, "data: %s\n\n", msg)
			c.Writer.Flush()
		case <-heartbeat.C:
			fmt.Fprintf(c.Writer, ": heartbeat\n\n")
			c.Writer.Flush()
		}
	}
}
