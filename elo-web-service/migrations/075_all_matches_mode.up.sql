-- ADR-36 phase 7, refinement 1: the third arena_membership_mode «all»
-- («Все партии») — every rated match counts into the tenant's main arena,
-- regardless of membership. The mode is evaluated at read time like the other
-- two, so flipping «Синие люди» (the well-known tenant, created any_member in
-- 068) re-interprets the whole history: member-less matches re-enter the main
-- arena at the next recalculation. The row is marked stale below so the
-- background worker runs that full replay (the same mark that a runtime
-- settings change sets through TenantService.markMainArenaForRecalc).
--
-- Coop matches keep their special role (ADR-33): they settle no rating and
-- stay out of arena attribution in every mode.

ALTER TABLE tenants DROP CONSTRAINT tenants_arena_membership_mode_check;
ALTER TABLE tenants
    ADD CONSTRAINT tenants_arena_membership_mode_check
        CHECK (arena_membership_mode IN ('any_member', 'members_only', 'all'));

-- The original community becomes "everything we ever recorded counts"
-- (ADR-36 phase 7): the member-less exception disappears from its rating.
UPDATE tenants
SET arena_membership_mode = 'all'
WHERE id = '00000000-0000-0000-0000-000000000101';

-- Same dispatch table as 069 with the new first branch: no membership probe
-- at all — the match simply belongs (the coop exclusion stays).
CREATE OR REPLACE FUNCTION tenant_arena_contains_match(
    p_tenant_id        uuid,
    p_membership_mode  text,
    p_match_mode       text,
    p_match_id         uuid,
    p_match_date       timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT p_match_mode <> 'coop' AND (
        CASE p_membership_mode
            WHEN 'all' THEN
                -- Every rated match counts; membership is irrelevant.
                true
            WHEN 'any_member' THEN
                -- At least one participant was a member of any club of the
                -- tenant at the match date; friends playing along accumulate
                -- rating in the arena and are listed.
                EXISTS (
                    SELECT 1
                    FROM match_scores ms
                    JOIN clubs c
                      ON c.tenant_id = p_tenant_id
                    JOIN player_club_membership pcm
                      ON pcm.club_id = c.id
                     AND pcm.player_id = ms.player_id
                     AND pcm.joined_at <= p_match_date
                     AND (pcm.left_at IS NULL OR pcm.left_at > p_match_date)
                    WHERE ms.match_id = p_match_id
                )
            WHEN 'members_only' THEN
                -- All participants were members of clubs of the tenant
                -- (possibly different ones) at the match date. Closed stints
                -- still cover their dates, so history stays put.
                NOT EXISTS (
                    SELECT 1
                    FROM match_scores ms
                    WHERE ms.match_id = p_match_id
                      AND NOT EXISTS (
                        SELECT 1
                        FROM clubs c
                        JOIN player_club_membership pcm
                          ON pcm.club_id = c.id
                         AND pcm.player_id = ms.player_id
                         AND pcm.joined_at <= p_match_date
                         AND (pcm.left_at IS NULL OR pcm.left_at > p_match_date)
                        WHERE c.tenant_id = p_tenant_id
                      )
                )
            ELSE false
        END
    )
$$;

-- Re-interpretation queued: the worker replays the main arena in full
-- (attribution over match rows + the settlement sweep), same mechanism as 071.
UPDATE arenas SET stale_at = NOW()
WHERE tenant_id = '00000000-0000-0000-0000-000000000101';
