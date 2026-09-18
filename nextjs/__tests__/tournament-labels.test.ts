import { describe, expect, it } from "vitest";
import type { TournamentPlan } from "../app/api";
import {
    eliminationLabel,
    planPreview,
    roundTitle,
    seatSourceLabel,
    tournamentStatusLabel,
} from "../app/tournaments/labels";

const singlePlan: TournamentPlan = {
    elimination: "single",
    rounds: [
        {
            track: "winners", index: 1, promote: 2, slots: [
                { seat_count: 4, seats: [{ kind: "draw" }, { kind: "draw" }, { kind: "draw" }, { kind: "draw" }] },
                { seat_count: 4, seats: [{ kind: "draw" }, { kind: "draw" }, { kind: "draw" }, { kind: "draw" }] },
            ],
        },
        {
            track: "final", index: 1, promote: 1, slots: [
                {
                    seat_count: 4, seats: [
                        { kind: "source", source_slot: 0, source_place: 1 },
                        { kind: "source", source_slot: 0, source_place: 2 },
                        { kind: "source", source_slot: 1, source_place: 1 },
                        { kind: "source", source_slot: 1, source_place: 2 },
                    ],
                },
            ],
        },
    ],
};

const doublePlan: TournamentPlan = {
    elimination: "double",
    rounds: [
        {
            track: "winners", index: 1, promote: 2, slots: [
                { seat_count: 3, seats: [{ kind: "draw" }, { kind: "draw" }, { kind: "draw" }] },
                { seat_count: 3, seats: [{ kind: "draw" }, { kind: "draw" }, { kind: "draw" }] },
            ],
        },
        {
            track: "losers", index: 1, promote: 1, slots: [
                { seat_count: 2, seats: [{ kind: "source", source_slot: 0, source_place: 3 }, { kind: "source", source_slot: 1, source_place: 3 }] },
            ],
        },
        {
            track: "final", index: 1, promote: 1, slots: [
                { seat_count: 3, seats: [{ kind: "source", source_slot: 0, source_place: 1 }, { kind: "source", source_slot: 0, source_place: 2 }, { kind: "source", source_slot: 1, source_place: 1 }] },
            ],
        },
    ],
};

describe("tournament labels", () => {
    it("labels the lifecycle statuses", () => {
        expect(tournamentStatusLabel("registration")).toBe("Регистрация");
        expect(tournamentStatusLabel("running")).toBe("Идёт");
        expect(tournamentStatusLabel("completed")).toBe("Завершён");
        expect(tournamentStatusLabel("cancelled")).toBe("Отменён");
    });

    it("labels the elimination types", () => {
        expect(eliminationLabel("single")).toBe("Одиночное выбывание");
        expect(eliminationLabel("double")).toContain("Двойное выбывание");
    });

    it("names rounds by track: Финал for the final track, Тур N otherwise", () => {
        expect(roundTitle("winners", 1)).toBe("Тур 1");
        expect(roundTitle("losers", 2)).toBe("Тур 2");
        expect(roundTitle("final", 1)).toBe("Финал");
    });

    it("names double-elimination rounds by their track", () => {
        expect(roundTitle("winners", 1, "double")).toBe("Верх 1");
        expect(roundTitle("losers", 2, "double")).toBe("Низ 2");
        expect(roundTitle("final", 1, "double")).toBe("Финал");
    });

    it("formats unresolved-seat provenance", () => {
        expect(seatSourceLabel(2, 1)).toBe("из стола 2, место 1");
        expect(seatSourceLabel(3, null)).toBe("из стола 3");
    });

    it("previews a single-elimination plan round by round", () => {
        expect(planPreview(singlePlan)).toBe("Тур 1: 4+4 → 2; Финал: 4 → 1");
    });

    it("previews a WB+LB plan naming each round's track", () => {
        expect(planPreview(doublePlan)).toBe("Верх 1: 3+3 → 2; Низ 1: 2 → 1; Финал: 3 → 1");
    });
});
