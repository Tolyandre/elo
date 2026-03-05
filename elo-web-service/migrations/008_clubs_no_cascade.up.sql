-- Remove ON DELETE CASCADE from player_club_membership.club_id so that
-- deleting a club with members is rejected by the foreign key constraint.
ALTER TABLE player_club_membership
    DROP CONSTRAINT IF EXISTS player_club_membership_club_id_fkey;

ALTER TABLE player_club_membership
    ADD CONSTRAINT player_club_membership_club_id_fkey
    FOREIGN KEY (club_id) REFERENCES clubs(id);
