# Architecture Decision Records

ADRs are numbered sequentially; the highest numbers describe the current behavior. When a change contradicts an ADR, update the ADR in the same change. Start with ADR-12 (typed ids) and ADR-09 (calculator data) — most conventions in AGENTS.md trace back to them.

| ADR | Decision |
| --- | --- |
| [01](01-events-and-settlements.md) | Introduce events and settlements |
| [02](02-arena.md) | Арены и лиги |
| [03](03-newbie-rating.md) | Изменение рейтинга новичков |
| [04](04-tournaments.md) | Кемпы (турниры, выезды на совместные игры) |
| [05](05-clubs.md) | Поиск и отображение игроков своих клубов |
| [06](06-client-generated-ids.md) | Client generated ids |
| [07](07-short-ids.md) | Short ids (Base58-encoded UUIDs) |
| [08](08-jwt-legacy-id-fallback.md) | JWT legacy id fallback |
| [09](09-calculator-data.md) | Calculator data persistence (history mode) |
| [10](10-fixed-odds-markets.md) | Share markets (Polymarket-style) with LMSR + guarantors |
| [11](11-n-outcome-markets.md) | N-outcome markets with per-outcome identifiers |
| [12](12-typed-ids.md) | Typed identifiers (replacing the idcodec middleware) |
| [13](13-realtime-events.md) | Realtime events: one SSE hub, data-change signals, transient invites |
| [14](14-audit-log.md) | Audit log: append-only table, versioned details documents |
| [15](15-skull-king-table-session.md) | Skull King table session: strict host / connected-player modes |
| [16](16-offline-first-writes.md) | Offline-first writes: every create goes through the offline queue |
| [17](17-probability-vs-cost.md) | Probability vs cost: distinct names for what a share pays and what a buy charges |
| [18](18-game-tables.md) | Game tables: one live-table system for every game |
| [19](19-sse-multiplexing.md) | SSE multiplexing: one connection for app-global topics |
| [20](20-voluntary-guarantors.md) | Voluntary guarantors as liquidity providers (maker fees) |
| [21](21-settlement-checkpoints.md) | Settlement rows are per-row checkpoints (indexing and growth policy) |
| [22](22-liquidity-join-repricing.md) | Liquidity joins reprice the market (q-rescale removal) |
| [23](23-exposure-accrual-surplus.md) | Exposure-accrual surplus split for guarantors |
| [24](24-arena-rework.md) | Generalization and extension of arenas ([companion session notes](24-arena-rework-notes.md)) |
| [25](25-spa-routing-on-static-export.md) | SPA routing on a static export |
| [26](26-tournament-brackets.md) | Bracket tournaments |
| [27](27-camp-arenas.md) | Camp arenas: кэмпы leave the tournaments entity |
| [28](28-arena-membership-function.md) | Arena membership as one SQL function |
| [29](29-oauth-login-return-to-origin.md) | OAuth login: per-mirror callback, exchange via the API |
| [30](30-slot-earn-points.md) | Slot points from the match margin; the minimal advance score |
| [31](31-bgg-integration.md) | BGG integration: box-art enrichment via the XML API |
| [32](32-general-feed.md) | The general feed: server-merged arena/home event streams; markets lobby pagination |
| [33](33-game-modes.md) | Game modes: competitive, coop/solo, mixed — coop matches feed the home feed only |
| [34](34-guarantor-risk-to-depth.md) | Guarantor risk fully converts to liquidity (the L cap removal) |
| [35](35-tournament-market-born-on-start.md) | A tournament's betting market is born with the tournament — never created by hand |
