package calculator

import (
	"encoding/json"

	"github.com/tolyandre/elo-web-service/pkg/api/shortid"
)

// It's a Wonderful World ("Этот Безумный Мир") calculator.
//
// schema_version history:
//   - v1 (initial): multipliers used "row_id" as the row key. This collided
//     with the idcodec middleware, which treats any key ending in "_id" as an
//     entity id and rewrites it (short ↔ canonical UUID). Several IAWW row ids
//     ("structure", "research", "project", "discovery", "financier", "direct",
//     …) happen to be valid Base58 strings, so the middleware silently decoded
//     them to canonical UUIDs on the request path, corrupting the stored
//     document. See ADR-09.
//   - v2 (current): the row key is renamed to "row" (no "_id" suffix), so
//     idcodec leaves it alone. The v1→v2 migrator recovers corrupted row ids
//     by reverse-mapping the known UUIDs back to their row id.
//
// Storage shape (v2, normalized — player refs under "player_id"):
//
//	{
//	  "schema_version": 2,
//	  "players":   [{"player_id": "...", "name": "..."}],
//	  "direct_vp": [{"player_id": "...", "value": N}],
//	  "multipliers":[{"row": "...", "player_id": "...", "coeff": N, "count": N}],
//	  "fallback_game_id": "..." | null
//	}
func init() {
	register(&Schema{
		Kind:           KindIAWW,
		CurrentVersion: 2,
		migrators: map[int]migrator{
			1: migrateIAWWv1ToV2,
		},
	}, "iaww.v2.json")
}

// knownIAWWRows is the fixed set of row identifiers used by the IAWW scoring
// table. Used by the v1→v2 migrator to (a) rename row_id → row and (b) recover
// row ids that the idcodec middleware corrupted into canonical UUIDs.
var knownIAWWRows = []string{
	"direct", "structure", "vehicle", "research", "project", "discovery",
	"financier", "general", "culture",
	"str-res", "res-dis", "str-pro", "veh-pro", "res-pro", "pro-dis",
	"veh-res", "str-veh", "fin-gen", "dis-fin", "veh-fin", "pro-gen", "str-gen",
}

// migrateIAWWv1ToV2 upgrades a v1 document to v2: bumps schema_version and
// renames the multipliers[].row_id key to multipliers[].row. If a row_id was
// corrupted by idcodec into a canonical UUID, it is reverse-mapped back to the
// original row id; unrecognized UUIDs are left in place so the user can spot
// them in the UI rather than silently dropping data.
func migrateIAWWv1ToV2(raw json.RawMessage) (json.RawMessage, error) {
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}

	// Build reverse map: ToCanonical(row) → row, so corrupted row_ids map back.
	uuidToRow := make(map[string]string, len(knownIAWWRows))
	for _, r := range knownIAWWRows {
		uuidToRow[shortid.ToCanonical(r)] = r
	}

	if mults, ok := doc["multipliers"].([]any); ok {
		for i, m := range mults {
			obj, ok := m.(map[string]any)
			if !ok {
				continue
			}
			rowID, hasRowID := obj["row_id"]
			if !hasRowID {
				continue // already migrated or malformed; leave as-is
			}
			delete(obj, "row_id")
			rowStr, _ := rowID.(string)
			if rowStr == "" {
				continue
			}
			// Recover corrupted row ids (UUID form) back to the original.
			if recovered, ok := uuidToRow[rowStr]; ok {
				rowStr = recovered
			}
			obj["row"] = rowStr
			mults[i] = obj
		}
		doc["multipliers"] = mults
	}

	doc["schema_version"] = 2
	return json.Marshal(doc)
}
