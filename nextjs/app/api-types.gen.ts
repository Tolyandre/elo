import type { Base58ID } from "../lib/id";

export interface paths {
    "/ping": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health check */
        get: operations["GetPing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/players": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all players with Elo rankings */
        get: operations["ListPlayers"];
        put?: never;
        /** Create a new player */
        post: operations["CreatePlayer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/players/{id}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get player rating history and game statistics */
        get: operations["GetPlayerStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/players/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a player */
        delete: operations["DeletePlayer"];
        options?: never;
        head?: never;
        /** Update player name */
        patch: operations["PatchPlayer"];
        trace?: never;
    };
    "/games": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all games ordered by last played */
        get: operations["ListGames"];
        put?: never;
        /** Create a new game */
        post: operations["CreateGame"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/games/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get basic game info (the game's arena lives under /arenas, ADR-24) */
        get: operations["GetGame"];
        put?: never;
        post?: never;
        /** Delete a game */
        delete: operations["DeleteGame"];
        options?: never;
        head?: never;
        /** Update game name */
        patch: operations["PatchGame"];
        trace?: never;
    };
    "/games/{id}/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Attach a tag to a game (idempotent) */
        post: operations["AddGameTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/games/{id}/tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Detach a tag from a game */
        delete: operations["RemoveGameTag"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/arenas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List arenas, optionally narrowed to a game or a tournament */
        get: operations["ListArenas"];
        put?: never;
        /** Create an arena (editor only) */
        post: operations["CreateArena"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/arenas/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an arena by ID */
        get: operations["GetArena"];
        put?: never;
        post?: never;
        /** Delete a user-created arena (editor only) */
        delete: operations["DeleteArena"];
        options?: never;
        head?: never;
        /** Update a user-created arena's name, filter/dates and settings (editor only) */
        patch: operations["UpdateArena"];
        trace?: never;
    };
    "/arenas/{id}/players": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Arena players ranked, with precalculated match and medal stats */
        get: operations["GetArenaPlayers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/arenas/{id}/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the arena's matches with cursor-based pagination */
        get: operations["ListArenaMatches"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all tags with their usage counts, ordered by name */
        get: operations["ListTags"];
        put?: never;
        /** Create a new tag */
        post: operations["CreateTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tags/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a tag (detaches it from every game) */
        delete: operations["DeleteTag"];
        options?: never;
        head?: never;
        /** Rename a tag (applies to every game carrying it) */
        patch: operations["PatchTag"];
        trace?: never;
    };
    "/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List matches with cursor-based pagination */
        get: operations["ListMatches"];
        put?: never;
        /** Add a new match */
        post: operations["AddMatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/matches/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a match by ID */
        get: operations["GetMatchById"];
        /** Update a match (scores and date) */
        put: operations["UpdateMatch"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/matches/{id}/markets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get markets associated with a match */
        get: operations["GetMarketsByMatchId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tournaments (running/registration first, then finished) */
        get: operations["ListTournaments"];
        put?: never;
        /** Create a tournament (status = registration) */
        post: operations["CreateTournament"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get one tournament (with pool and participants) */
        get: operations["GetTournament"];
        /**
         * Update the registration-time configuration (name, deadline, pool, participants)
         * @description Editor only, and only while the tournament is in registration. The game pool is rewritten wholesale when present; participant_ids is the desired set when present (added and removed as needed). Every change is audit-logged as tournament-config.
         */
        put: operations["UpdateTournament"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/registration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register the current user's linked player
         * @description Requires a signed-in user with a linked player (ADR-26); only while the tournament is in registration. Idempotent.
         */
        post: operations["RegisterInTournament"];
        /** Withdraw the current user's linked player */
        delete: operations["UnregisterFromTournament"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/bracket-plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Enumerate the valid bracket shapes for the current participant count and pool
         * @description Editor only. A pure function of (participant count, game pool, elimination type) — nothing is stored. The organizer picks one plan and submits it verbatim to the start action. Fewer rounds first, then fewer tables, then larger slots; truncated reports that the cap cut a pathological explosion (the returned head still follows the order).
         */
        get: operations["ListTournamentBracketPlans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start the tournament with the chosen bracket shape
         * @description Editor only, while in registration. The submitted plan must be one the server would have offered (validated against a fresh enumeration). The plan is stored verbatim, all rounds/slots/seats are generated, first- round seats (and byes) are drawn at random from the stored seed, a pool-fitting game is assigned to every slot, and the tournament's arena is created. Registration closes.
         */
        post: operations["StartTournament"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancel the tournament (organizer)
         * @description Editor only, from registration or running. Completed tournaments cannot be cancelled. Audited as tournament-state with reason "organizer"; the grand-final deadline auto-cancel writes the same shape with reason "deadline" and a null actor.
         */
        post: operations["CancelTournament"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/bracket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The full bracket (public)
         * @description Rendering-ready DTO: rounds in canonical track order, slots with seats, linked matches and live standings derived from the linked matches' scores. Empty rounds list before the start.
         */
        get: operations["GetTournamentBracket"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/slots/{sid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Adjust a slot's game or seat count (organizer, running state)
         * @description Game reassignment — only for slots with zero linked matches. Seat-count changes — only for first-round slots with zero linked matches and no resolved seats (the draw re-deals from the stored seed, possibly absorbing bye players). promote stays put. Every adjustment is audit-logged as slot-adjust.
         */
        patch: operations["AdjustTournamentSlot"];
        trace?: never;
    };
    "/tournaments/{id}/slots/{sid}/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Attach an existing unlinked match to a playing slot (organizer)
         * @description Repairs a mistakenly unchecked checkbox: the match must have the slot's game and exactly the seated players, and must not be linked elsewhere. Audited as slot-link attach (origin organizer).
         */
        post: operations["AttachTournamentSlotMatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/slots/{sid}/matches/{mid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Detach a wrongly linked match from its slot (organizer)
         * @description The match stays in the tournament's arena (it was played at the event); only the bracket forgets it. Triggers the same re-evaluation and cascade as an edit.
         */
        delete: operations["DetachTournamentSlotMatch"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tournaments/{id}/slots/{sid}/ruling": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Complete a slot by hand with an ordered promotion set (organizer)
         * @description An ordered list of exactly `promote` seated players — covers abandoned matches, no-shows, disputes. The ruling replaces the current outcome and can be replaced by the standings-based result; every ruling and reversion is audited (slot-ruling).
         */
        post: operations["SetTournamentSlotRuling"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/clubs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all clubs */
        get: operations["ListClubs"];
        put?: never;
        /** Create a new club */
        post: operations["CreateClub"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/clubs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a club by ID */
        get: operations["GetClub"];
        put?: never;
        post?: never;
        /** Delete a club */
        delete: operations["DeleteClub"];
        options?: never;
        head?: never;
        /**
         * Update a club (name and/or icon)
         * @description Partial update. A field that is omitted is left unchanged. For `icon`, an empty string clears the icon; a non-empty value is a key into the frontend's built-in icon set and is validated server-side (lowercase kebab-case, 1-32 characters).
         */
        patch: operations["PatchClub"];
        trace?: never;
    };
    "/clubs/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a player to a club */
        post: operations["AddClubMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/clubs/{id}/members/{playerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a player from a club */
        delete: operations["RemoveClubMember"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get current active Elo settings */
        get: operations["GetSettings"];
        put?: never;
        /** Create new Elo settings (effective from a future date) */
        post: operations["CreateSettings"];
        /** Delete future Elo settings */
        delete: operations["DeleteSettings"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get all Elo settings entries (historical and future) */
        get: operations["ListAllSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all users */
        get: operations["ListUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update user editing permissions */
        patch: operations["PatchUser"];
        trace?: never;
    };
    "/markets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List active and closed markets */
        get: operations["ListMarkets"];
        put?: never;
        /** Create a new betting market */
        post: operations["CreateMarket"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get market details (includes user-specific projections if authenticated) */
        get: operations["GetMarket"];
        put?: never;
        post?: never;
        /** Delete a market (only if status is open) */
        delete: operations["DeleteMarket"];
        options?: never;
        head?: never;
        /** Update market status (e.g. close betting) */
        patch: operations["PatchMarket"];
        trace?: never;
    };
    "/markets/{id}/bets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Place a bet on a market */
        post: operations["PlaceBet"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/guarantees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Become a guarantor of a market (place a guarantor wager)
         * @description Adds the caller's linked player as a guarantor with the given risk amount and maker fee rate (ADR-20). The risk is reserved against the betting limit, the market's liquidity grows (prices are preserved by rescaling), and the wager is immutable. Wagers over-subscribing the market's L are accepted in full but add no liquidity.
         */
        post: operations["CreateMarketGuarantee"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/markets/{id}/probability-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Reconstructed per-outcome probability history of a market
         * @description The probability (LMSR marginal price) of every outcome after every event, reconstructed by replaying the market's timeline — bets and guarantee joins (which change liquidity b and rescale q without moving prices) — from the creation state. No probabilities are persisted; the series is derived from the immutable bets and market_guarantees rows alone.
         */
        get: operations["GetMarketProbabilityHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Initiate Google OAuth2 login flow */
        get: operations["AuthLogin"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oauth2-callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Google OAuth2 callback */
        get: operations["AuthOAuth2Callback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout (clears session cookie) */
        post: operations["AuthLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get current authenticated user */
        get: operations["GetMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update current user's linked player */
        patch: operations["PatchMe"];
        trace?: never;
    };
    "/corrections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List corrections with cursor-based pagination */
        get: operations["ListCorrections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List audit events (who did what and when) with cursor-based pagination
         * @description Public read (consistent with other read endpoints). Events are returned latest-first. Filter by entity_type for the admin audit tabs, or by entity_type + entity_id for one entity's history (e.g. a match).
         */
        get: operations["ListAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/update-arenas": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Recalculate every arena to the actual state (ADR-24): the global arena by replaying the whole settlement history (matches, corrections and market settlements — the same computation an edit+save of the chronologically first match triggers), and every other arena by a full replay of its filtered matches. A stable recalculation reports no changed players. Invoked manually after deployments via the /debug page. */
        post: operations["UpdateArenas"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/players/{id}/corrections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Apply a manual rating correction for a player */
        post: operations["CreatePlayerCorrection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all active game tables */
        get: operations["ListTables"];
        put?: never;
        /** Create a new game table */
        post: operations["CreateTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a game table by ID */
        get: operations["GetTable"];
        put?: never;
        post?: never;
        /** Delete a game table (host only) */
        delete: operations["DeleteTable"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables/{id}/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Replace the game state (host only, optimistic lock) */
        patch: operations["UpdateTableState"];
        trace?: never;
    };
    "/tables/{id}/join": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Join a game table as a connected player */
        post: operations["JoinTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit the connected player's input (bid, round result, or scoring)
         * @description The payload shape depends on the table's game: skull-king reads `bid` (waiting-for-bids phase) or `actual`+`bonus` (result-entry phase); iaww reads `directVp`+`cells`. A submission is final — the player cannot change it afterwards; only the host can correct it.
         */
        post: operations["SubmitTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables/{id}/takeover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Claim hosting of the table for this device
         * @description Claims hosting for the requesting device (host_client_token — a per-browser token; the summary broadcasts it so the same user's other devices step down to player/viewer mode). The current host may always re-claim, which is also how hosting resumes on another device; any other user additionally needs edit permission.
         */
        post: operations["TakeoverTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ApiError: {
            /** @enum {string} */
            status: "fail";
            message: string;
        };
        ApiSuccessMessage: {
            /** @enum {string} */
            status: "success";
            message: string;
        };
        /** @description Entity identifier: a UUID (v7 for client-minted ids) encoded as a short Base58 string (~22 chars, Bitcoin alphabet — no 0/O/I/l). In create requests the client generates the id; it serves as both the primary key and the idempotency key, so a repeated request with the same id returns the already-created entity. The backend also accepts the standard 36-char canonical UUID form for backward compatibility. */
        Base58ID: Base58ID;
        EloRank: {
            /** Format: double */
            rating: number;
            /** @enum {string} */
            league: "newbie" | "amateur" | "elite";
            rank?: number | null;
            /** @description Only set for amateur league players; how many more matches are needed to reach elite league. */
            matches_left_for_elite?: number | null;
            /** @description Lower bound of wins needed to reach amateur league (elo treated as fixed). */
            wins_needed_for_amateur?: number | null;
            /** @description Upper bound of wins needed (accounts for elo growth ≈ K/2 per win). */
            wins_needed_for_amateur_upper?: number | null;
        };
        HistoryRank: {
            now: components["schemas"]["EloRank"];
            day_ago: components["schemas"]["EloRank"];
            week_ago: components["schemas"]["EloRank"];
        };
        Player: {
            id: components["schemas"]["Base58ID"];
            name: string;
            geologist_name?: string | null;
            user_id?: components["schemas"]["Base58ID"] | null;
            rank: components["schemas"]["HistoryRank"];
        };
        /** @description Minimal player object returned after create/patch */
        PlayerRef: {
            id: components["schemas"]["Base58ID"];
            name: string;
        };
        RatingPoint: {
            /** Format: date-time */
            date: string;
            /** Format: double */
            rating: number;
            /** Format: double */
            elo: number;
        };
        GameMatchStat: {
            game_id: components["schemas"]["Base58ID"];
            game_name: string;
            matches_count: number;
            /** @description Number of 1st-place (gold medal) finishes in this game. */
            gold_count: number;
            /** @description Number of 2nd-place (silver medal) finishes in this game. */
            silver_count: number;
            /** @description Number of 3rd-place (bronze medal) finishes in this game. */
            bronze_count: number;
        };
        GameEloStat: {
            game_id: components["schemas"]["Base58ID"];
            game_name: string;
            /** Format: double */
            elo_earned: number;
        };
        PlayerStats: {
            player_name: string;
            rating_history: components["schemas"]["RatingPoint"][];
            top_games_by_matches: components["schemas"]["GameMatchStat"][];
            top_games_by_elo_earned: components["schemas"]["GameEloStat"][];
            worst_games_by_elo_earned: components["schemas"]["GameEloStat"][];
        };
        GameListItem: {
            id: components["schemas"]["Base58ID"];
            name: string;
            last_played_order: number;
            total_matches: number;
            /** @description Tags attached to the game, ordered by tag name */
            tags: components["schemas"]["GameTag"][];
        };
        GameList: {
            games: components["schemas"]["GameListItem"][];
        };
        Game: {
            id: components["schemas"]["Base58ID"];
            name: string;
            total_matches: number;
        };
        GameTag: {
            id: components["schemas"]["Base58ID"];
            name: string;
        };
        /** @description The arena's match filter (ADR-24): a match meets the filter iff it satisfies every present condition; null conditions are absent. game_ids and tag_ids are OR'd; both empty mean any game. Camp arenas have no filter. */
        MatchFilter: {
            /** Format: date-time */
            date_from?: string | null;
            /** Format: date-time */
            date_to?: string | null;
            game_ids: components["schemas"]["Base58ID"][];
            tag_ids: components["schemas"]["Base58ID"][];
        };
        /** @description Versioned arena settings document (ADR-24), validated server-side against the JSON Schema in pkg/arenasettings. Shape v1: {starting_rating: number, leagues: [{kind: newbie|amateur|elite, ...params}]}. */
        ArenaSettings: {
            [key: string]: unknown;
        };
        Arena: {
            id: components["schemas"]["Base58ID"];
            name: string;
            /** @description Camp arena (ADR-27): a date-bounded rating space whose membership is the explicit match link, not a filter. Camps have no filter, no leagues, and carry starts_at/ends_at. */
            camp: boolean;
            /** @description null for camp arenas. */
            filter: components["schemas"]["MatchFilter"] | null;
            settings: components["schemas"]["ArenaSettings"];
            settings_schema_version: number;
            /**
             * Format: date-time
             * @description Camp window start (camps only).
             */
            starts_at?: string | null;
            /**
             * Format: date-time
             * @description Camp window end (camps only).
             */
            ends_at?: string | null;
            /** @description Camp participants, derived from the arena settlements (camps in list responses only). */
            player_ids?: components["schemas"]["Base58ID"][];
            /** @description Set for the auto-managed per-game arena. */
            game_id?: components["schemas"]["Base58ID"];
            /** @description Set for the auto-managed per-tournament arena. */
            tournament_id?: components["schemas"]["Base58ID"];
            /**
             * Format: date-time
             * @description Not null while the arena waits for a background recalculation.
             */
            stale_at?: string | null;
            /** @description Number of matches meeting the arena's filter, or linked to the camp (list responses only). */
            matches_count?: number;
        };
        /** @description Create/update body. The settings object is validated server-side against the current arena-settings JSON Schema; league parameters live there. Camp arenas (camp: true) take starts_at/ends_at and no filter; every other arena takes a filter. */
        ArenaInput: {
            name: string;
            /** @default false */
            camp: boolean;
            filter?: components["schemas"]["MatchFilter"];
            /** Format: date-time */
            starts_at?: string | null;
            /** Format: date-time */
            ends_at?: string | null;
            settings: components["schemas"]["ArenaSettings"];
        };
        ArenaResult: {
            status: string;
            data: components["schemas"]["Arena"];
        };
        ArenaList: {
            status: string;
            data: components["schemas"]["Arena"][];
        };
        /** @description One row of the arena players tab — latest settlement state joined with the precalculated stats. */
        ArenaPlayer: {
            player_id: components["schemas"]["Base58ID"];
            name: string;
            /** Format: double */
            rating: number;
            /** @description null when the arena has no leagues. */
            league: string | null;
            rank: number | null;
            matches_count: number;
            first_count: number;
            second_count: number;
            third_count: number;
            fourth_count: number;
            matches_left_for_elite: number;
            wins_needed_for_amateur: number;
            wins_needed_for_amateur_upper: number;
            /** @description Rank/rating snapshots used for the change indicators; null league means the arena has no leagues, a null point means no settlement existed at that moment. */
            rank_history?: {
                day_ago: components["schemas"]["ArenaRankPoint"];
                week_ago: components["schemas"]["ArenaRankPoint"];
            } | null;
        };
        ArenaPlayersList: {
            status: string;
            data: components["schemas"]["ArenaPlayer"][];
        };
        ArenaRankPoint: {
            /** Format: double */
            rating: number;
            league: string | null;
            rank: number | null;
        };
        /** @description Per-player data within a match (keyed by player_id in the score map) */
        MatchPlayer: {
            /** Format: double */
            rating_staked: number;
            /** Format: double */
            rating_earned: number;
            /** Format: double */
            score: number;
            /** Format: double */
            rating_after: number;
        };
        /** @description A camp arena (ADR-27) a match belongs to */
        MatchCamp: {
            id: components["schemas"]["Base58ID"];
            name: string;
        };
        /** @description The tournament slot a match is counted for (ADR-26). Server-assigned at the match write when the match exactly fits a playing slot, by the organizer's attach, or by an explicit edit-time link change (skip_tournament_link on PUT); association-breaking edits (game/roster) are still rejected. The link survives detach — only the bracket forgets voided results, the tournament arena keeps counting the match. */
        MatchTournament: {
            /** @description The tournament id */
            id: components["schemas"]["Base58ID"];
            name: string;
            slot_id: components["schemas"]["Base58ID"];
        };
        Match: {
            id: components["schemas"]["Base58ID"];
            game_id: components["schemas"]["Base58ID"];
            game_name: string;
            /** Format: date-time */
            date: string;
            /** @description Map of player_id (string) to player score data */
            score: {
                [key: string]: components["schemas"]["MatchPlayer"];
            };
            has_markets: boolean;
            /** @description Camp arenas (ADR-27) this match belongs to */
            camps?: components["schemas"]["MatchCamp"][];
            /** @description The bracket slot the match counts for (ADR-26); null when unlinked. */
            tournament?: components["schemas"]["MatchTournament"];
            /** @description Identifier of the calculator that produced this match, or null when the match was created via the generic form. Clients use this to decide whether to open the match in the calculator (history mode) or the generic edit form. */
            calculator_kind?: string | null;
            /** @description Intermediate calculator state. Present only when calculator_kind is non-null. Opaque at the OpenAPI layer; see pkg/calculator for the per-kind JSON Schemas. */
            calculator_data?: Record<string, never> | null;
        };
        MatchesPage: {
            status: string;
            data: components["schemas"]["Match"][];
            /** @description Cursor token for the next page; null if no more pages */
            next?: string | null;
        };
        /** @description One pool game with its table capacity. */
        TournamentGame: {
            game_id: components["schemas"]["Base58ID"];
            min_players: number;
            max_players: number;
        };
        Tournament: {
            id: components["schemas"]["Base58ID"];
            name: string;
            /** @enum {string} */
            status: "registration" | "running" | "completed" | "cancelled";
            /** @enum {string} */
            elimination: "single" | "double";
            /** Format: date-time */
            grand_final_deadline?: string | null;
            winner_player_id?: components["schemas"]["Base58ID"];
            games: components["schemas"]["TournamentGame"][];
            /** @description Player ids in registration order (list/detail reads) */
            participant_ids?: components["schemas"]["Base58ID"][];
            /** Format: date-time */
            created_at?: string;
        };
        TournamentInput: {
            /** @description Client-generated id (ADR-06): the primary key and idempotency key. A replay with the same id returns the already-created tournament. */
            id?: components["schemas"]["Base58ID"];
            name: string;
            /** @enum {string} */
            elimination: "single" | "double";
            /**
             * Format: date-time
             * @description Optional; when it passes without a completed grand final the tournament auto-cancels.
             */
            grand_final_deadline?: string | null;
            /** @description The game pool (desired set on update — rewritten wholesale when present). */
            games?: components["schemas"]["TournamentGame"][];
            /** @description The desired participant set on update (diffed when present); the initial set on create. */
            participant_ids?: components["schemas"]["Base58ID"][];
        };
        TournamentResponse: {
            status: string;
            data: components["schemas"]["Tournament"];
        };
        TournamentList: {
            status: string;
            data: components["schemas"]["Tournament"][];
        };
        /** @description One seat's provenance: draw (round-1 winners seat, filled from the seeded draw), bye (the round-1 remainder, seated in winners round 2 or the grand final), or source (place source_place of the flat plan slot index source_slot). */
        PlanSeat: {
            /** @enum {string} */
            kind: "draw" | "bye" | "source";
            source_slot?: number;
            source_place?: number;
        };
        PlanSlot: {
            seat_count: number;
            seats: components["schemas"]["PlanSeat"][];
        };
        /** @description One elimination round; promote is uniform across the round. */
        PlanRound: {
            /** @enum {string} */
            track: "winners" | "losers" | "final";
            index: number;
            promote: number;
            slots: components["schemas"]["PlanSlot"][];
        };
        /** @description A complete, pre-computed bracket shape: every round, every slot, every seat's provenance. Game-free and id-free — the server assigns a pool-fitting game to every slot at start. */
        TournamentPlan: {
            /** @enum {string} */
            elimination: "single" | "double";
            rounds: components["schemas"]["PlanRound"][];
        };
        BracketPlansResponse: {
            status: string;
            data: {
                plans: components["schemas"]["TournamentPlan"][];
                truncated: boolean;
                cap: number;
            };
        };
        BracketSeat: {
            position: number;
            /** @description Set for direct seeds (round 1 / byes) and refilled seat caches. */
            player_id?: components["schemas"]["Base58ID"];
            source_slot_id?: components["schemas"]["Base58ID"];
            source_place?: number | null;
        };
        BracketSlot: {
            id: components["schemas"]["Base58ID"];
            game_id: components["schemas"]["Base58ID"];
            /** @description Table number within the round */
            position: number;
            promote: number;
            /** @enum {string} */
            status: "waiting" | "playing" | "completed";
            seats: components["schemas"]["BracketSeat"][];
            matches: {
                match_id: components["schemas"]["Base58ID"];
            }[];
            /** @description Live standings derived from the linked matches' scores: placement points, current order, and the recorded promoted set. */
            standings: {
                player_id: components["schemas"]["Base58ID"];
                points: number;
                place: number;
                promoted: boolean;
            }[];
        };
        BracketRound: {
            /** @enum {string} */
            track: "winners" | "losers" | "final";
            index: number;
            slots: components["schemas"]["BracketSlot"][];
        };
        Bracket: {
            tournament_id: components["schemas"]["Base58ID"];
            /** @enum {string} */
            status: "registration" | "running" | "completed" | "cancelled";
            /** @enum {string} */
            elimination: "single" | "double";
            winner_player_id?: components["schemas"]["Base58ID"];
            rounds: components["schemas"]["BracketRound"][];
        };
        BracketResponse: {
            status: string;
            data: components["schemas"]["Bracket"];
        };
        Club: {
            id: components["schemas"]["Base58ID"];
            name: string;
            geologist_name?: string | null;
            /** @description Key into the frontend's built-in club icon set (e.g. "clover"). Null means the club has no icon. The icon itself is a version-controlled static SVG in the frontend. */
            icon?: string | null;
            /** @description List of player IDs */
            player_ids: components["schemas"]["Base58ID"][];
        };
        Tag: {
            id: components["schemas"]["Base58ID"];
            name: string;
            /** @description Number of games carrying this tag */
            game_count: number;
        };
        Settings: {
            /** Format: double */
            elo_const_k: number;
            /** Format: double */
            elo_const_d: number;
            /** Format: double */
            starting_elo: number;
            /** Format: double */
            win_reward: number;
            /** Format: double */
            newbie_league_earned_min: number;
            /** Format: double */
            newbie_league_earned_max: number;
            /** Format: double */
            newbie_league_earned_tau: number;
            /** Format: double */
            newbie_league_goal_gap: number;
            /** Format: double */
            starting_rating_global_arena: number;
            /** Format: double */
            starting_rating_game_arena: number;
            elite_league_matches_6months: number;
            elite_league_matches_2months: number;
        };
        EloSettingEntry: {
            /** @description RFC3339 date or "-infinity" */
            effective_date: string;
            /** Format: double */
            elo_const_k: number;
            /** Format: double */
            elo_const_d: number;
            /** Format: double */
            starting_elo: number;
            /** Format: double */
            win_reward: number;
        };
        User: {
            id: components["schemas"]["Base58ID"];
            name: string;
            can_edit: boolean;
            player_id?: components["schemas"]["Base58ID"] | null;
        };
        SettlementDetail: {
            player_id: components["schemas"]["Base58ID"];
            player_name: string;
            /** Format: double */
            staked: number;
            /** Format: double */
            earned: number;
        };
        MatchWinnerParams: {
            /** @description Target players — one "player wins" outcome exists per player. */
            target_player_ids: components["schemas"]["Base58ID"][];
            /** @description true — a resolving match must include all targets but may include other players; false — the match must consist of exactly the target players. */
            allow_other_players: boolean;
            game_ids?: components["schemas"]["Base58ID"][];
        };
        WinStreakParams: {
            target_player_id: components["schemas"]["Base58ID"];
            game_ids: components["schemas"]["Base58ID"][];
            wins_required: number;
            max_losses?: number | null;
        };
        Market: {
            id: components["schemas"]["Base58ID"];
            /** @enum {string} */
            market_type: "match_winner" | "win_streak";
            /** @enum {string} */
            status: "open" | "betting_closed" | "resolved" | "expired" | "cancelled";
            /** @description The winning outcome id (GUID) for resolved markets; null for open/betting_closed markets and for cancelled markets (cancellation is carried by status alone). Typed as Base58ID so it carries the same short form as the market's outcome ids. */
            resolution_outcome_id?: components["schemas"]["Base58ID"] | null;
            /** @description The match that resolved the market, when it was resolved by one. */
            resolution_match_id?: components["schemas"]["Base58ID"] | null;
            /** Format: date-time */
            starts_at?: string | null;
            /** Format: date-time */
            closes_at?: string | null;
            /** Format: date-time */
            created_at?: string | null;
            /** Format: date-time */
            resolved_at?: string | null;
            /** Format: date-time */
            betting_closed_at?: string | null;
            /** @description The market's mutually-exclusive outcomes; probabilities sum to 1. */
            outcomes: components["schemas"]["MarketOutcome"][];
            /**
             * Format: double
             * @description LMSR liquidity parameter, dynamic since guarantees became voluntary (ADR-20): b = min(max_guarantor_loss, Σrisk)/ln(n), growing as guarantor wagers arrive. 0 while the market awaits its first guarantor.
             */
            liquidity_b: number;
            /**
             * Format: double
             * @description Maximum combined guarantor risk L: bounds b (and with it the guarantors' combined worst-case loss at their risked amounts).
             */
            max_guarantor_loss: number;
            /**
             * Format: double
             * @description The market's current maker fee c: the risk-weighted mean of the guarantor wagers' fee rates. Buyers pay the variance-proportional surcharge p + 4c·p(1−p) per share (0 while there are no fee-charging guarantors).
             */
            fee_rate?: number;
            /**
             * Format: double
             * @description Total maker fees the market generated (final once resolved).
             */
            fee_collected?: number;
            /** @description The market's guarantor wagers (multiple per player allowed). */
            guarantees?: components["schemas"]["MarketGuarantee"][];
            /** @description Market-type-specific parameters */
            params?: (components["schemas"]["MatchWinnerParams"] | components["schemas"]["WinStreakParams"]) | null;
            /** @description Buyer settlements (discriminator 'market') for a resolved market. */
            settlement?: components["schemas"]["SettlementDetail"][];
            /** @description Per-guarantor payout rollup for a resolved market: the guarantor-role settlement row of every player who guaranteed the market. A guarantor who also bought on the market has a separate buyer row (shown in `settlement`), so their entry here carries only the house result (payout/surcharge). */
            guarantor_settlement?: components["schemas"]["SettlementDetail"][];
        };
        MarketDetail: components["schemas"]["Market"] & {
            /** @description The user's per-outcome holdings on this market (empty when none). */
            my_positions?: {
                outcome_id: components["schemas"]["Base58ID"];
                /**
                 * Format: double
                 * @description Elo the user spent on this outcome.
                 */
                staked: number;
                /**
                 * Format: double
                 * @description Shares the user holds (each pays 1 if the outcome wins).
                 */
                shares: number;
            }[];
            /** Format: double */
            reserved?: number | null;
            /** Format: double */
            bet_limit?: number | null;
        };
        /** @description A player's voluntary, immutable guarantor wager: the risk amount (their maximum loss, reserved against the betting limit) and their maker fee rate. A player may hold several wagers on one market; wagers cannot be withdrawn. */
        MarketGuarantee: {
            id: components["schemas"]["Base58ID"];
            player_id: components["schemas"]["Base58ID"];
            player_name: string;
            /**
             * Format: double
             * @description The maximum the guarantor can lose on this wager.
             */
            risk_amount: number;
            /**
             * Format: double
             * @description The wager's maker fee rate (0–25%): raises the market's weighted fee and both the guarantor's share of collected fees and their position in the first-loss waterfall.
             */
            fee_rate: number;
            /**
             * Format: date-time
             * @description When the wager was placed.
             */
            placed_at: string;
        };
        Correction: {
            id: components["schemas"]["Base58ID"];
            player_id: components["schemas"]["Base58ID"];
            player_name: string;
            /** Format: double */
            diff: number;
            /** Format: date-time */
            date: string;
        };
        CorrectionsPage: {
            status: string;
            data: components["schemas"]["Correction"][];
            /** @description Cursor token for the next page; null if no more pages */
            next?: string | null;
        };
        PlayerStateChange: {
            player_id: components["schemas"]["Base58ID"];
            player_name: string;
            /** Format: double */
            elo_before: number;
            /** Format: double */
            elo_after: number;
            /** Format: double */
            rating_before: number;
            /** Format: double */
            rating_after: number;
            league_before: string | null;
            league_after: string | null;
        };
        GlobalReplayReport: {
            /** Format: int64 */
            matches_replayed: number;
            /** Format: int64 */
            corrections_replayed: number;
            changed_players: components["schemas"]["PlayerStateChange"][];
        };
        ArenaUpdateReport: {
            arena_id: components["schemas"]["Base58ID"];
            arena_name: string;
            /** Format: int64 */
            matches_replayed: number;
            changed_players: components["schemas"]["PlayerStateChange"][];
        };
        UpdateArenasResult: {
            status: string;
            data: {
                global: components["schemas"]["GlobalReplayReport"];
                arenas: components["schemas"]["ArenaUpdateReport"][];
            };
        };
        AuditEntry: {
            id: components["schemas"]["Base58ID"];
            /** Format: date-time */
            created_at: string;
            /** @description Null for system events (the grand-final-deadline auto-cancel, ADR-26). */
            actor_user_id: components["schemas"]["Base58ID"];
            /** @description Display name of the acting user at read time; null for system events. */
            actor_name: string | null;
            /** @enum {string} */
            entity_type: "match" | "game" | "player" | "club" | "tag" | "arena" | "tournament";
            entity_id: components["schemas"]["Base58ID"];
            /** @enum {string} */
            action: "created" | "updated" | "renamed" | "deleted";
            /** @description Action-specific payload; null when the event carries no details (match created). Narrow by action: entity → AuditEntityDetails (created/deleted of game/player/club/tag), renamed → AuditRenameDetails, updated → AuditMatchUpdateDetails; arena → AuditArenaCampConfigDetails (camp config) or AuditCampLinkDetails (match attach/detach); tournament → AuditTournamentConfigDetails / AuditTournamentStartDetails / AuditTournamentStateDetails / AuditSlotRulingDetails / AuditSlotLinkDetails / AuditSlotAdjustDetails (ADR-26). */
            details?: (components["schemas"]["AuditEntityDetails"] | components["schemas"]["AuditRenameDetails"] | components["schemas"]["AuditMatchUpdateDetails"] | components["schemas"]["AuditArenaCampConfigDetails"] | components["schemas"]["AuditCampLinkDetails"] | components["schemas"]["AuditTournamentConfigDetails"] | components["schemas"]["AuditTournamentStartDetails"] | components["schemas"]["AuditTournamentStateDetails"] | components["schemas"]["AuditSlotRulingDetails"] | components["schemas"]["AuditSlotLinkDetails"] | components["schemas"]["AuditSlotAdjustDetails"]) | null;
        };
        AuditEntityDetails: {
            schema_version: number;
            /** @description Entity name at the moment of creation/deletion */
            name: string;
        };
        AuditRenameDetails: {
            schema_version: number;
            old_name: string;
            new_name: string;
        };
        AuditMatchUpdateDetails: {
            schema_version: number;
            date?: {
                /** Format: date-time */
                old: string;
                /** Format: date-time */
                new: string;
            } | null;
            game?: {
                old_game_id: components["schemas"]["Base58ID"];
                new_game_id: components["schemas"]["Base58ID"];
            } | null;
            player_changes: {
                player_id: components["schemas"]["Base58ID"];
                /** @enum {string} */
                change: "added" | "removed" | "score";
                /** Format: double */
                old_score?: number | null;
                /** Format: double */
                new_score?: number | null;
            }[];
            calculator_changed: boolean;
        };
        AuditPage: {
            status: string;
            data: components["schemas"]["AuditEntry"][];
            /** @description Cursor token for the next page; null if no more pages */
            next?: string | null;
        };
        TablePlayer: {
            id: components["schemas"]["Base58ID"];
            name: string;
        };
        TableSummary: {
            id: components["schemas"]["Base58ID"];
            game_id: components["schemas"]["Base58ID"];
            host_user_id: components["schemas"]["Base58ID"];
            /** @description Per-device token of the device that last claimed hosting; a host session whose token differs steps down to player/viewer mode. Empty on legacy tables (nothing enforces it). */
            host_client_token: string;
            game_state: components["schemas"]["TableGameState"];
            connected_player_ids: components["schemas"]["Base58ID"][];
            /**
             * Format: int64
             * @description Optimistic-lock counter; changes with every game_state write
             */
            version: number;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            expires_at: string;
        };
        TableGameState: components["schemas"]["SkullKingGameState"] | components["schemas"]["IawwGameState"];
        SkullKingGameState: {
            /** @enum {string} */
            phase: "setup" | "bidding" | "waiting-for-bids" | "bid-review" | "result-entry" | "round-complete";
            players: components["schemas"]["TablePlayer"][];
            currentRound: number;
            currentPlayerIndex: number;
            /** @description rounds[roundIndex][playerIndex] — null until the player has entered data */
            rounds: (components["schemas"]["SkullKingRoundEntry"] | null)[][];
            fallbackGameId?: components["schemas"]["Base58ID"] | null;
        };
        SkullKingRoundEntry: {
            bid: number;
            actual?: number | null;
            bonus: number;
        };
        IawwGameState: {
            /**
             * @description setup is client-only (pre-table); tables are created in scoring
             * @enum {string}
             */
            phase: "setup" | "scoring";
            players: components["schemas"]["TablePlayer"][];
            /** @description One entry per player, same order as players */
            entries: components["schemas"]["IawwEntry"][];
            fallbackGameId?: components["schemas"]["Base58ID"] | null;
        };
        IawwEntry: {
            playerId: components["schemas"]["Base58ID"];
            /** @description Direct victory points; null until entered */
            directVp?: number | null;
            cells: components["schemas"]["IawwCell"][];
            /** @description The player has submitted their final scoring */
            done: boolean;
        };
        /** @description One mutually-exclusive outcome of a market. The id is the business-logic identifier (bets and resolution reference it); the name is derived on the fly for display only (player outcome → player name, other → «Ничья», yes/no → «Да»/«Нет»). */
        MarketOutcome: {
            id: components["schemas"]["Base58ID"];
            /**
             * @description player — a specific target player wins (see player_id); other — tie at first place or a non-target player wins; yes/no — the two fixed outcomes of a win_streak market.
             * @enum {string}
             */
            kind: "player" | "other" | "yes" | "no";
            /** @description Set iff kind=player. */
            player_id?: components["schemas"]["Base58ID"] | null;
            name: string;
            /**
             * Format: double
             * @description Live probability of the outcome in [0,1] (the LMSR marginal price); probabilities sum to 1. Not the cost of a share: buying `s` shares costs C(q+s·e_i) − C(q), which exceeds the probability whenever the buy moves the price (small liquidity b). The cost is derived from `shares` (the AMM q) + the market's `liquidity_b`, not from this field.
             */
            probability: number;
            /**
             * Format: double
             * @description Outstanding shares of this outcome (the AMM q; each pays 1 if it wins).
             */
            shares: number;
            /**
             * Format: double
             * @description Total elo spent on this outcome.
             */
            pool: number;
        };
        /** @description Name and date window of a camp arena (ADR-27) as before → after pairs. Create fills the 'to' side, update both sides (changed fields only), delete the 'from' side. Untouched fields stay null. */
        AuditArenaCampConfigDetails: {
            schema_version: number;
            name: {
                from?: string | null;
                to?: string | null;
            } | null;
            starts_at: {
                /** Format: date-time */
                from?: string | null;
                /** Format: date-time */
                to?: string | null;
            } | null;
            ends_at: {
                /** Format: date-time */
                from?: string | null;
                /** Format: date-time */
                to?: string | null;
            } | null;
        };
        /** @description One match attach/detach on the camp arena the audit row points at. */
        AuditCampLinkDetails: {
            schema_version: number;
            /** @enum {string} */
            op: "attach" | "detach";
            match_id: components["schemas"]["Base58ID"];
        };
        AuditTournamentGameDoc: {
            game_id: components["schemas"]["Base58ID"];
            min_players: number;
            max_players: number;
        };
        /** @description Registration-time configuration of the tournament the audit row points at (ADR-26): name, grand-final deadline, game pool, participants — full before → after on every change; create fills the 'to' sides only. Untouched fields stay null. */
        AuditTournamentConfigDetails: {
            schema_version: number;
            name?: {
                from?: string | null;
                to?: string | null;
            } | null;
            grand_final_deadline?: {
                /** Format: date-time */
                from?: string | null;
                /** Format: date-time */
                to?: string | null;
            } | null;
            games?: {
                from?: components["schemas"]["AuditTournamentGameDoc"][];
                to?: components["schemas"]["AuditTournamentGameDoc"][];
            } | null;
            from_player_ids?: components["schemas"]["Base58ID"][];
            to_player_ids?: components["schemas"]["Base58ID"][];
        };
        /** @description The start decision (ADR-26): the chosen plan verbatim (game-free and id-free), the stored PRNG seed, and the participants in draw-input order. */
        AuditTournamentStartDetails: {
            schema_version: number;
            plan: components["schemas"]["TournamentPlan"];
            /** Format: int64 */
            seed: number;
            participant_ids?: components["schemas"]["Base58ID"][];
        };
        /** @description A lifecycle transition (ADR-26): completed, or cancelled by the organizer / by the grand-final deadline (the latter with a null actor — the system). */
        AuditTournamentStateDetails: {
            schema_version: number;
            /** @enum {string} */
            from: "registration" | "running" | "completed" | "cancelled";
            /** @enum {string} */
            to: "registration" | "running" | "completed" | "cancelled";
            /** @enum {string} */
            reason: "organizer" | "deadline" | "grand-final" | "cascade";
        };
        /** @description An organizer ruling on one slot of the tournament the audit row points at (ADR-26): the ordered promotion set before (null while the slot was still playing) and after (null on revert to the standings-based result). */
        AuditSlotRulingDetails: {
            schema_version: number;
            /** @enum {string} */
            op: "set" | "replace" | "revert";
            slot_id: components["schemas"]["Base58ID"];
            before_player_ids: components["schemas"]["Base58ID"][] | null;
            after_player_ids: components["schemas"]["Base58ID"][] | null;
        };
        /** @description Match ↔ slot linkage on the tournament the audit row points at (ADR-26): acceptance links, organizer attach/detach, cascade voids. For voids the origin carries the chain — the triggering match edit (origin_kind match-edit, origin_id = match id) or the upstream slot (origin_kind cascade, origin_id = slot id). */
        AuditSlotLinkDetails: {
            schema_version: number;
            /** @enum {string} */
            op: "attach" | "detach" | "void";
            slot_id: components["schemas"]["Base58ID"];
            match_id: components["schemas"]["Base58ID"];
            /** @enum {string} */
            origin_kind: "acceptance" | "organizer" | "match-edit" | "cascade";
            origin_id?: components["schemas"]["Base58ID"];
        };
        /** @description An organizer adjustment of one running slot of the tournament the audit row points at (ADR-26): a game reassignment (op game, game_id set) or a seat-count change (op seat-count, seat_count set). The inapplicable field stays absent. */
        AuditSlotAdjustDetails: {
            schema_version: number;
            /** @enum {string} */
            op: "game" | "seat-count";
            slot_id: components["schemas"]["Base58ID"];
            game_id?: components["schemas"]["Base58ID"];
            seat_count?: number;
        };
        IawwCell: {
            /** @description Scoring row id (e.g. "structure", "str-res"); not an entity id */
            row: string;
            coeff: number;
            count: number;
        };
        CreateTableRequest: {
            id: components["schemas"]["Base58ID"];
            game_id: components["schemas"]["Base58ID"];
            /** @description Per-browser device token; identifies the creating device as the host */
            host_client_token?: string;
            game_state: components["schemas"]["TableGameState"];
        };
        UpdateTableStateRequest: {
            /**
             * Format: int64
             * @description The version this edit is based on; a mismatch is a 409
             */
            version: number;
            game_state: components["schemas"]["TableGameState"];
        };
        SkullKingBidInput: {
            bid: number;
        };
        SkullKingResultInput: {
            actual: number;
            bonus: number;
        };
        IawwScoreInput: {
            /** @description Direct victory points; null or omitted keeps the current value (partial update) */
            directVp?: number | null;
            /** @description Partial column update: rows not carried are kept, a carried cell with count 0 clears its row, others upsert */
            cells: components["schemas"]["IawwCell"][];
            /** @description Marks the player's column finished (locks it for the player). Omitted behaves as true — legacy one-shot submits. */
            done?: boolean;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    GetPing: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description pong */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
        };
    };
    ListPlayers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Players with ranking history */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Player"][];
                    };
                };
            };
        };
    };
    CreatePlayer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    name: string;
                };
            };
        };
        responses: {
            /** @description Created player */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["PlayerRef"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Player with this name already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetPlayerStats: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Player statistics */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["PlayerStats"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Player not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeletePlayer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Player deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request (e.g. player has matches) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Player not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PatchPlayer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description Updated player */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["PlayerRef"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Player not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Name conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListGames: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of games */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["GameList"];
                    };
                };
            };
        };
    };
    CreateGame: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    name: string;
                };
            };
        };
        responses: {
            /** @description Created game */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            id: components["schemas"]["Base58ID"];
                            name: string;
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Game with this name already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetGame: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Game info */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Game"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Game not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteGame: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Game deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request (e.g. game has matches) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Game not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PatchGame: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description Updated game */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            id: components["schemas"]["Base58ID"];
                            name: string;
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Game not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    AddGameTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    tag_id: components["schemas"]["Base58ID"];
                };
            };
        };
        responses: {
            /** @description Tag attached */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request (game or tag not found) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    RemoveGameTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                tagId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tag detached */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListArenas: {
        parameters: {
            query?: {
                /** @description games returns every user-created arena except camps and the global one; camps returns only camp arenas (ADR-27); tournaments returns only the tournament arenas (empty until ADR-26). */
                kind?: "games" | "camps" | "tournaments";
                /** @description Return arenas whose filter includes this game or one of its tags; the global arena (unconditional filter) is always included. */
                game_id?: string;
                /** @description Return the tournament's arena. */
                tournament_id?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Arena list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArenaList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    CreateArena: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ArenaInput"];
            };
        };
        responses: {
            /** @description Created arena (data not yet calculated; the updater fills it) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArenaResult"];
                };
            };
            /** @description Bad request (invalid settings document or filter, or an arena with this name already exists) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetArena: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Arena details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArenaResult"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Arena not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteArena: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Arena deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Arena not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The global arena cannot be deleted; auto-managed arenas follow their entity */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    UpdateArena: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ArenaInput"];
            };
        };
        responses: {
            /** @description Updated arena */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArenaResult"];
                };
            };
            /** @description Bad request (invalid settings document, or an arena with this name already exists) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Arena not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The arena is auto-managed (per-game, per-tournament or the global one), or new camp dates do not cover already-linked matches. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetArenaPlayers: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ranked players */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArenaPlayersList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Arena not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListArenaMatches: {
        parameters: {
            query?: {
                /** @description Filter by player ID */
                player_id?: string;
                /** @description Filter by club ID */
                club_id?: string;
                /** @description Filter by game ID */
                game_id?: string;
                /** @description Cursor token from previous page's "next" field */
                next?: string;
                /** @description Number of matches per page */
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated match list (same Match shape as /matches) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchesPage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Arena not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListTags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of tags */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Tag"][];
                    };
                };
            };
        };
    };
    CreateTag: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    name: string;
                };
            };
        };
        responses: {
            /** @description Created tag */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Tag"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tag with this name already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tag deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tag not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PatchTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description Renamed tag */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Tag"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tag not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tag with this name already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListMatches: {
        parameters: {
            query?: {
                /** @description Filter by game ID */
                game_id?: string;
                /** @description Filter by player ID */
                player_id?: string;
                /** @description Filter by club ID; use "__no_club__" for players without a club */
                club_id?: string;
                /** @description Cursor token from previous page's "next" field */
                next?: string;
                /** @description Number of matches per page */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated match list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MatchesPage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    AddMatch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    game_id: components["schemas"]["Base58ID"];
                    /** @description Map of player_id (string) to numeric score */
                    score: {
                        [key: string]: number;
                    };
                    /**
                     * Format: date-time
                     * @description Optional match time for offline-created matches. Must not be in the future and not older than 30 days; Elo is recalculated from this date. When omitted the server uses the current time.
                     */
                    date?: string;
                    /** @description Optional camp arena IDs (ADR-27) this match belongs to. Each arena must exist, be a camp, and its window must contain the match date; the links become part of the camp's stats. */
                    camp_arena_ids?: components["schemas"]["Base58ID"][];
                    /** @description Explicit opt-out from tournament bracket acceptance (ADR-26). When the match exactly fits a playing slot (same game, exactly the seated players) the server links it by default — the form checkbox is default-checked. Send true to keep the match out of the bracket; fitting is always verified server-side. */
                    skip_tournament_link?: boolean;
                    /** @description Identifier of the calculator that produced this match (e.g. "skull-king", "iaww"). When set, calculator_data is required and is validated server-side against the JSON Schema registered for this kind (see pkg/calculator). When absent, the match was created via the generic form. */
                    calculator_kind?: string | null;
                    /** @description Intermediate calculator state (round-by-round / cell-by-cell breakdown). Opaque at the OpenAPI layer; validated against a per-calculator-kind JSON Schema in the Go handler. Stored in a normalized shape where every player reference lives under a key named "player_id", which the schema marks as an entity id so the Go handler canonicalizes it at the boundary. */
                    calculator_data?: Record<string, never> | null;
                };
            };
        };
        responses: {
            /** @description Match added */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            id: components["schemas"]["Base58ID"];
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description History change conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetMatchById: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Match details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Match"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Match not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    UpdateMatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    game_id: components["schemas"]["Base58ID"];
                    /** @description Map of player_id (string) to numeric score */
                    score: {
                        [key: string]: number;
                    };
                    /** Format: date-time */
                    date: string;
                    /** @description The desired camp arena set (ADR-27). The server diffs it against the stored links — attaching and detaching as needed, each change audited and both camps recalculated. Every requested arena must exist, be a camp, and its window must contain the new match date. Omit to keep the stored links untouched; a date moved outside a linked camp without detaching it is a 409. */
                    camp_arena_ids?: components["schemas"]["Base58ID"][];
                    /** @description The desired tournament-link state (ADR-26). true — the match must be out of the bracket: a stored slot link is detached (the same re-evaluation and audit as the organizer detach). false — the match must be counted: it is attached to the unique fitting playing slot (same game, exactly the seated players); when nothing fits it is a 409 — a playing slot has no recorded promotions, so attaching can never invalidate played history. Omitted — the association is left untouched. A request whose desired state already holds is a no-op. */
                    skip_tournament_link?: boolean;
                    /** @description Identifier of the calculator that produced this match (e.g. "skull-king", "iaww"). Validated server-side against the JSON Schema registered for this kind (see pkg/calculator). Set to null to clear calculator data on the match. */
                    calculator_kind?: string | null;
                    /** @description Intermediate calculator state. Opaque at the OpenAPI layer; validated against a per-calculator-kind JSON Schema in the Go handler. Required when calculator_kind is non-null. */
                    calculator_data?: Record<string, never> | null;
                };
            };
        };
        responses: {
            /** @description Match updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Match not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description History change conflict, or the new date falls outside a linked camp's window (detach the match from that camp in the same request) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetMarketsByMatchId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Markets for the match */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Market"][];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListTournaments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tournament list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TournamentList"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    CreateTournament: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TournamentInput"];
            };
        };
        responses: {
            /** @description Tournament created (or the already-created row for an id replay) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TournamentResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament name already taken */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetTournament: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tournament */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TournamentResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    UpdateTournament: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TournamentInput"];
            };
        };
        responses: {
            /** @description Updated tournament */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TournamentResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No longer in registration (or name taken) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    RegisterInTournament: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Registered */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No player linked to the user */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Registration is closed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    UnregisterFromTournament: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Withdrawn */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No player linked to the user */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Registration is closed */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListTournamentBracketPlans: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Valid plans */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BracketPlansResponse"];
                };
            };
            /** @description Fewer than 2 participants, or empty game pool */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No longer in registration */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    StartTournament: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    plan: components["schemas"]["TournamentPlan"];
                };
            };
        };
        responses: {
            /** @description Tournament started */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Plan invalid or not offered; deadline in the past; too few participants; empty pool */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Already started */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    CancelTournament: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tournament cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Cancel not available from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetTournamentBracket: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The bracket */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BracketResponse"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    AdjustTournamentSlot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    game_id?: components["schemas"]["Base58ID"];
                    seat_count?: number;
                };
            };
        };
        responses: {
            /** @description Adjusted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Invalid adjustment (violated constraints, size not fitting the pool) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament or slot not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    AttachTournamentSlotMatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    match_id: components["schemas"]["Base58ID"];
                };
            };
        };
        responses: {
            /** @description Attached */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description The match does not fit the slot */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament or slot not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Match already linked, or the slot is not accepting matches */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DetachTournamentSlotMatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                sid: string;
                mid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Detached */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament, slot or link not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    SetTournamentSlotRuling: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Ordered — place 1 first */
                    player_ids: components["schemas"]["Base58ID"][];
                };
            };
        };
        responses: {
            /** @description Ruling recorded */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Not exactly promote seated players */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Editor permission required */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Tournament or slot not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The slot is not accepting a ruling (waiting) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListClubs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of clubs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Club"][];
                    };
                };
            };
        };
    };
    CreateClub: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    name: string;
                };
            };
        };
        responses: {
            /** @description Created club */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Club"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Club with this name already exists */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetClub: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Club details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Club"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Club not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteClub: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Club deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Club not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PatchClub: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    icon?: string;
                };
            };
        };
        responses: {
            /** @description Updated club */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Club"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Club not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    AddClubMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    player_id: components["schemas"]["Base58ID"];
                };
            };
        };
        responses: {
            /** @description Member added */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    RemoveClubMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                playerId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Member removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["Settings"];
                    };
                };
            };
        };
    };
    CreateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: date-time
                     * @description Must be in the future
                     */
                    effective_date: string;
                    /** Format: double */
                    elo_const_k: number;
                    /** Format: double */
                    elo_const_d: number;
                    /** Format: double */
                    starting_elo: number;
                    /** Format: double */
                    win_reward: number;
                };
            };
        };
        responses: {
            /** @description Settings created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: date-time */
                    effective_date: string;
                };
            };
        };
        responses: {
            /** @description Settings deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListAllSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description All settings entries */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["EloSettingEntry"][];
                    };
                };
            };
        };
    };
    ListUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of users */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["User"][];
                    };
                };
            };
        };
    };
    PatchUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    can_edit: boolean;
                };
            };
        };
        responses: {
            /** @description Updated user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["User"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description User not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListMarkets: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Markets grouped into active and closed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            active: components["schemas"]["Market"][];
                            closed: components["schemas"]["Market"][];
                        };
                    };
                };
            };
        };
    };
    CreateMarket: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    /** @enum {string} */
                    market_type: "match_winner" | "win_streak";
                    /**
                     * Format: date-time
                     * @description Defaults to now if omitted; must not be in the past if provided
                     */
                    starts_at?: string;
                    /** Format: date-time */
                    closes_at: string;
                    /** @description Target players — one "player wins" outcome is created per player. */
                    target_player_ids?: components["schemas"]["Base58ID"][];
                    /** @description When true, a match may include players outside the targets (all targets must still participate). When false, the market targets a match with exactly these players. A match resolving in a tie (or a non-target sole winner) resolves the "other" outcome. */
                    allow_other_players?: boolean;
                    /** @description Games the match must belong to; empty means any game. */
                    game_ids?: components["schemas"]["Base58ID"][];
                    target_player_id?: components["schemas"]["Base58ID"];
                    /** @description Games the matches must belong to; empty means any game. */
                    streak_game_ids?: components["schemas"]["Base58ID"][];
                    wins_required?: number;
                    max_losses?: number | null;
                    /**
                     * Format: double
                     * @description Maximum combined guarantor risk L the market accepts: liquidity is b = min(L, Σrisk)/ln(n), so a guarantor's maximum loss is the amount they risked. Wagers beyond L are accepted in full (they still earn fees) but add no liquidity. Defaults to the settings' market_default_max_guarantor_loss when omitted.
                     */
                    max_guarantor_loss?: number;
                };
            };
        };
        responses: {
            /** @description Market created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            id: components["schemas"]["Base58ID"];
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetMarket: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Market detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["MarketDetail"];
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteMarket: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Market deleted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not open */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PatchMarket: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    status: "betting_closed";
                };
            };
        };
        responses: {
            /** @description Market updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not open */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PlaceBet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    /** @description Outcome identifier (GUID) the bet is placed on — one of the market's outcomes. Typed as Base58ID so it carries the same short form clients see in the market's outcome ids. */
                    outcome_id: components["schemas"]["Base58ID"];
                    /**
                     * Format: double
                     * @description Number of shares to buy (the UI always buys 1; each winning share pays 1). The AMM prices the elo cost, which is reserved against the bet limit.
                     */
                    shares: number;
                    /**
                     * Format: double
                     * @description The outcome probability the buyer saw and agrees to buy around, in the closed interval [0, 1] — in a one-sided market the live probability saturates to exactly 0 or 1 in float64, and the client sends back what it displays. The server rejects the bet (409) if the live probability has moved away from it beyond a small tolerance.
                     */
                    expected_probability: number;
                };
            };
        };
        responses: {
            /** @description Shares bought */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            /**
                             * Format: double
                             * @description Shares received (each pays 1 if the outcome wins).
                             */
                            shares: number;
                            /**
                             * Format: double
                             * @description Effective elo cost paid per share ((cost + fee) / shares).
                             */
                            cost_per_share: number;
                            /**
                             * Format: double
                             * @description Maker fee part of the payment (ADR-20): the market's guarantors earn it at resolution, weighted fee·risk.
                             */
                            fee: number;
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden (no linked player) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not open for buying, or the live probability moved away from expected_probability */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Spend limit exceeded */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    CreateMarketGuarantee: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    /**
                     * Format: double
                     * @description The maximum the guarantor can lose; reserved against the betting limit.
                     */
                    risk_amount: number;
                    /**
                     * Format: double
                     * @description The wager's maker fee rate, 0–25%: raises the market's weighted fee and both the guarantor's share of collected fees and their position in the first-loss waterfall.
                     */
                    fee_rate: number;
                };
            };
        };
        responses: {
            /** @description Guarantee placed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            /** Format: double */
                            risk_amount: number;
                            /** Format: double */
                            fee_rate: number;
                            /**
                             * Format: double
                             * @description The market's liquidity after the wager.
                             */
                            liquidity_b: number;
                            /**
                             * Format: double
                             * @description Combined risk of all guarantor wagers after this one.
                             */
                            total_risk: number;
                            /** Format: double */
                            max_guarantor_loss: number;
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden (no linked player) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not open */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Invalid wager or bet limit exceeded */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetMarketProbabilityHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Probability points ordered by time */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: {
                            points: {
                                /**
                                 * Format: date-time
                                 * @description When the event (bet or guarantee join) happened.
                                 */
                                t: string;
                                /** @description Probability of every outcome right after the event; probabilities sum to 1. */
                                probabilities: {
                                    outcome_id: components["schemas"]["Base58ID"];
                                    /**
                                     * Format: double
                                     * @description Probability (LMSR marginal price) in (0,1).
                                     */
                                    probability: number;
                                }[];
                            }[];
                        };
                    };
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Market not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    AuthLogin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redirect to Google OAuth */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    AuthOAuth2Callback: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Login successful */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                    };
                };
            };
        };
    };
    AuthLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Logged out */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
        };
    };
    GetMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["User"];
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    PatchMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    player_id?: components["schemas"]["Base58ID"] | null;
                };
            };
        };
        responses: {
            /** @description Updated */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Player already linked to another user */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListCorrections: {
        parameters: {
            query?: {
                /** @description Filter by player ID */
                player_id?: string;
                /** @description Filter by club ID; use "__no_club__" for players without a club */
                club_id?: string;
                /** @description Cursor token from previous page's "next" field */
                next?: string;
                /** @description Number of corrections per page */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated correction list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CorrectionsPage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListAuditEvents: {
        parameters: {
            query?: {
                /** @description Filter by entity type(s); repeated for several types */
                entity_type?: ("match" | "game" | "player" | "club" | "tag" | "arena" | "tournament")[];
                /** @description Filter by entity ID (requires entity_type) */
                entity_id?: string;
                /** @description Cursor token from previous page's "next" field */
                next?: string;
                /** @description Number of events per page */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Paginated audit event list */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditPage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    UpdateArenas: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Update complete, with the per-arena before/after diff */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateArenasResult"];
                };
            };
            /** @description History change conflict during the global replay */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    CreatePlayerCorrection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    id: components["schemas"]["Base58ID"];
                    /** @enum {string} */
                    discriminator: "correction";
                    diff: number;
                };
            };
        };
        responses: {
            /** @description Correction applied */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccessMessage"];
                };
            };
            /** @description Bad request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Internal server error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    ListTables: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description List of tables */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"][];
                    };
                };
            };
        };
    };
    CreateTable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTableRequest"];
            };
        };
        responses: {
            /** @description Table created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
            /** @description Bad request (invalid state or unknown game) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    GetTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Table details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
            /** @description Table not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    DeleteTable: {
        parameters: {
            query?: {
                /** @description When provided, the server broadcasts a `saved` SSE event carrying this match id to the table's subscribers before deleting the table, so connected players can be redirected to the saved match. Omitted by the host when closing the table without saving (a `closed` event instead). */
                match_id?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Table deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden (not host) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Table not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    UpdateTableState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTableStateRequest"];
            };
        };
        responses: {
            /** @description Updated table */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
            /** @description Invalid game state */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden (not host) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Table not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Version conflict — the state changed after the caller last saw it (player submission or the host's other device). The current table is returned in `data` so the caller can merge its edit and retry. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        message: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
        };
    };
    JoinTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Joined table */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Table not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    SubmitTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkullKingBidInput"] | components["schemas"]["SkullKingResultInput"] | components["schemas"]["IawwScoreInput"];
            };
        };
        responses: {
            /** @description Submission applied */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
            /** @description Invalid input (validation failed) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Table not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Wrong phase, player not in game, or already submitted */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    TakeoverTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    /** @description Per-device token stored with the hosting claim */
                    host_client_token?: string;
                };
            };
        };
        responses: {
            /** @description Updated table (the caller's device now hosts) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: string;
                        data: components["schemas"]["TableSummary"];
                    };
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Forbidden (not the current host and no edit permission) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Table not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
}
