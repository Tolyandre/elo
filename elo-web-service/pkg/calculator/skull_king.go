package calculator

// Skull King calculator. schema_version 1.
//
// Storage shape (normalized — player refs under "player_id"):
//
//	{
//	  "schema_version": 1,
//	  "players": [{"player_id": "...", "name": "..."}],
//	  "current_round": 1..10,
//	  "current_player_index": 0,
//	  "rounds": [[{bid,actual,bonus} | null], ...],   // [round][playerIndex]
//	  "fallback_game_id": "..." | null
//	}
func init() {
	register(&Schema{
		Kind:           KindSkullKing,
		CurrentVersion: 1,
		migrators:      nil, // no older versions exist yet
	}, "skull_king.v1.json")
}
