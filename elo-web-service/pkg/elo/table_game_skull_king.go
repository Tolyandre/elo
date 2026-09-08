package elo

import (
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ─── Skull King table game ────────────────────────────────────────────────────

// skullKingGameState mirrors the TypeScript GameState. Used for structural
// validation of host writes and the conflict checks during player bid/result
// submissions. Player ids are typed so the JSON hooks canonicalize them on
// parse and shorten them on marshal (ADR-12).
type skullKingGameState struct {
	Phase              string              `json:"phase"`
	Players            []TablePlayer       `json:"players"`
	CurrentRound       int                 `json:"currentRound"`
	CurrentPlayerIndex int                 `json:"currentPlayerIndex"`
	Rounds             [][]json.RawMessage `json:"rounds"` // [roundIdx][playerIdx], null entries allowed
	FallbackGameId     *id.ID              `json:"fallbackGameId,omitempty"`
}

var skullKingPhases = map[string]bool{
	"setup":            true,
	"bidding":          true, // legacy local-only phase; tolerated on old tables
	"waiting-for-bids": true,
	"bid-review":       true,
	"result-entry":     true,
	"round-complete":   true,
}

// skullKingEntry — the concrete shape of a round entry; used for conflict checks.
type skullKingEntry struct {
	Bid    int  `json:"bid"`
	Actual *int `json:"actual"` // null = not yet entered
	Bonus  int  `json:"bonus"`
}

type skullKingTableGame struct{}

func (skullKingTableGame) normalize(raw json.RawMessage) (json.RawMessage, error) {
	var gs skullKingGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidState, err)
	}
	if !skullKingPhases[gs.Phase] {
		return nil, fmt.Errorf("%w: unknown phase %q", ErrInvalidState, gs.Phase)
	}
	if len(gs.Players) == 0 {
		return nil, fmt.Errorf("%w: no players", ErrInvalidState)
	}
	return json.Marshal(gs)
}

func (skullKingTableGame) applySubmit(raw json.RawMessage, playerID id.ID, input TableSubmitInput) (json.RawMessage, error) {
	var gs skullKingGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return nil, fmt.Errorf("corrupt game state: %w", err)
	}
	switch {
	case input.Bid != nil:
		if input.Actual != nil {
			return nil, fmt.Errorf("%w: bid and actual are mutually exclusive", ErrInvalidInput)
		}
		if err := skullKingApplyBid(&gs, playerID, *input.Bid); err != nil {
			return nil, err
		}
	case input.Actual != nil:
		if err := skullKingApplyResult(&gs, playerID, *input.Actual, input.Bonus); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("%w: bid or actual is required", ErrInvalidInput)
	}
	return json.Marshal(gs)
}

func (skullKingTableGame) playerIDs(raw json.RawMessage) []id.ID {
	var gs skullKingGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return nil
	}
	ids := make([]id.ID, 0, len(gs.Players))
	for _, p := range gs.Players {
		ids = append(ids, p.ID)
	}
	return ids
}

// findSkullKingPlayerIndex returns the index of the player with the given app
// player ID (Players[].ID, canonical after the typed unmarshal), or -1.
func findSkullKingPlayerIndex(players []TablePlayer, playerID id.ID) int {
	for i, p := range players {
		if p.ID == playerID {
			return i
		}
	}
	return -1
}

func skullKingApplyBid(gs *skullKingGameState, playerID id.ID, bid int) error {
	if gs.Phase != "waiting-for-bids" {
		return ErrWrongPhase
	}

	playerIdx := findSkullKingPlayerIndex(gs.Players, playerID)
	if playerIdx == -1 {
		return ErrPlayerNotInGame
	}

	roundIdx := gs.CurrentRound - 1
	if roundIdx < 0 {
		return ErrWrongPhase
	}
	// Initialize missing round slots (game may start in waiting-for-bids with empty rounds)
	for len(gs.Rounds) <= roundIdx {
		gs.Rounds = append(gs.Rounds, make([]json.RawMessage, 0))
	}

	if playerIdx < len(gs.Rounds[roundIdx]) && gs.Rounds[roundIdx][playerIdx] != nil {
		var existing skullKingEntry
		if json.Unmarshal(gs.Rounds[roundIdx][playerIdx], &existing) == nil && existing.Bid != 0 {
			return ErrSlotAlreadySet
		}
	}

	// Set the bid for this player slot
	entryJSON, _ := json.Marshal(skullKingEntry{Bid: bid, Actual: nil, Bonus: 0})
	for len(gs.Rounds[roundIdx]) <= playerIdx {
		gs.Rounds[roundIdx] = append(gs.Rounds[roundIdx], nil)
	}
	gs.Rounds[roundIdx][playerIdx] = entryJSON
	return nil
}

func skullKingApplyResult(gs *skullKingGameState, playerID id.ID, actual int, bonus int) error {
	if gs.Phase != "result-entry" {
		return ErrWrongPhase
	}

	playerIdx := findSkullKingPlayerIndex(gs.Players, playerID)
	if playerIdx == -1 {
		return ErrPlayerNotInGame
	}

	roundIdx := gs.CurrentRound - 1
	if roundIdx < 0 || roundIdx >= len(gs.Rounds) {
		return ErrWrongPhase
	}

	// Reject if host already set actual for this slot
	if playerIdx < len(gs.Rounds[roundIdx]) && gs.Rounds[roundIdx][playerIdx] != nil {
		var existing skullKingEntry
		if json.Unmarshal(gs.Rounds[roundIdx][playerIdx], &existing) == nil && existing.Actual != nil {
			return ErrSlotAlreadySet
		}
	}

	// Get the bid from the existing entry
	var existingEntry skullKingEntry
	if playerIdx < len(gs.Rounds[roundIdx]) && gs.Rounds[roundIdx][playerIdx] != nil {
		json.Unmarshal(gs.Rounds[roundIdx][playerIdx], &existingEntry) //nolint:errcheck
	}

	entryJSON, _ := json.Marshal(skullKingEntry{Bid: existingEntry.Bid, Actual: &actual, Bonus: bonus})
	for len(gs.Rounds[roundIdx]) <= playerIdx {
		gs.Rounds[roundIdx] = append(gs.Rounds[roundIdx], nil)
	}
	gs.Rounds[roundIdx][playerIdx] = entryJSON
	return nil
}
