package elo

import (
	"encoding/json"
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ─── It's a Wonderful World (ЭБМ) table game ──────────────────────────────────

// iawwGameState is the live wire state of an IAWW table. No rounds: every
// player fills their own scoring column, marks it done, and the host can
// correct anything at any time. Player ids are typed so the JSON hooks
// canonicalize them on parse and shorten them on marshal (ADR-12).
type iawwGameState struct {
	Phase          string           `json:"phase"` // always "scoring" for now
	Players        []TablePlayer    `json:"players"`
	Entries        []iawwEntryState `json:"entries"`
	FallbackGameId *id.ID           `json:"fallbackGameId,omitempty"`
}

type iawwEntryState struct {
	PlayerID id.ID      `json:"playerId"`
	DirectVp *int       `json:"directVp"` // null until entered
	Cells    []IawwCell `json:"cells"`
	Done     bool       `json:"done"`
}

type IawwCell struct {
	Row   string `json:"row"`
	Coeff int    `json:"coeff"`
	Count int    `json:"count"`
}

// The 21 scoring rows besides the direct-VP entry (mirrors
// components/calculators/iaww/scoring.tsx): 8 single-resource rows with a
// free coefficient, and 13 fixed-coefficient pairs. Row names are not entity
// ids and never go through id conversion (ADR-09).
var iawwSingleRows = map[string]bool{
	"structure": true, "vehicle": true, "research": true, "project": true,
	"discovery": true, "financier": true, "general": true, "culture": true,
}

var iawwPairRowCoeffs = map[string]int{
	"str-res": 6, "res-dis": 10, "str-pro": 7, "veh-pro": 8, "res-pro": 9,
	"pro-dis": 12, "veh-res": 6, "str-veh": 6, "fin-gen": 6, "dis-fin": 6,
	"veh-fin": 6, "pro-gen": 6, "str-gen": 5,
}

// iawwMaxValue caps every countable player input — scores this large are
// typos or abuse, not games.
const iawwMaxValue = 999

type iawwTableGame struct{}

func (iawwTableGame) normalize(raw json.RawMessage) (json.RawMessage, error) {
	var gs iawwGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidState, err)
	}
	// "setup" is a client-only pre-table phase; tables are created in scoring,
	// but accepting it keeps the enum honest if a client ever sends it.
	if gs.Phase != "scoring" && gs.Phase != "setup" {
		return nil, fmt.Errorf("%w: unknown phase %q", ErrInvalidState, gs.Phase)
	}
	if err := iawwValidateState(&gs); err != nil {
		return nil, err
	}
	return json.Marshal(gs)
}

func (iawwTableGame) applySubmit(raw json.RawMessage, playerID id.ID, input TableSubmitInput) (json.RawMessage, error) {
	var gs iawwGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return nil, fmt.Errorf("corrupt game state: %w", err)
	}

	if input.Bid != nil || input.Actual != nil {
		return nil, fmt.Errorf("%w: not a skull king table", ErrInvalidInput)
	}

	entryIdx := -1
	for i := range gs.Entries {
		if gs.Entries[i].PlayerID == playerID {
			entryIdx = i
			break
		}
	}
	if entryIdx == -1 {
		return nil, ErrPlayerNotInGame
	}
	// A connected player submits once: after that only the host can correct
	// the entry (via the host state patch).
	if gs.Entries[entryIdx].Done {
		return nil, ErrSlotAlreadySet
	}

	entry := &gs.Entries[entryIdx]

	// Partial update, so per-cell edits can sync instantly like the host's:
	// directVp null keeps the current value; a carried cell with count 0
	// clears its row, other carried cells upsert; rows not carried keep their
	// values — the host may have entered values into this entry while the
	// player was filling the grid.
	if input.DirectVp != nil {
		if *input.DirectVp < 0 || *input.DirectVp > iawwMaxValue {
			return nil, fmt.Errorf("%w: directVp out of range", ErrInvalidInput)
		}
		entry.DirectVp = input.DirectVp
	}

	upserts := make([]IawwCell, 0, len(input.Cells))
	clears := make(map[string]bool, len(input.Cells))
	for _, c := range input.Cells {
		if c.Count == 0 {
			clears[c.Row] = true
		} else {
			upserts = append(upserts, c)
		}
	}
	for row := range clears {
		if _, isPair := iawwPairRowCoeffs[row]; !iawwSingleRows[row] && !isPair {
			return nil, fmt.Errorf("%w: unknown row %q", ErrInvalidInput, row)
		}
	}
	if err := iawwValidateCells(upserts); err != nil {
		return nil, err
	}
	upsertRows := make(map[string]bool, len(upserts))
	for _, c := range upserts {
		upsertRows[c.Row] = true
	}
	merged := make([]IawwCell, 0, len(entry.Cells)+len(upserts))
	for _, c := range entry.Cells {
		if !clears[c.Row] && !upsertRows[c.Row] {
			merged = append(merged, c)
		}
	}
	entry.Cells = append(merged, upserts...)

	// done: omitted behaves as true — a legacy one-shot submit both carries
	// the whole column and finishes it.
	if input.Done == nil || *input.Done {
		entry.Done = true
	}
	return json.Marshal(gs)
}

