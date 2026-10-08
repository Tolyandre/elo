-- Tenant icon (club-like display, ADR-36 phase 6): an optional key into the
-- frontend's built-in icon set, validated app-side (no FK, like clubs.icon).
-- «Синие люди» defaults to its club's icon.
ALTER TABLE tenants ADD COLUMN icon TEXT NULL;

UPDATE tenants SET icon = 'blue-figure'
WHERE id = '00000000-0000-0000-0000-000000000101';
