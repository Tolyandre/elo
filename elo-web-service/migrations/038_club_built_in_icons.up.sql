-- Replace the per-club uploaded SVG markup (icon_svg) with a lightweight key
-- that references a version-controlled built-in icon in the frontend
-- (nextjs/public/club-icons/<key>.svg). The SVG sanitizer is removed alongside
-- this; the backend now only validates the key's format.
--
-- The seeded club ids below are the UUIDs produced by int_to_uuid(1..3) in
-- migration 036 (1/2 were seeded in 035; 3 is new here).

ALTER TABLE clubs ADD COLUMN icon TEXT NULL;

-- Backfill keys for the two clubs seeded in 035.
UPDATE clubs SET icon = 'blue-figure' WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE clubs SET icon = 'clover'      WHERE id = '00000000-0000-0000-0000-000000000002';

-- Seed тбонк. Reuses id 3 so existing local/debug memberships (if any) stay
-- linked; in fresh environments this just inserts the new club.
INSERT INTO clubs (id, name, icon) VALUES
    ('00000000-0000-0000-0000-000000000003', 'тбонк', 'tbonk')
ON CONFLICT (id) DO UPDATE SET icon = EXCLUDED.icon;

ALTER TABLE clubs DROP COLUMN icon_svg;
