import type { Club, Tenant } from "@/app/api";

/**
 * Client-side tenant membership (ADR-36): a player is a member while they
 * have an active stint in any club of the tenant — the same rule the server
 * applies to feeds, settling and market bets (PlayerIsTenantMember). The
 * creation forms use it to keep user-entered rosters consistent with what
 * the tenant will actually accept into its feed.
 */

/** Player ids that are current members of the tenant (empty set without one). */
export function memberPlayerIds(
    tenant: Pick<Tenant, "club_ids"> | null,
    clubs: Club[],
): Set<string> {
    if (!tenant) return new Set();
    const owned = new Set<string>(tenant.club_ids);
    const members = new Set<string>();
    for (const club of clubs) {
        if (!owned.has(club.id)) continue;
        for (const pid of club.player_ids) members.add(pid);
    }
    return members;
}

/**
 * Why the given roster cannot be submitted under the tenant, or null when it
 * can. `any_member` demands at least one member (otherwise the match would
 * never reach the tenant's feed or rating); `members_only` forbids everyone
 * else; `all` («Все партии») accepts any roster — membership is irrelevant to
 * the rating. An empty roster stays quiet — the disabled submit does the
 * talking.
 */
export function participantsMembershipIssue(
    participantIds: readonly string[],
    memberIds: Set<string>,
    mode: Tenant["arena_membership_mode"],
    tenantName: string,
): string | null {
    if (participantIds.length === 0) return null;
    if (mode === "all") return null;
    if (mode === "any_member") {
        return participantIds.some((id) => memberIds.has(id))
            ? null
            : `Нужен хотя бы один участник сообщества «${tenantName}»`;
    }
    return participantIds.every((id) => memberIds.has(id))
        ? null
        : `Сообщество «${tenantName}» принимает только своих участников`;
}
