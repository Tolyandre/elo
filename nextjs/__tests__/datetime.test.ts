import { describe, it, expect } from "vitest";
import { formatDate, formatTime, formatDateTime, formatDateTimeLong } from "@/lib/datetime";

describe("formatDate", () => {
    it("formats an ISO string as a short ru-RU date", () => {
        // Deterministic because the date components are locale-independent.
        expect(formatDate("2026-08-04T12:00:00Z")).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
    });

    it("accepts a Date instance", () => {
        expect(formatDate(new Date("2026-01-15T00:00:00Z"))).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
    });
});

describe("formatTime", () => {
    it("formats as HH:MM in ru-RU", () => {
        expect(formatTime("2026-08-04T12:30:00Z")).toMatch(/^\d{2}:\d{2}$/);
    });
});

describe("formatDateTime", () => {
    it("uses the ambient locale with medium date + short time", () => {
        const result = formatDateTime("2026-08-04T12:30:00Z");
        expect(result).toContain(":");
        expect(result.length).toBeGreaterThan(5);
    });
});

describe("formatDateTimeLong", () => {
    it("produces a long-form ru-RU date with full year", () => {
        const result = formatDateTimeLong("2026-08-04T12:30:00Z");
        expect(result).toContain("2026");
    });
});
