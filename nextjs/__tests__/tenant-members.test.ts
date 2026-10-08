import { describe, expect, it } from "vitest";
import { memberPlayerIds, participantsMembershipIssue } from "@/lib/tenant-members";
import { pid } from "./test-utils";
import type { Club, Tenant } from "@/app/api";

// Client-side membership (ADR-36): the creation forms validate rosters
// against the same rule the server applies to feeds and settling — an active
// participant of any club owned by the tenant.

const club = (id: string, playerIds: string[]): Club =>
    ({ id: pid(id), player_ids: playerIds.map(pid) } as unknown as Club);

const tenant = (clubIds: string[], mode: Tenant["arena_membership_mode"] = "any_member"): Tenant =>
    ({ club_ids: clubIds.map(pid), arena_membership_mode: mode } as unknown as Tenant);

describe("memberPlayerIds", () => {
    it("unions the players of the tenant's own clubs", () => {
        const clubs = [club("c1", ["p1", "p2"]), club("c2", ["p2", "p3"])];
        expect([...memberPlayerIds(tenant(["c1", "c2"]), clubs)].sort()).toEqual(["p1", "p2", "p3"]);
    });

    it("ignores clubs the tenant does not own", () => {
        const clubs = [club("c1", ["p1"]), club("other", ["p9"])];
        expect([...memberPlayerIds(tenant(["c1"]), clubs)]).toEqual(["p1"]);
    });

    it("is empty without a tenant", () => {
        expect(memberPlayerIds(null, [club("c1", ["p1"])]).size).toBe(0);
    });
});

describe("participantsMembershipIssue", () => {
    const members = new Set(["p1", "p2"]);

    it("stays quiet on an empty roster — the disabled submit does the talking", () => {
        expect(participantsMembershipIssue([], members, "any_member", "Синие люди")).toBeNull();
        expect(participantsMembershipIssue([], members, "members_only", "Синие люди")).toBeNull();
    });

    it("any_member: demands at least one member, else the match misses the feed", () => {
        expect(participantsMembershipIssue(["p9"], members, "any_member", "Синие люди")).toMatch(/Синие люди/);
        expect(participantsMembershipIssue(["p9", "p1"], members, "any_member", "Синие люди")).toBeNull();
    });

    it("members_only: every participant must be a member", () => {
        expect(participantsMembershipIssue(["p1"], members, "members_only", "Синие люди")).toBeNull();
        expect(participantsMembershipIssue(["p1", "p9"], members, "members_only", "Синие люди")).toMatch(/только своих участников/);
    });
});
