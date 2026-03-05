-- Restore ON DELETE CASCADE on player_club_membership.club_id
ALTER TABLE player_club_membership
    DROP CONSTRAINT IF EXISTS player_club_membership_club_id_fkey;

ALTER TABLE player_club_membership
    ADD CONSTRAINT player_club_membership_club_id_fkey
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
