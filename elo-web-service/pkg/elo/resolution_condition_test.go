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

func makeMatch(date time.Time, gameID string, participants map[string]float64) MatchInfo {
	scores := make(map[string]float64, len(participants))
	pset := make(map[string]bool, len(participants))
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

func TestSoleWinnerID(t *testing.T) {
	t.Run("sole winner", func(t *testing.T) {
		m := makeMatch(time.Now(), "g", map[string]float64{"10": 5, "20": 3, "30": 1})
		winner, ok := m.SoleWinnerID()
		if !ok || winner != "10" {
			t.Fatalf("got (%q, %v), want (\"10\", true)", winner, ok)
		}
	})
	t.Run("tie at top means no sole winner", func(t *testing.T) {
		m := makeMatch(time.Now(), "g", map[string]float64{"10": 5, "20": 5, "30": 1})
		if _, ok := m.SoleWinnerID(); ok {
			t.Fatal("expected no sole winner on a tie at first place")
		}
	})
	t.Run("everyone tied means no sole winner", func(t *testing.T) {
		m := makeMatch(time.Now(), "g", map[string]float64{"10": 4, "20": 4})
		if _, ok := m.SoleWinnerID(); ok {
			t.Fatal("expected no sole winner when everyone ties")
		}
	})
}

func TestMatchWinnerCondition_Evaluate(t *testing.T) {
	inWindow := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	outOfWindow := time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)
	gameID := "game-1"
	otherGameID := "game-2"

	t.Run("sole target winner resolves to the player outcome", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 5, "20": 3})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != PlayerOutcomeKey("10") {
			t.Errorf("got resolved=%v key=%q, want true/player:10", resolved, key)
		}
	})

	t.Run("target behind resolves to other", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 3, "20": 5})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != OutcomeKeyOther {
			t.Errorf("got resolved=%v key=%q, want true/other", resolved, key)
		}
	})

	t.Run("tie at first place resolves to other even if target is tied", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 5, "20": 5})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != OutcomeKeyOther {
			t.Errorf("got resolved=%v key=%q, want true/other (tie)", resolved, key)
		}
	})

	t.Run("non-target sole winner resolves to other when others allowed", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 3, "99": 5})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != OutcomeKeyOther {
			t.Errorf("got resolved=%v key=%q, want true/other", resolved, key)
		}
	})

	t.Run("second target winning resolves to that target's outcome", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10", "20"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 3, "20": 5})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != PlayerOutcomeKey("20") {
			t.Errorf("got resolved=%v key=%q, want true/player:20", resolved, key)
		}
	})

	t.Run("not resolved when match date outside window", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true}
		match := makeMatch(outOfWindow, gameID, map[string]float64{"10": 5, "20": 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved for match outside window")
		}
	})

	t.Run("not resolved when game_id does not match", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true, GameIDs: []string{gameID}}
		match := makeMatch(inWindow, otherGameID, map[string]float64{"10": 5, "20": 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved for wrong game")
		}
	})

	t.Run("resolved when game_id matches", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10"}, AllowOtherPlayers: true, GameIDs: []string{gameID}}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 5, "20": 3})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != PlayerOutcomeKey("10") {
			t.Errorf("got resolved=%v key=%q", resolved, key)
		}
	})

	t.Run("not resolved when a target is absent", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10", "30"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 5, "20": 3})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved when a target player is absent")
		}
	})

	t.Run("allow_other: extra players do not block resolution", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10", "20"}, AllowOtherPlayers: true}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 1, "20": 2, "30": 5, "40": 0})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != OutcomeKeyOther {
			t.Errorf("got resolved=%v key=%q, want true/other (non-target won)", resolved, key)
		}
	})

	t.Run("exact players: extra players block resolution", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10", "20"}, AllowOtherPlayers: false}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 1, "20": 2, "30": 5})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved when extra players participate and others are not allowed")
		}
	})

	t.Run("exact players: matching set resolves", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10", "20"}, AllowOtherPlayers: false}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 1, "20": 2})
		resolved, key := cond.Evaluate(match, testWindow)
		if !resolved || key != PlayerOutcomeKey("20") {
			t.Errorf("got resolved=%v key=%q, want true/player:20", resolved, key)
		}
	})

	t.Run("exact players: missing target blocks resolution", func(t *testing.T) {
		cond := MatchWinnerCondition{TargetPlayerIDs: []string{"10", "20"}, AllowOtherPlayers: false}
		match := makeMatch(inWindow, gameID, map[string]float64{"10": 1})
		resolved, _ := cond.Evaluate(match, testWindow)
		if resolved {
			t.Error("expected not resolved when a target is missing")
		}
	})
}

func TestOutcomeKey(t *testing.T) {
	k := PlayerOutcomeKey("abc")
	pid, ok := k.PlayerID()
	if !ok || pid != "abc" {
		t.Fatalf("PlayerID() = (%q, %v), want (\"abc\", true)", pid, ok)
	}
	if _, ok := OutcomeKeyOther.PlayerID(); ok {
		t.Fatal("other key must not extract a player id")
	}
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
