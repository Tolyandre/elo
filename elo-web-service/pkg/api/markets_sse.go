package api

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	elo "github.com/tolyandre/elo-web-service/pkg/elo"
)

// ─── Markets SSE ────────────────────────────────────────────────────────────
// GET /markets/:id/events — per-market probability/pool updates (PlaceBet),
// served through serveSSE (see sse.go). The markets-list change signal rides
// the multiplexed /events endpoint (events_mux.go).
// In-process hub only (no Redis) → single backend instance.

// MarketEvents streams live LMSR probabilities. On connect it sends the current
// snapshot; afterwards every PlaceBet broadcast arrives on the same topic.
func (a *API) MarketEvents(c *gin.Context) {
	marketID := parseIDParam(c.Param("id"))
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

	// Send current probabilities immediately on connect. SSE frames bypass the
	// JSON DTO layer, so the wire-form encoding is applied here (ADR-12).
	q := make([]float64, len(outcomeRows))
	for i, o := range outcomeRows {
		q[i] = o.Q
	}
	probabilities := elo.MarginalProbabilitiesN(q, row.LiquidityB)
	outcomes := make([]elo.LiveOutcome, 0, len(outcomeRows))
	for i, o := range outcomeRows {
		outcomes = append(outcomes, elo.LiveOutcome{
			ID:          string(o.ID.Base58()),
			Probability: probabilities[i],
			Shares:      o.Q,
			Pool:        o.Pool,
		})
	}
	initial, err := json.Marshal(elo.SSEEvent{Type: "probabilities", Data: elo.ProbabilitiesPayload{Outcomes: outcomes}})
	if err != nil {
		ErrorResponse(c, http.StatusInternalServerError, "failed to encode initial state")
		return
	}

	a.serveSSE(c, func() (<-chan []byte, func()) {
		return a.Hub.Subscribe(elo.MarketTopic(marketID))
	}, initial)
}

