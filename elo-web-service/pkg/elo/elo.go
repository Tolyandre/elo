package elo

import (
	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/settlement"
)

// newSettlementID mints a server-generated UUIDv7 for settlement rows.
// Settlement ids are server-generated (ADR-06 §"server-generated ids"): the
// client never supplies them. The ids are monotonic within the process —
// id order equals creation order even within one millisecond — which the
// settlement-ordering queries rely on for the equal-date (date, id) tie-break
// (ADR-01 §22): a replay must reproduce its own write order, or a later
// same-date read silently picks an older settlement row.
func newSettlementID() id.ID {
	return id.NewMonotonic()
}

// WinExpectation and CalculateNewElo delegate to pkg/settlement — the pure
// settlement core keeps one implementation of the math; the wrappers keep
// the historical in-package signatures.
func WinExpectation(currentElo float64, playersScore map[id.ID]float64, startingElo float64,
	prevElo map[id.ID]float64, elo_const_d float64) float64 {
	return settlement.WinExpectation(currentElo, playersScore, startingElo, prevElo, elo_const_d)
}

// NormalizedScore and GetAbsoluteLoserScore live in pkg/ratingmath: the
// tournament bracket derives slot points from the same earn-part arithmetic
// (ADR-30), and the leaf package keeps that shared without a cycle.

func CalculateNewElo(previousElo map[id.ID]float64, startingElo float64, score map[id.ID]float64,
	eloConstK float64, eloConstD float64, winReward float64) map[id.ID]float64 {
	return settlement.CalculateNewElo(previousElo, startingElo, score, eloConstK, eloConstD, winReward)
}
