-- BGG box art: URLs fetched from the BoardGameGeek XML API by the enrichment
-- action (ADR-31) and hotlinked at render time — never copied. The XML API
-- Terms of Use license the data, not the images, so BGG stays the host.
ALTER TABLE games
    ADD COLUMN image_url TEXT,
    ADD COLUMN image_thumb_url TEXT;
