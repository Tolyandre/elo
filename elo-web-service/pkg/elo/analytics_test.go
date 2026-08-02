package elo

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

func TestComputeEloResetNoRelevantMatches(t *testing.T) {
	// Rows exist but none involve a selected player -> empty series + players.
	rows := []db.ListMatchesForEloResetRow{
		{MatchID: "m1", PlayerID: "other", PlayerName: "Other", Score: 10,
			Date:        pgtype.Timestamptz{Time: time.UnixMilli(0), Valid: true},
			StartingElo: 1000, EloConstK: 32, EloConstD: 400, WinReward: 2},
	}
	res := ComputeEloReset(rows, []string{"sel"}, time.UnixMilli(1e12))
	if len(res.Series) != 0 || len(res.Players) != 0 {
		t.Errorf("expected empty result, got series=%d players=%d", len(res.Series), len(res.Players))
	}
}

func TestComputeEloResetSingleSelectedPlayer(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	calcDate := base.Add(48 * time.Hour)

	// Two matches one day apart; selected player "sel" wins both against "opp".
	rows := []db.ListMatchesForEloResetRow{
		{MatchID: "m1", PlayerID: "sel", PlayerName: "Sel", Score: 30,
			Date:        pgtype.Timestamptz{Time: base, Valid: true},
			StartingElo: 1000, EloConstK: 32, EloConstD: 400, WinReward: 2},
		{MatchID: "m1", PlayerID: "opp", PlayerName: "Opp", Score: 10,
			Date:          pgtype.Timestamptz{Time: base, Valid: true},
			PrevGlobalElo: 1000.0, StartingElo: 1000, EloConstK: 32, EloConstD: 400, WinReward: 2},
		{MatchID: "m2", PlayerID: "sel", PlayerName: "Sel", Score: 30,
			Date:        pgtype.Timestamptz{Time: base.Add(24 * time.Hour), Valid: true},
			StartingElo: 1000, EloConstK: 32, EloConstD: 400, WinReward: 2},
		{MatchID: "m2", PlayerID: "opp", PlayerName: "Opp", Score: 10,
			Date:          pgtype.Timestamptz{Time: base.Add(24 * time.Hour), Valid: true},
			PrevGlobalElo: 1000.0, StartingElo: 1000, EloConstK: 32, EloConstD: 400, WinReward: 2},
	}

	res := ComputeEloReset(rows, []string{"sel"}, calcDate)

	if len(res.Players) != 1 || res.Players[0].ID != "sel" {
		t.Fatalf("expected 1 selected player 'sel', got %+v", res.Players)
	}
	if len(res.Series) == 0 {
		t.Fatal("expected non-empty series")
	}

	// The selected player wins every match they're replayed into. The earliest
	// sample (resetPoint == firstDate) replays all matches, so the player's
	// rating there must end above the 1000 starting baseline. (The latest sample
	// sits at calcDate, after every match, so nothing is replayed and the rating
	// stays at the starting baseline — that's why we assert on the first point.)
	first := res.Series[0]
	if got := first.Players["sel"]; got <= 1000 {
		t.Errorf("expected selected player rating > 1000 after winning both matches, got %v", got)
	}

	// Reset dates must be within [firstMatch, calcDate] and monotonically
	// non-decreasing across the series.
	for i, p := range res.Series {
		if p.ResetDate.Before(base) || p.ResetDate.After(calcDate.Add(time.Second)) {
			t.Errorf("series[%d] reset date %v outside [%v,%v]", i, p.ResetDate, base, calcDate)
		}
		if i > 0 && p.ResetDate.Before(res.Series[i-1].ResetDate) {
			t.Errorf("series[%d] reset date %v before previous %v", i, p.ResetDate, res.Series[i-1].ResetDate)
		}
	}
}
