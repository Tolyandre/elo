package elo

import (
	"fmt"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Well-known games.id constants (ADR-16). Live tables pin the game they run
// via these ids, and the frontend uses their Base58 wire forms to route a
// table to its game app and to pick the game when saving the final match.
// Every environment's games table carries these rows (see testdata/seed.sql).
const (
	gameIDSkullKingUUID = "00000000-0000-0000-0000-000000000188" // wire 111111111111117m
	gameIDIAWWUUID      = "00000000-0000-0000-0000-000000000009" // wire 111111111111111A
)

func mustGameID(uuidStr string) id.ID {
	parsed, err := id.Parse(uuidStr)
	if err != nil {
		panic(fmt.Sprintf("elo: invalid well-known game id %q: %v", uuidStr, err))
	}
	return parsed
}

var (
	// GameIDSkullKing is the games.id of Skull King.
	GameIDSkullKing = mustGameID(gameIDSkullKingUUID)
	// GameIDIAWW is the games.id of It's a Wonderful World (Этот Безумный Мир).
	GameIDIAWW = mustGameID(gameIDIAWWUUID)
)

// GameMeta describes a game that supports live tables.
type GameMeta struct {
	ID             id.ID
	Title          string
	CalculatorKind string // calculator registry kind for saved matches
}

// Games maps the well-known game ids to their metadata. Live-table logic
// dispatches per-game behavior through this registry.
var Games = map[id.ID]GameMeta{
	GameIDSkullKing: {ID: GameIDSkullKing, Title: "Skull King", CalculatorKind: "skull-king"},
	GameIDIAWW:      {ID: GameIDIAWW, Title: "Этот Безумный Мир", CalculatorKind: "iaww"},
}
