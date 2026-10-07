// Shared response types: the narrow re-exports of the generated schema types
// every consumer imports through the app/api barrel, plus the frontend-shaped
// Match (camelCase scores, Date objects) and its mapper.
import type { components } from "../api-types.gen";
import type { Base58ID } from "@/lib/id";

export type EloRank = components["schemas"]["EloRank"];
export type Player = components["schemas"]["Player"];
export type RecentPlayer = components["schemas"]["RecentPlayer"];
export type User = components["schemas"]["User"];
export type Club = components["schemas"]["Club"];
export type Tenant = components["schemas"]["Tenant"];
export type GameList = components["schemas"]["GameList"];
export type GameListItem = components["schemas"]["GameListItem"];
export type FavoriteGames = components["schemas"]["FavoriteGames"];
export type RecentGame = components["schemas"]["RecentGame"];
export type PopularGame = components["schemas"]["PopularGame"];
export type GameTag = components["schemas"]["GameTag"];
export type Tag = components["schemas"]["Tag"];
export type Game = components["schemas"]["Game"];
export type GameSuggestion = components["schemas"]["GameSuggestion"];
export type GameAutoMatchResult = components["schemas"]["GameAutoMatchResult"];
export type GameEnrichResult = components["schemas"]["GameEnrichResult"];
export type EloSettingEntry = components["schemas"]["EloSettingEntry"];
export type Market = components["schemas"]["Market"];
export type MarketDetail = components["schemas"]["MarketDetail"];
export type MarketOutcome = components["schemas"]["MarketOutcome"];
export type MatchWinnerParams = components["schemas"]["MatchWinnerParams"];
export type WinStreakParams = components["schemas"]["WinStreakParams"];
export type TournamentWinnerParams = components["schemas"]["TournamentWinnerParams"];
export type SettlementDetail = components["schemas"]["SettlementDetail"];
export type MarketGuarantee = components["schemas"]["MarketGuarantee"];
export type PlayerStateChange = components["schemas"]["PlayerStateChange"];
export type GlobalReplayReport = components["schemas"]["GlobalReplayReport"];
export type ArenaUpdateReport = components["schemas"]["ArenaUpdateReport"];
export type UpdateArenasResult = components["schemas"]["UpdateArenasResult"];
export type MatchFilter = components["schemas"]["MatchFilter"];
export type ArenaSettings = components["schemas"]["ArenaSettings"];
export type Arena = components["schemas"]["Arena"];
export type ArenaPlayer = components["schemas"]["ArenaPlayer"];
export type TableSummary = components["schemas"]["TableSummary"];
export type TableGameState = components["schemas"]["TableGameState"];
export type TablePlayer = components["schemas"]["TablePlayer"];
export type SkullKingGameState = components["schemas"]["SkullKingGameState"];
export type SkullKingRoundEntry = components["schemas"]["SkullKingRoundEntry"];
export type SkullKingGamePhase = components["schemas"]["SkullKingGameState"]["phase"];
export type IawwGameState = components["schemas"]["IawwGameState"];
export type IawwEntry = components["schemas"]["IawwEntry"];
export type IawwCell = components["schemas"]["IawwCell"];
export type IawwScoreInput = components["schemas"]["IawwScoreInput"];
export type TableSubmitInput =
    | components["schemas"]["SkullKingBidInput"]
    | components["schemas"]["SkullKingResultInput"]
    | components["schemas"]["IawwScoreInput"];
export type PlayerStats = components["schemas"]["PlayerStats"];
export type GameEloStat = components["schemas"]["GameEloStat"];
export type GameMatchStat = components["schemas"]["GameMatchStat"];
export type Tournament = components["schemas"]["Tournament"];
export type TournamentInput = components["schemas"]["TournamentInput"];
export type TournamentGame = components["schemas"]["TournamentGame"];
export type TournamentPlan = components["schemas"]["TournamentPlan"];
export type BracketPlanFacets = components["schemas"]["BracketPlanFacets"];
export type PlanRound = components["schemas"]["PlanRound"];
export type Bracket = components["schemas"]["Bracket"];
export type BracketRound = components["schemas"]["BracketRound"];
export type BracketSlot = components["schemas"]["BracketSlot"];
export type BracketSeat = components["schemas"]["BracketSeat"];

