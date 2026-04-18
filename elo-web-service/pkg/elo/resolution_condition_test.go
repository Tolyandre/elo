package elo

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
)

var testWindow = TimeWindow{
	StartsAt: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
	ClosesAt: time.Date(2024, 12, 31, 23, 59, 59, 0, time.UTC),
}

func makeMatch(date time.Time, gameID int32, participants map[int32]float64) MatchInfo {
	scores := make(map[int32]float64, len(participants))
	pset := make(map[int32]bool, len(participants))
	maxScore := -1.0
	for pid, score := range participants {
		scores[pid] = score
		pset[pid] = true
		if score > maxScore {
			maxScore = score
		}
	}
	return MatchInfo{
		Match: db.Match{
			Date:   pgtype.Timestamptz{Time: date, Valid: true},
			GameID: gameID,
		},
		PlayerScoreMap: scores,
		ParticipantSet: pset,
		MaxScore:       maxScore,
	}
}

func TestTimeWindow_Contains(t *testing.T) {
	w := TimeWindow{
		StartsAt: time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC),
		ClosesAt: time.Date(2024, 6, 30, 0, 0, 0, 0, time.UTC),
	}
	cases := []struct {
		t    time.Time
		want bool
	}{
		{time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC), true},  // inside
		{time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC), true},   // on start boundary
		{time.Date(2024, 6, 30, 0, 0, 0, 0, time.UTC), true},  // on end boundary
		{time.Date(2024, 5, 31, 0, 0, 0, 0, time.UTC), false}, // before start
		{time.Date(2024, 7, 1, 0, 0, 0, 0, time.UTC), false},  // after end
	}
	for _, tc := range cases {
		got := w.Contains(tc.t)
		if got != tc.want {
			t.Errorf("Contains(%v) = %v, want %v", tc.t, got, tc.want)
		}
	}
}

func TestMatchWinnerCondition_Evaluate(t *testing.T) {
	inWindow := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	outOfWindow := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	gameID := int32(1)
	otherGameID := int32(2)

	t.Run("resolved_yes when target has max score", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10}
		match := makeMatch(inWindow, gameID, map[int32]float64{10: 5, 20: 3})
		resolved, outcome := cond.Evaluate(match, testWindow)
		if !resolved || outcome != OutcomeYes {
			t.Errorf("got resolved=%v outcome=%q, want true/yes", resolved, outcome)
		}
	})

	t.Run("resolved_no when target does not have max score", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10}
		match := makeMatch(inWindow, gameID, map[int32]float64{10: 3, 20: 5})
		resolved, outcome := cond.Evaluate(match, testWindow)
		if !resolved || outcome != OutcomeNo {
			t.Errorf("got resolved=%v outcome=%q, want true/no", resolved, outcome)
		}
	})

	t.Run("not resolved when match date outside window", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10}
		match := makeMatch(outOfWindow, gameID, map[int32]float64{10: 5, 20: 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved for match outside window")
		}
	})

	t.Run("not resolved when game_id does not match", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10, GameIDs: []int32{gameID}}
		match := makeMatch(inWindow, otherGameID, map[int32]float64{10: 5, 20: 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved for wrong game")
		}
	})

	t.Run("resolved when game_id matches", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10, GameIDs: []int32{gameID}}
		match := makeMatch(inWindow, gameID, map[int32]float64{10: 5, 20: 3})
		resolved, outcome := cond.Evaluate(match, testWindow)
		if !resolved || outcome != OutcomeYes {
			t.Errorf("got resolved=%v outcome=%q", resolved, outcome)
		}
	})

	t.Run("not resolved when target not in match", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 99}
		match := makeMatch(inWindow, gameID, map[int32]float64{10: 5, 20: 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved when target absent")
		}
	})

	t.Run("not resolved when required player absent", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10, RequiredPlayerIDs: []int32{30}}
		match := makeMatch(inWindow, gameID, map[int32]float64{10: 5, 20: 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved when required player absent")
		}
	})

	t.Run("resolved when required player present", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerID: 10, RequiredPlayerIDs: []int32{20}}
		match := makeMatch(inWindow, gameID, map[int32]float64{10: 5, 20: 3})
		resolved, outcome := cond.Evaluate(match, testWindow)
		if !resolved || outcome != OutcomeYes {
			t.Errorf("got resolved=%v outcome=%q", resolved, outcome)
		}
	})
}

func TestWinStreakCondition_Evaluate(t *testing.T) {
	t.Run("resolved_yes when wins reach required", func(t *testing.T) {
		cond := WinStreakCondition{WinsRequired: 3}
		resolved, outcome := cond.Evaluate(3, 0)
		if !resolved || outcome != OutcomeYes {
			t.Errorf("got resolved=%v outcome=%q", resolved, outcome)
		}
	})

	t.Run("not resolved when wins below required", func(t *testing.T) {
		cond := WinStreakCondition{WinsRequired: 3}
		resolved, _ := cond.Evaluate(2, 0)
		if resolved {
			t.Error("expected not resolved")
		}
	})

	t.Run("resolved_no when losses exceed limit", func(t *testing.T) {
		maxLosses := int32(1)
		cond := WinStreakCondition{WinsRequired: 5, MaxLosses: &maxLosses}
		resolved, outcome := cond.Evaluate(4, 2)
		if !resolved || outcome != OutcomeNo {
			t.Errorf("got resolved=%v outcome=%q", resolved, outcome)
		}
	})

	t.Run("loss limit checked before win target — both hit on same match resolves_no", func(t *testing.T) {
		maxLosses := int32(1)
		cond := WinStreakCondition{WinsRequired: 3, MaxLosses: &maxLosses}
		resolved, outcome := cond.Evaluate(3, 2) // wins=3 AND losses=2 > maxLosses=1
		if !resolved || outcome != OutcomeNo {
			t.Errorf("got resolved=%v outcome=%q, want true/no", resolved, outcome)
		}
	})

	t.Run("no max losses: only wins matter", func(t *testing.T) {
		cond := WinStreakCondition{WinsRequired: 2}
		resolved, outcome := cond.Evaluate(2, 100)
		if !resolved || outcome != OutcomeYes {
			t.Errorf("got resolved=%v outcome=%q", resolved, outcome)
		}
	})
}
