import type {
    Bracket,
    BracketRound,
    BracketSeat,
    BracketSlot,
    TournamentPlan,
} from "@/app/api";
import { toBase58ID, type Base58ID } from "@/lib/id";

// Baked data for the help page's tournament example: a completed 8-player
// double-elimination tournament at 3–4-seat tables of «Охота на змей». The
// plan shape is the classic one the backend's bracket enumerator
// (pkg/bracket) offers for (8 participants, pool of 3–4-seat games) —
// Верх 1: два стола по 4 (по 2 проходят), Верх 2: стол из 4, Низ 1–2,
// Финал на троих — validated against pkg/bracket's ParsePlan/Validate at
// generation time, with hand-picked results baked in. Ids are Base58-shaped
// fixture strings minted through lib/id; BracketView renders the fictional
// names via its resolver props.

function id(s: string): Base58ID {
    const minted = toBase58ID(s);
    if (!minted) throw new Error(`example-bracket: "${s}" is not a Base58 id`);
    return minted;
}

export const EXAMPLE_GAME_NAME = "Охота на змей";
export const EXAMPLE_GAME_ID = id("zmeya");

/** Fixture players: opaque Base58 id → display name. */
export const EXAMPLE_PLAYER_NAMES: Record<string, string> = {
    p1: "Аня",
    p2: "Боря",
    p3: "Вера",
    p4: "Глеб",
    p5: "Даша",
    p6: "Егор",
    p7: "Женя",
    p8: "Зина",
};

// Flat slot ids in canonical plan order: winners rounds, then losers, then
// the final (the order source_slot indexes refer to).
const FLAT = ["sA", "sB", "sC", "sD", "sE", "sF"];
const slotId = (letter: string): Base58ID => id(letter);
const flatIndex = (letter: string) => FLAT.indexOf(letter);

/** A seat either holds a round-1 draw seed or is fed from a source slot's place. */
type SeatSpec = { player: string } | { source: [string, number] };

interface BakedSlot {
    advance: number;
    seats: SeatSpec[];
    /** Players ordered by final place (index 0 = place 1). */
    places: string[];
    /** The single match's raw game scores, descending in place order. */
    raw: number[];
}

// The tournament: Аня/Даша/Егор/Зина and Боря/Вера/Глеб/Женя open at two
// tables. Вера loses Верх 2 to Егор, fights through Низ and takes the final.
const SLOTS: Record<string, BakedSlot> = {
    // Верх 1: по 2 лучших со стола проходят, места 3–4 падают в Низ.
    sA: {
        advance: 2,
        seats: [{ player: "p1" }, { player: "p5" }, { player: "p6" }, { player: "p8" }],
        places: ["p6", "p1", "p5", "p8"], // Егор, Аня — дальше; Даша, Зина — в Низ
        raw: [10, 6, 4, 1],
    },
    sB: {
        advance: 2,
        seats: [{ player: "p2" }, { player: "p3" }, { player: "p4" }, { player: "p7" }],
        places: ["p3", "p2", "p4", "p7"], // Вера, Боря — дальше; Глеб, Женя — в Низ
        raw: [9, 5, 4, 0],
    },
    // Верх 2: победитель идёт в финал, остальные — в Низ 2.
    sC: {
        advance: 1,
        seats: [
            { source: ["sA", 1] },
            { source: ["sA", 2] },
            { source: ["sB", 1] },
            { source: ["sB", 2] },
        ],
        places: ["p6", "p3", "p1", "p2"], // Егор — в финал; Вера, Аня, Боря — в Низ 2
        raw: [8, 4, 3, 2],
    },
    // Низ 1: четыре выбывших из Верха 1, выживает один.
    sD: {
        advance: 1,
        seats: [
            { source: ["sA", 3] },
            { source: ["sA", 4] },
            { source: ["sB", 3] },
            { source: ["sB", 4] },
        ],
        places: ["p5", "p4", "p7", "p8"], // Даша — в Низ 2
        raw: [7, 5, 4, 3],
    },
    // Низ 2: выживший Низа 1 + три выбывших Верха 2, двое — в финал.
    sE: {
        advance: 2,
        seats: [
            { source: ["sD", 1] },
            { source: ["sC", 2] },
            { source: ["sC", 3] },
            { source: ["sC", 4] },
        ],
        places: ["p3", "p2", "p5", "p1"], // Вера, Боря — в финал
        raw: [10, 8, 5, 2],
    },
    // Финал на троих: финалист Верха + двое из Низа.
    sF: {
        advance: 1,
        seats: [
            { source: ["sC", 1] },
            { source: ["sE", 1] },
            { source: ["sE", 2] },
        ],
        places: ["p3", "p6", "p2"], // Вера — чемпион!
        raw: [9, 5, 4],
    },
};