// ─── Frontend-specific types (differ from raw API response) ───────────────────

export type Period = keyof Player["rank"];

// score fields are camelCased; date is a Date object
export type PlayerScore = {
    ratingStaked: number;
    ratingEarned: number;
    score: number;
    ratingAfter?: number | null;
};

export type MatchCamp = components["schemas"]["MatchCamp"];
export type MatchTournament = components["schemas"]["MatchTournament"];

export type Match = {
    id: Base58ID;
    game_id: Base58ID;
    game_name: string;
    date: Date | null;
    /**
     * Raw server date string (RFC3339 with microsecond precision). JS Date
     * only holds milliseconds, so edit forms must resubmit this verbatim when
     * the date is untouched — a Date round-trip silently truncates the
     * stored instant and the audit log reports a change nobody made.
     */
    dateISO: string | null;
    score: Record<string, PlayerScore>;
    has_markets: boolean;
    /**
     * The match's mode (ADR-33): competitive matches carry per-player scores
     * feeding arenas/markets; coop matches carry the shared game result below
     * and never affect ratings or stats.
     */
    mode: "competitive" | "coop";
    /** The shared game result of a coop match; null for competitive ones. */
    game_score: number | null;
    game_won: boolean | null;
    /** Camp arenas (ADR-27) the match belongs to — frozen at creation. */
    camps: MatchCamp[];
    /** The bracket slot the match counts for (ADR-26); null when unlinked. */
    tournament?: MatchTournament | null;
    /** Set when the match was created via a calculator; selects the calculator UI in history mode. */
    calculator_kind?: string | null;
    /** Intermediate calculator state (opaque to the API layer). */
    calculator_data?: Record<string, unknown> | null;
};

export type Status = {
    status: "success" | "fail";
    error?: string;
};

export type MatchesPage = {
    items: Match[];
    next: string | null;
};

export type RatingPoint = { date: string; rating: number };

// date is a Date object
export type Correction = {
    id: Base58ID;
    player_id: Base58ID;
    player_name: string;
    diff: number;
    date: Date | null;
};

/**
 * One feed event (ADR-32). The wire shape is a discriminated union on `type`;
 * new content kinds (cooperative matches, posts) extend it server-side — the
 * envelope never changes. Match data is mapped through mapMatch (Date objects,
 * camelCase scores); corrections get Date dates; markets pass through.
 */
export type FeedEvent =
    | { type: "match"; data: Match }
    | { type: "correction"; data: Correction }
    | { type: "market"; data: Market };

export type FeedPage = {
    items: FeedEvent[];
    next: string | null;
};

export function mapMatch(m: components["schemas"]["Match"]): Match {
    return {
        id: m.id,
        game_id: m.game_id,
        game_name: m.game_name,
        score: Object.fromEntries(
            Object.entries(m.score).map(([pid, s]) => [
                pid,
                { ratingStaked: s.rating_staked, ratingEarned: s.rating_earned, score: s.score, ratingAfter: s.rating_after },
            ])
        ),
        date: m.date ? new Date(m.date) : null,
        dateISO: m.date ?? null,
        has_markets: m.has_markets,
        mode: m.mode,
        game_score: m.game_score ?? null,
        game_won: m.game_won ?? null,
        camps: m.camps ?? [],
        tournament: m.tournament ?? null,
        // idcodec middleware already rewrote player ids inside calculator_data to
        // short form on the way out, so no client-side transformation is needed.
        calculator_kind: m.calculator_kind ?? null,
        calculator_data: (m.calculator_data as Record<string, unknown> | null) ?? null,
    };
}
