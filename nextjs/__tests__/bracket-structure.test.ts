import { describe, expect, it } from "vitest";
import type { BracketRound } from "../app/api";
import { groupByTrack, offsetSpacers, roundColumnOffsets } from "../app/tournaments/bracket-structure";

// Rounds as the plan/bracket DTO lists them: winners → losers → final, each
// track's indices contiguous from 1.
function round(track: BracketRound["track"], index: number): BracketRound {
    return { track, index, slots: [] };
}

describe("roundColumnOffsets", () => {
    it("packs single-elimination winners rounds from the left", () => {
        const rounds = [round("winners", 1), round("winners", 2), round("final", 1)];
        expect(roundColumnOffsets(rounds, () => 0)).toEqual([0, 1, 2]);
    });

    it("offsets a losers round under the winners round it runs alongside", () => {
        // LB round 1 drops out of WB round 1 but plays while WB round 2 plays.
        const rounds = [round("winners", 1), round("winners", 2), round("losers", 1), round("final", 1)];
        const sources = [0, 0, 1, 0]; // per-round highest winners source
        expect(roundColumnOffsets(rounds, (r) => sources[rounds.indexOf(r)])).toEqual([0, 1, 1, 2]);
    });

    it("renders a losers round under its last winners source, keeping monotonic order", () => {
        // WB 1 and WB 2 both complete before LB 1 seats all the drops: it
        // renders under WB 2 so every drop line stays adjacent or stacked.
        const rounds = [
            round("winners", 1),
            round("winners", 2),
            round("winners", 3),
            round("losers", 1),
            round("losers", 2),
            round("final", 1),
        ];
        const sources = [0, 0, 0, 3, 0, 0];
        expect(roundColumnOffsets(rounds, (r) => sources[rounds.indexOf(r)])).toEqual([0, 1, 2, 2, 3, 4]);
    });
});

describe("offsetSpacers", () => {
    it("pads a band's start up to the first round's offset", () => {
        expect(offsetSpacers([1, 2])).toEqual([1, 0]);
        expect(offsetSpacers([0, 1])).toEqual([0, 0]);
    });

    it("pads each band independently — every band's row starts at column 0", () => {
        // Winners band [0] vs losers band [2]: the losers band needs two
        // spacer columns even though it is the band's first round.
        expect(offsetSpacers([0])).toEqual([0]);
        expect(offsetSpacers([2])).toEqual([2]);
    });
});

describe("groupByTrack", () => {
    it("keeps canonical track order with stacked bands", () => {
        const rounds = [round("winners", 1), round("winners", 2), round("losers", 1), round("final", 1)];
        expect(groupByTrack(rounds).map((b) => b.track)).toEqual(["winners", "losers", "final"]);
    });
});
