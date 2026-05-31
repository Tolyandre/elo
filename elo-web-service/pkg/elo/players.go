package elo

import (
	"context"
	"fmt"
	"math"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

type Player struct {
	ID                        string
	Name                      string
	Elo                       float64
	League                    string
	Rank                      *int
	MatchesLeftForElite       int // > 0 only for amateur players
	WinsNeededForAmateurLower int // lower bound: elo fixed, only rating grows
	WinsNeededForAmateurUpper int // upper bound: elo also grows ≈ K/2 per win
}
type IPlayerService interface {
	GetPlayersWithRank(ctx context.Context, when *time.Time) ([]Player, error)
	CreatePlayer(ctx context.Context, name string) (db.Player, error)
	UpdatePlayer(ctx context.Context, id int32, name string) (db.Player, error)
	DeletePlayer(ctx context.Context, id int32) error
	GetPlayer(ctx context.Context, id int32) (db.Player, error)
	ListPlayers(ctx context.Context) ([]db.Player, error)
	ListPlayerUserLinks(ctx context.Context) ([]db.ListPlayerUserLinksRow, error)
	RatingHistory(ctx context.Context, playerID int32) ([]db.RatingHistoryRow, error)
	GetPlayerGameStats(ctx context.Context, playerID int32) ([]db.GetPlayerGameStatsRow, error)
	GetPlayerGameEloStats(ctx context.Context, playerID int32) ([]db.GetPlayerGameEloStatsRow, error)
}

type PlayerService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

func NewPlayerService(pool *pgxpool.Pool) IPlayerService {
	return &PlayerService{
		Queries: db.New(pool),
		Pool:    pool,
	}
}

// calcWinsNeededForAmateur estimates the range [lower, upper] of wins needed to close
// the directed gap (elo − rating) to NewbieLeagueGoalGap, assuming the player wins every match.
//
// Lower bound: elo stays fixed (only rating grows).
//   n_lower = ∫ dg / Δ_win(g),  Δ_win(g) = earnedMax(g) − K·E(g)
//
// Upper bound: elo also grows ≈ K/2 per win (2-player equal-elo approximation, conservative).
//   n_upper = ∫ dg / (Δ_win(g) − K/2)
//
// E(g) = 1/(1+10^(g/D)): 2-player win expectation at rating gap g.
func calcWinsNeededForAmateur(gap float64, s EloSettings) (lower, upper int) {
	goalGap := s.NewbieLeagueGoalGap
	if gap <= goalGap || s.D == 0 {
		return 0, 0
	}
	const step = 1.0
	deltaEloPerWin := s.K / 2
	var totalLower, totalUpper float64
	for g := goalGap; g < gap; g += step {
		delta := math.Min(step, gap-g)
		mid := g + delta/2
		earnedMax := s.K + (s.NewbieLeagueEarnedMax-s.K)*(1-math.Exp(-mid/s.NewbieLeagueEarnedTau))
		eWin := 1.0 / (1.0 + math.Pow(10, mid/s.D))
		netRating := earnedMax - s.K*eWin
		if netRating > 0 {
			totalLower += delta / netRating
		}
		netGap := netRating - deltaEloPerWin
		if netGap > 0 {
			totalUpper += delta / netGap
		}
	}
	return int(math.Ceil(totalLower)), int(math.Ceil(totalUpper))
}

// leaguePriority returns sort order: elite < amateur < newbie (lower = ranked higher).
func leaguePriority(league string) int {
	switch league {
	case "elite":
		return 0
	case "amateur":
		return 1
	default: // newbie
		return 2
	}
}

// GetPlayersWithRank returns players with their Elo and rank as of `when` (or now if nil).
func (s *PlayerService) GetPlayersWithRank(ctx context.Context, when *time.Time) ([]Player, error) {
	ref := time.Now()
	if when != nil {
		ref = *when
	}

	dt := pgtype.Timestamptz{Time: ref, Valid: true}

	settingsRow, err := s.Queries.GetEloSettingsForDate(ctx, pgtype.Timestamptz{Time: ref, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("unable to get elo settings: %v", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	rows, err := s.Queries.ListPlayersWithStats(ctx, dt)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve players from db: %v", err)
	}

	players := make([]Player, 0, len(rows))
	for _, r := range rows {
		ratingVal := settings.StartingRatingGlobal
		if r.Rating != nil {
			ratingVal = r.Rating.(float64)
		}
		eloVal := settings.StartingElo
		if r.Elo != nil {
			eloVal = r.Elo.(float64)
		}

		// Determine effective league: for players with no settlement, derive from starting values;
		// for existing players, correct stale elite based on current match counts.
		var league string
		if r.Rating == nil {
			league = initialLeagueForStarting(settings.StartingRatingGlobal, settings.StartingElo, settings)
		} else {
			league = effectiveLeague(r.League, int(r.Cnt60), int(r.Cnt180), settings)
		}

		matchesLeftForElite := 0
		if league == "amateur" {
			deficit6M := settings.EliteMatches6M - int(r.Cnt180)
			deficit2M := settings.EliteMatches2M - int(r.Cnt60)
			deficit := max(deficit6M, deficit2M)
			if deficit > 0 {
				matchesLeftForElite = deficit
			}
		}

		var winsLower, winsUpper int
		if league == "newbie" {
			gap := eloVal - ratingVal // directed: only positive when elo > rating
			winsLower, winsUpper = calcWinsNeededForAmateur(gap, settings)
		}

		players = append(players, Player{
			ID:                        fmt.Sprintf("%d", r.ID),
			Elo:                       ratingVal, // displayed rating used for ranking
			League:                    league,
			Name:                      r.Name,
			MatchesLeftForElite:       matchesLeftForElite,
			WinsNeededForAmateurLower: winsLower,
			WinsNeededForAmateurUpper: winsUpper,
		})
	}

	// Sort: elite first, then amateur, then newbie; within each league by rating descending.
	slices.SortFunc(players, func(a, b Player) int {
		pa, pb := leaguePriority(a.League), leaguePriority(b.League)
		if pa != pb {
			return pa - pb
		}
		if b.Elo-a.Elo > 0 {
			return 1
		}
		if b.Elo-a.Elo < 0 {
			return -1
		}
		return 0
	})

	// Assign continuous ranks to all players.
	rank := 0
	var prevRoundElo float64 = math.NaN()
	var prevRank *int
	var prevLeague string
	for i := range players {
		rounded := math.Round(players[i].Elo)
		// Ties share rank only within the same league.
		if !math.IsNaN(prevRoundElo) && rounded == prevRoundElo && players[i].League == prevLeague {
			players[i].Rank = prevRank
		} else {
			r := rank + 1
			players[i].Rank = &r
			prevRank = players[i].Rank
			prevRoundElo = rounded
			prevLeague = players[i].League
		}
		rank++
	}

	return players, nil
}

func (s *PlayerService) CreatePlayer(ctx context.Context, name string) (db.Player, error) {
	return s.Queries.CreatePlayer(ctx, db.CreatePlayerParams{
		Name:          name,
		GeologistName: pgtype.Text{Valid: false},
	})
}

func (s *PlayerService) UpdatePlayer(ctx context.Context, id int32, name string) (db.Player, error) {
	return s.Queries.UpdatePlayer(ctx, db.UpdatePlayerParams{ID: id, Name: name})
}

func (s *PlayerService) DeletePlayer(ctx context.Context, id int32) error {
	return s.Queries.DeletePlayer(ctx, id)
}

func (s *PlayerService) GetPlayer(ctx context.Context, id int32) (db.Player, error) {
	return s.Queries.GetPlayer(ctx, id)
}

func (s *PlayerService) ListPlayers(ctx context.Context) ([]db.Player, error) {
	return s.Queries.ListPlayers(ctx)
}

func (s *PlayerService) ListPlayerUserLinks(ctx context.Context) ([]db.ListPlayerUserLinksRow, error) {
	return s.Queries.ListPlayerUserLinks(ctx)
}

func (s *PlayerService) RatingHistory(ctx context.Context, playerID int32) ([]db.RatingHistoryRow, error) {
	return s.Queries.RatingHistory(ctx, playerID)
}

func (s *PlayerService) GetPlayerGameStats(ctx context.Context, playerID int32) ([]db.GetPlayerGameStatsRow, error) {
	return s.Queries.GetPlayerGameStats(ctx, playerID)
}

func (s *PlayerService) GetPlayerGameEloStats(ctx context.Context, playerID int32) ([]db.GetPlayerGameEloStatsRow, error) {
	return s.Queries.GetPlayerGameEloStats(ctx, playerID)
}
