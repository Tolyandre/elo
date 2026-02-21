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
	ID                   string
	Name                 string
	Elo                  float64
	Rank                 *int
	MatchesLeftForRanked int
}
type IPlayerService interface {
	GetPlayersWithRank(ctx context.Context, when *time.Time) ([]Player, error)
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

// GetPlayersWithRank returns players with their Elo and rank as of `when` (or now if nil).
func (s *PlayerService) GetPlayersWithRank(ctx context.Context, when *time.Time) ([]Player, error) {
	ref := time.Now()
	if when != nil {
		ref = *when
	}

	dt := pgtype.Timestamptz{Time: ref, Valid: true}
	rows, err := s.Queries.ListPlayersWithStats(ctx, dt)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve players from db: %v", err)
	}

	// Map required windows to counts returned by query
	players := make([]Player, 0, len(rows))
	for _, r := range rows {
		eloVal := float64(StartingElo)
		if r.Rating != nil {
			eloVal = r.Rating.(float64)
		}

		players = append(players, Player{
			ID:   fmt.Sprintf("%d", r.ID),
			Elo:  eloVal,
			Name: r.Name,
		})
	}

	// Create maps from player id to counts from the generated rows
	cnt30 := map[string]int{}
	cnt90 := map[string]int{}
	cnt180 := map[string]int{}
	for _, r := range rows {
		idStr := fmt.Sprintf("%d", r.ID)
		cnt30[idStr] = int(r.Cnt30)
		cnt90[idStr] = int(r.Cnt90)
		cnt180[idStr] = int(r.Cnt180)
	}

	// Fill MatchesLeftForRanked using requirements
	maxRequired := 0
	for _, req := range requiredMatchCountForRanked {
		if req > maxRequired {
			maxRequired = req
		}
	}

	for pi := range players {
		id := players[pi].ID
		// default
		players[pi].MatchesLeftForRanked = maxRequired
		players[pi].Rank = nil

		// lookup counts
		c30 := cnt30[id]
		c90 := cnt90[id]
		c180 := cnt180[id]

		maxDeficit := 0
		for dur, req := range requiredMatchCountForRanked {
			var have int
			switch dur {
			case lastMonth:
				have = c30
			case last3Month:
				have = c90
			case last6Month:
				have = c180
			default:
				have = 0
			}
			deficit := req - have
			if deficit > maxDeficit {
				maxDeficit = deficit
			}
		}
		if maxDeficit < 0 {
			maxDeficit = 0
		}
		players[pi].MatchesLeftForRanked = maxDeficit
	}

	// Sort players by Elo descending and compute ranks only for eligible players
	slices.SortFunc(players, func(a, b Player) int {
		if b.Elo-a.Elo > 0 {
			return 1
		}
		if b.Elo-a.Elo < 0 {
			return -1
		}
		return 0
	})

	eligibleIndex := 0
	var prevEligibleRoundElo float64 = math.NaN()
	var prevEligibleRank *int
	for i := range players {
		if players[i].MatchesLeftForRanked > 0 {
			players[i].Rank = nil
			continue
		}
		rounded := math.Round(players[i].Elo)
		if !math.IsNaN(prevEligibleRoundElo) && rounded == prevEligibleRoundElo {
			players[i].Rank = prevEligibleRank
		} else {
			r := eligibleIndex + 1
			players[i].Rank = &r
			prevEligibleRank = players[i].Rank
			prevEligibleRoundElo = rounded
		}
		eligibleIndex++
	}

	return players, nil
}

const (
	lastMonth  = time.Duration(30 * 24 * time.Hour)
	last3Month = time.Duration(3 * 30 * 24 * time.Hour)
	last6Month = time.Duration(6 * 30 * 24 * time.Hour)
)

var requiredMatchCountForRanked = map[time.Duration]int{
	lastMonth:  1,
	last3Month: 3,
	last6Month: 7,
}
