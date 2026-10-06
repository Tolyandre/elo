# 31. BGG integration: box-art enrichment via the XML API

Date: 2026-10-06

## Context

The games catalogue stores `bgg_id`/`tesera_id` (migration 062); Tesera provides discovery (name search) and the localized Russian titles, but its box-art thumbnails are small and the API is undocumented with no SLA. BoardGameGeek is the precise source: exact lookups by the stored `bgg_id`, canonical English names, and full box art. In 2025 BGG moved the XML API behind application registration — every request needs a Bearer token issued per registered application ([usage guide](https://boardgamegeek.com/using_the_xml_api), [Terms of Use](https://boardgamegeek.com/wiki/page/XML_API_Terms_of_Use)).

## Decision

**Client-side BGG calls are out; the Go backend owns the token.** BGG's terms mandate server-side, cached, minimal-traffic usage and revoke exposed tokens; the frontend is a static export and cannot hold a secret anyway. The token lives in the environment (`ELO_WEB_SERVICE_BGG_API_ACCESS_TOKEN`, optional — empty disables the feature entirely, same degradation as the Tesera client).

**Enrichment persists URLs; pages never call BGG** ("cache, don't hot-fetch"). `POST /games/bgg-enrich` (editor-gated) backfills every game that has a `bgg_id` but no image yet in batched `/xmlapi2/thing` requests (≤20 ids per call, ≥5 s between requests per BGG's guidance); a game created from an accepted suggestion (which carries the BGG id) enriches in the background after commit, and the admin action is the catch-up. Failures are reported per game, never fatal. The URLs land in `games.image_url` / `games.image_thumb_url` (migration 065) and flow to the frontend on the normal game reads.

**Images are hotlinked, never copied.** The Terms of Use license the API *data* and are silent on images — box art remains the rightsholders' property hosted by BGG. Hotlinking `cf.geekdo-images.com` keeps hosting and attribution with BGG, avoids any "modifying data" concern, and self-heals: a stale URL is repaired by the next enrichment run. The service worker caches the images (`CacheFirst`, 30 days) so pages stay fast and offline-capable.

**Attribution: name credit + official logo.** The Terms of Use require crediting BoardGameGeek by name and, for public-facing apps, displaying the official "Powered by BGG" logo linked back to BGG (files from BGG's official logo kit, light and reversed variants in `nextjs/public/bgg/`). Both sit in the global site footer: the data credit text («Данные об играх — BoardGameGeek») next to the logo.

**Tokens are per environment.** localhost, stage and prod each use their own token under the one registered application: per-token usage stats on the Applications page map to environments, and rotating a leaked dev token never touches prod. Stage and prod secrets ship via sops (`secrets.env` per deployment), localhost overrides via the gitignored `.env.local`.

**Division of labor with Tesera.** Tesera stays the discovery and Russian-name source (its detail objects also carry the `bggId` that seeds BGG lookups); BGG is the enrichment source of record for images and precise references. A BGG `/search` proxy for fixing wrong `bgg_id`s is deliberately deferred — name-based BGG search is not needed while Tesera supplies the ids.

## Consequences

- `pkg/bgg` mirrors `pkg/tesera`: a minimal client whose failures degrade to "no data".
- The enrichment rate is bounded (one batched request per backlog; ~5 s between batches), so a full-catalogue backfill is a handful of requests.
- If BGG revokes the license or the token, the feature switches off by removing the token; stored URLs keep rendering.