interface RoundDef {
    track: BracketRound["track"];
    index: number;
    letters: string[];
}

// Верх 1–2, Низ 1–2, Финал — ровно раунды канонического плана.
const ROUNDS: RoundDef[] = [
    { track: "winners", index: 1, letters: ["sA", "sB"] },
    { track: "winners", index: 2, letters: ["sC"] },
    { track: "losers", index: 1, letters: ["sD"] },
    { track: "losers", index: 2, letters: ["sE"] },
    { track: "final", index: 1, letters: ["sF"] },
];

function planSeatOf(seat: SeatSpec) {
    return "player" in seat
        ? { kind: "draw" as const }
        : { kind: "source" as const, source_slot: flatIndex(seat.source[0]), source_place: seat.source[1] };
}

/**
 * Slot points of one match (ADR-30): the score surplus over the worst score
 * as a share of the leader's surplus, capped at 0.95 with +0.05 for every
 * 1st place holder — the winner rounds to exactly 1.0 — all in one-decimal
 * steps. Mirrors pkg/bracket.MatchPoints so the baked standings and the
 * baked match rows agree with the real formula (the baked matches sit at
 * the seeded default win reward 1).
 */
function earnShares(raw: number[], winReward = 1): number[] {
    const min = Math.min(...raw);
    const max = Math.max(...raw);
    if (max === min) return raw.map(() => 0.1); // nothing to separate: the bare bonus tenth
    return raw.map((s) => {
        const ratio = Math.pow(s - min, winReward) / Math.pow(max - min, winReward);
        const share = 0.95 * ratio + (s === max ? 0.05 : 0);
        return Math.round(share * 10) / 10;
    });
}

/** The plan shape (for the plan-preview figure): the same rounds without results. */
export const EXAMPLE_PLAN: TournamentPlan = {
    elimination: "double",
    rounds: ROUNDS.map((round) => ({
        track: round.track,
        index: round.index,
        advance: SLOTS[round.letters[0]].advance,
        slots: round.letters.map((letter) => ({
            seat_count: SLOTS[letter].seats.length,
            seats: SLOTS[letter].seats.map(planSeatOf),
        })),
    })),
};

function seatFor(letter: string, seatIdx: number): BracketSeat {
    const seat = SLOTS[letter].seats[seatIdx];
    const base: BracketSeat = { position: seatIdx + 1 };
    if ("source" in seat) {
        base.source_slot_id = slotId(seat.source[0]);
        base.source_place = seat.source[1];
    } else {
        // Round-1 draw seed: the DTO carries the drawn player.
        base.player_id = id(seat.player);
    }
    return base;
}

function slotFor(letter: string, position: number): BracketSlot {
    const baked = SLOTS[letter];
    const shares = earnShares(baked.raw);
    return {
        id: slotId(letter),
        game_id: EXAMPLE_GAME_ID,
        position,
        advance: baked.advance,
        min_score: 0,
        status: "completed",
        seats: baked.seats.map((_, seatIdx) => seatFor(letter, seatIdx)),
        matches: [{
            match_id: id(`m${letter}`),
            scores: baked.places.map((playerId, idx) => ({
                player_id: id(playerId),
                points: shares[idx],
            })),
        }],
        // Slot points (ADR-30): every player's earned share of the match.
        standings: baked.places.map((playerId, idx) => ({
            player_id: id(playerId),
            points: shares[idx],
            place: idx + 1,
            advanced: idx < baked.advance,
        })),
    };
}

export const EXAMPLE_BRACKET: Bracket = {
    tournament_id: id("demo"),
    status: "completed",
    elimination: "double",
    winner_player_id: id("p3"),
    rounds: ROUNDS.map((round) => ({
        track: round.track,
        index: round.index,
        slots: round.letters.map((letter, i) => slotFor(letter, i + 1)),
    })),
};
