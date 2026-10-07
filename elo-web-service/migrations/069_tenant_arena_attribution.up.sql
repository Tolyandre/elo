-- Tenant main-arena attribution (ADR-36, phase 2). From this phase on the
-- tenant predicate — openness evaluated at the match date against the
-- membership stint history of the tenant's clubs — decides membership for
-- every arena with a tenant_id, including the converted global arena: its
-- unconditional match_filter stays on the row for mechanical reasons
-- (schema, the games-tab exclusion) but no longer decides membership.
-- Member-less matches therefore leave a main arena at the next
-- recalculation, as the ADR states.
--
-- Tenant membership is derived from club membership: an active stint in any
-- club of the tenant at the match date.
--
-- The predicate cannot live inside arena_contains_match: that function must
-- stay a pure inlinable expression (ADR-28 — a body with sub-SELECTs is never
-- inlined), while membership-at-date needs table probes. This dedicated
-- function is the explicit exception; the arena queries dispatch to it with
-- CASE WHEN a.tenant_id IS NOT NULL and keep arena_contains_match for every
-- other flavor. It is only evaluated for tenant arenas, so the non-inlined
-- cost stays proportional to the (small) number of tenants.
CREATE FUNCTION tenant_arena_contains_match(
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