func (iawwTableGame) playerIDs(raw json.RawMessage) []id.ID {
	var gs iawwGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return nil
	}
	ids := make([]id.ID, 0, len(gs.Players))
	for _, p := range gs.Players {
		ids = append(ids, p.ID)
	}
	return ids
}

// iawwValidateState checks the invariants every stored IAWW state must hold:
// 2+ players, exactly one entry per player (same order), and every cell valid.
func iawwValidateState(gs *iawwGameState) error {
	if len(gs.Players) < 2 {
		return fmt.Errorf("%w: at least 2 players required", ErrInvalidState)
	}
	if len(gs.Entries) != len(gs.Players) {
		return fmt.Errorf("%w: one entry per player required", ErrInvalidState)
	}
	seen := make(map[id.ID]bool, len(gs.Players))
	for _, p := range gs.Players {
		if seen[p.ID] {
			return fmt.Errorf("%w: duplicate player", ErrInvalidState)
		}
		seen[p.ID] = true
	}
	for i, entry := range gs.Entries {
		if entry.PlayerID != gs.Players[i].ID {
			return fmt.Errorf("%w: entries must match players order", ErrInvalidState)
		}
		if entry.DirectVp != nil && (*entry.DirectVp < 0 || *entry.DirectVp > iawwMaxValue) {
			return fmt.Errorf("%w: directVp out of range", ErrInvalidState)
		}
		if err := iawwValidateCells(entry.Cells); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidState, err)
		}
	}
	return nil
}

// iawwValidateCells checks a player's multiplier cells: known rows only, no
// duplicates, bounded values, and pair rows carry their fixed coefficient.
func iawwValidateCells(cells []IawwCell) error {
	seen := make(map[string]bool, len(cells))
	for _, cell := range cells {
		fixedCoeff, isPair := iawwPairRowCoeffs[cell.Row]
		isSingle := iawwSingleRows[cell.Row]
		if !isPair && !isSingle {
			return fmt.Errorf("%w: unknown row %q", ErrInvalidInput, cell.Row)
		}
		if seen[cell.Row] {
			return fmt.Errorf("%w: duplicate row %q", ErrInvalidInput, cell.Row)
		}
		seen[cell.Row] = true
		if cell.Count < 0 || cell.Count > iawwMaxValue {
			return fmt.Errorf("%w: count out of range for row %q", ErrInvalidInput, cell.Row)
		}
		if isPair && cell.Coeff != fixedCoeff {
			return fmt.Errorf("%w: row %q must use coefficient %d", ErrInvalidInput, cell.Row, fixedCoeff)
		}
		if cell.Coeff < 0 || cell.Coeff > iawwMaxValue {
			return fmt.Errorf("%w: coefficient out of range for row %q", ErrInvalidInput, cell.Row)
		}
	}
	return nil
}
