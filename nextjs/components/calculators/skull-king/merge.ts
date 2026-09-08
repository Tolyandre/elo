// Three-way merge of live Skull King table states. The host's patch carries
// the whole state, so a version conflict (a player's bid/result landed while
// the patch was in flight) must combine both sides' changes instead of
// overwriting: slots only one side touched keep that side, a slot both sides
// changed to the same entry collapses, and a real same-slot race keeps the
// editor's value (last write wins — the informed choice happens in the edit
// dialog). Mirrors components/calculators/iaww/merge.

import type { SkullKingGameState, SkullKingRoundEntry } from "@/app/api";

type RoundSlot = SkullKingRoundEntry | null;

function slotSame(a: RoundSlot, b: RoundSlot): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.bid === b.bid && a.actual === b.actual && a.bonus === b.bonus;
}

// If the editor didn't touch a field, the server's value wins; if they did,
// their value wins (equal edits collapse naturally). Slots compare by value:
// fresh ones arrive unmarshaled, never by reference.
function threeWay<T>(base: T, local: T, fresh: T): T {
    return local === base ? fresh : local;
}

function threeWaySlot(base: RoundSlot, local: RoundSlot, fresh: RoundSlot): RoundSlot {
    return slotSame(local, base) ? fresh : local;
}

export function mergeSkullKingStates(
    before: SkullKingGameState,
    local: SkullKingGameState,
    fresh: SkullKingGameState,
): SkullKingGameState {
    return {
        ...fresh,
        phase: threeWay(before.phase, local.phase, fresh.phase),
        currentRound: threeWay(before.currentRound, local.currentRound, fresh.currentRound),
        currentPlayerIndex: threeWay(
            before.currentPlayerIndex,
            local.currentPlayerIndex,
            fresh.currentPlayerIndex,
        ),
        // fresh.rounds is authoritative for the shape; slots merge three-way.
        rounds: fresh.rounds.map((freshRound, ri) => {
            const baseRound = before.rounds[ri] ?? [];
            const localRound = local.rounds[ri] ?? [];
            return freshRound.map((freshSlot, pi) =>
                threeWaySlot(baseRound[pi] ?? null, localRound[pi] ?? null, freshSlot ?? null),
            );
        }),
    };
}
