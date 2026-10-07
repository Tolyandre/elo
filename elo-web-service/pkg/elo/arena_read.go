package elo

import (
	"context"
	"fmt"
	"math"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

func (s *ArenaService) ListArenas(ctx context.Context) ([]ArenaWithCount, error) {
	return s.listArenas(ctx, nil)
}

func (s *ArenaService) ListArenasByKind(ctx context.Context, kind string) ([]ArenaWithCount, error) {
	return s.listArenas(ctx, &kind)
}

func (s *ArenaService) listArenas(ctx context.Context, kind *string) ([]ArenaWithCount, error) {
	rows, err := s.Queries.ListArenas(ctx, ptrText(kind))
	if err != nil {
		return nil, fmt.Errorf("list arenas: %w", err)
	}
	out := make([]ArenaWithCount, 0, len(rows))
	for _, r := range rows {
		a, err := arenaFromListRow(r)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *ArenaService) GetArena(ctx context.Context, arenaID id.ID) (Arena, error) {
	r, err := s.Queries.GetArena(ctx, arenaID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena %s: %w", arenaID, err)
	}
	return arenaFromGetArenaRow(r)
}

func (s *ArenaService) ListArenasForGame(ctx context.Context, gameID id.ID) ([]Arena, error) {
	rows, err := s.Queries.ListArenasForGame(ctx, &gameID)
	if err != nil {
		return nil, fmt.Errorf("list arenas for game %s: %w", gameID, err)
	}
	out := make([]Arena, 0, len(rows))
	for _, r := range rows {
		a, err := arenaFromListArenasForGameRow(r)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}

func (s *ArenaService) GetArenaByGame(ctx context.Context, gameID id.ID) (Arena, error) {
	r, err := s.Queries.GetArenaByGame(ctx, &gameID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena for game %s: %w", gameID, err)
	}
	return arenaFromGetArenaByGameRow(r)
}

func (s *ArenaService) GetArenaByTournament(ctx context.Context, tournamentID id.ID) (Arena, error) {
	r, err := s.Queries.GetArenaByTournament(ctx, &tournamentID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena for tournament %s: %w", tournamentID, err)
	}
	return arenaFromGetArenaByTournamentRow(r)
}

func (s *ArenaService) GetArenaByTenant(ctx context.Context, tenantID id.ID) (Arena, error) {
	r, err := s.Queries.GetArenaByTenant(ctx, &tenantID)
	if err != nil {
		return Arena{}, fmt.Errorf("get arena for tenant %s: %w", tenantID, err)
	}
	return arenaFromGetArenaByTenantRow(r)
}

// arenaFromGetArenaByTenantRow converts GetArenaByTenantRow — the same 16-column
// projection as GetArena, so the row struct is field-identical by
// construction (arena_rows_test.go keeps the shared list).
func arenaFromGetArenaByTenantRow(r db.GetArenaByTenantRow) (Arena, error) {
	return arenaFromParts(r.ID, r.Name, r.Settings, r.SettingsSchemaVersion,
		r.GameID, r.TournamentID, r.TenantID, r.Camp, r.StartsAt, r.EndsAt, r.RecalcFrom, r.StaleAt,
		r.DateFrom, r.DateTo, r.FilterGameIds, r.FilterTagIds)
}

// GetArenaPlayers returns the arena's current players ranked, with the
// precalculated medal stats. Leagues sort elite → amateur → newbie (the
// settings list is promotion order, ranking inverts it), rating descending
// within a league, ties sharing a rank. When the arena has no leagues
// everyone sits in one list ordered by rating.
func (s *ArenaService) GetArenaPlayers(ctx context.Context, arenaID id.ID) ([]ArenaPlayer, error) {
	arena, err := s.GetArena(ctx, arenaID)
	if err != nil {
		return nil, err
	}
	eloSettings, err := s.eloSettingsAt(ctx, time.Now())
	if err != nil {
		return nil, err
	}

	rows, err := s.Queries.ListArenaPlayers(ctx, arenaID)
	if err != nil {
		return nil, fmt.Errorf("list arena players: %w", err)
	}

	players := make([]ArenaPlayer, 0, len(rows))
	for _, r := range rows {
		league := textPtr(r.League)
		p := ArenaPlayer{
			ID: r.PlayerID, Name: r.PlayerName,
			Rating: float64Or(r.RatingAfter, arena.Settings.StartingRating), League: league,
			MatchesCount: int(r.MatchesCount),
			FirstCount:   int(r.FirstCount), SecondCount: int(r.SecondCount),
			ThirdCount: int(r.ThirdCount), FourthCount: int(r.FourthCount),
		}
		applyArenaPlayerHints(&p, float64Or(r.EloAfter, eloSettings.StartingElo), int(r.Cnt60), int(r.Cnt180), arena, eloSettings)
		players = append(players, p)
	}

	sortAndRankArenaPlayers(players, arena)
	return players, nil
}

// GetArenaPlayersAt returns the arena's point-in-time standings (read-time
// computation over the settlement ledger) — the basis of the rank-change
// history. Medal stats are not computed here.
func (s *ArenaService) GetArenaPlayersAt(ctx context.Context, arenaID id.ID, at time.Time) ([]ArenaPlayer, error) {
	arena, err := s.GetArena(ctx, arenaID)
	if err != nil {
		return nil, err
	}
	eloSettings, err := s.eloSettingsAt(ctx, at)
	if err != nil {
		return nil, err
	}

	rows, err := s.Queries.ListArenaPlayersAt(ctx, db.ListArenaPlayersAtParams{
		ArenaID: arenaID,
		Date:    pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("list arena players at %v: %w", at, err)
	}

	players := make([]ArenaPlayer, 0, len(rows))
	for _, r := range rows {
		league := textPtr(r.League)
		p := ArenaPlayer{
			ID: r.PlayerID, Name: r.PlayerName,
			Rating: float64Or(r.RatingAfter, arena.Settings.StartingRating), League: league,
		}
		applyArenaPlayerHints(&p, float64Or(r.EloAfter, eloSettings.StartingElo), int(r.Cnt60), int(r.Cnt180), arena, eloSettings)
		players = append(players, p)
	}

	sortAndRankArenaPlayers(players, arena)
	return players, nil
}

// float64Or asserts a nullable-column value, falling back to def when the row
// (or the LATERAL join) produced NULL.
func float64Or(v any, def float64) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return def
}

func (s *ArenaService) eloSettingsAt(ctx context.Context, at time.Time) (EloSettings, error) {
	row, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: at, Valid: true})
	if err != nil {
		return EloSettings{}, fmt.Errorf("get elo settings: %w", err)
	}
	return EloSettingsFromDB(row), nil
}

// applyArenaPlayerHints fills the informational newbie/elite promotion
// counters when the player is in the matching league.
func applyArenaPlayerHints(p *ArenaPlayer, eloAfter float64, cnt60, cnt180 int, arena Arena, s EloSettings) {
	if p.League == nil {
		return
	}
	if *p.League == LeagueNewbie {
		if gap := eloAfter - p.Rating; gap > 0 {
			if nl, ok := arena.Settings.Newbie(); ok {
				p.WinsNeededForAmateurLower, p.WinsNeededForAmateurUpper = calcWinsNeededForAmateur(gap, nl, s)
			}
		}
	}
	if *p.League == LeagueAmateur {
		if el, ok := arena.Settings.Elite(); ok {
			deficit := max(el.Matches6M-cnt180, el.Matches2M-cnt60)
			if deficit > 0 {
				p.MatchesLeftForElite = deficit
			}
		}
	}
}

func sortAndRankArenaPlayers(players []ArenaPlayer, arena Arena) {
	slices.SortFunc(players, func(a, b ArenaPlayer) int {
		pa, pb := arenaLeaguePriority(a.League, arena), arenaLeaguePriority(b.League, arena)
		if pa != pb {
			return pa - pb
		}
		if b.Rating-a.Rating > 0 {
			return 1
		}
		if b.Rating-a.Rating < 0 {
			return -1
		}
		return 0
	})

	rank := 0
	var prevRound float64 = math.NaN()
	var prevRank *int
	var prevLeague *string
	for i := range players {
		rounded := math.Round(players[i].Rating)
		if !math.IsNaN(prevRound) && rounded == prevRound && leaguePtrEqual(players[i].League, prevLeague) {
			players[i].Rank = prevRank
		} else {
			r := rank + 1
			players[i].Rank = &r
			prevRank = players[i].Rank
			prevRound = rounded
			prevLeague = players[i].League
		}
		rank++
	}
}

func leaguePtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func (s *ArenaService) ListArenaFeedEvents(ctx context.Context, arg db.ListArenaFeedEventsParams) ([]db.ListArenaFeedEventsRow, error) {
	return s.Queries.ListArenaFeedEvents(ctx, arg)
}

func (s *ArenaService) ListFeedMatchesWithPlayers(ctx context.Context, arg db.ListFeedMatchesWithPlayersParams) ([]db.ListFeedMatchesWithPlayersRow, error) {
	return s.Queries.ListFeedMatchesWithPlayers(ctx, arg)
}
