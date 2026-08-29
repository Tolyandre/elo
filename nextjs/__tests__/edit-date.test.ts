import { describe, expect, it } from "vitest";
import { unchangedEditDateISO } from "@/app/matches/edit-date";

describe("unchangedEditDateISO", () => {
    // The datetime-local control carries minute precision; stored dates carry
    // milliseconds. An untouched draft must map back to the original instant.
    const original = "2026-08-29T19:29:08.330512Z";
    const draftSameMinute = "2026-08-29T19:29"; // local time; forced below via UTC-equivalents

    it("returns the original ISO when the draft matches the original minute", () => {
        // Build the draft from the original in the same way the form does
        // (local components), so the test is timezone-independent.
        const d = new Date(original);
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        expect(local).not.toContain(":08"); // sanity: draft really is minute precision
        expect(unchangedEditDateISO(local, original)).toBe(original);
    });

    it("returns null when the user picked a different minute", () => {
        const shifted = new Date(new Date(original).getTime() + 90_000); // +1.5 min
        const d = shifted;
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        expect(unchangedEditDateISO(local, original)).toBeNull();
    });

    it("returns the original verbatim when the draft equals it exactly", () => {
        expect(unchangedEditDateISO(original, original)).toBe(original);
    });

    it("returns null for missing or invalid values", () => {
        expect(unchangedEditDateISO("", original)).toBeNull();
        expect(unchangedEditDateISO(draftSameMinute, "")).toBeNull();
        expect(unchangedEditDateISO("not a date", original)).toBeNull();
    });
});
