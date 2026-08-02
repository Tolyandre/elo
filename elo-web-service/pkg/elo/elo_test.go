package elo

import (
	"math"
	"testing"
)

// Standard Elo constants used as fixtures across the math tests.
const (
	testK           = 32.0
	testD           = 400.0
	testStartingElo = 1000.0
	testWinReward   = 2.0
)

func floatsEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestWinExpectation(t *testing.T) {
	cases := []struct {
		name         string
		currentElo   float64
		playersScore map[string]float64
		prevElo      map[string]float64
		want         float64
	}{
		{
			name:         "single player short-circuits to 1",
			currentElo:   testStartingElo,
			playersScore: map[string]float64{"a": 10},
			prevElo:      map[string]float64{"a": testStartingElo},
			want:         1,
		},
		{
			name:         "two equal-rated players each expect 0.5",
			currentElo:   testStartingElo,
			playersScore: map[string]float64{"a": 10, "b": 10},
			prevElo:      map[string]float64{"a": testStartingElo, "b": testStartingElo},
			want:         0.5,
		},
		{
			// Player rated 1400 in a 3-player game; all opponents at 1000 (the
			// function enumerates every entry in playersScore, falling back to
			// startingElo=1000 for any id absent from prevElo). Each of the three
			// contributes 1/(1+10^((1000-1400)/400)) = 1/(1+0.1) = 0.9091.
			// sum = 3 * 0.9091 = 2.7273; result = (2.7273 - 0.5) / (3*2/2) = 2.2273/3 = 0.7424.
			name:         "higher-rated player expects more than 0.5",
			currentElo:   1400,
			playersScore: map[string]float64{"a": 10, "b": 10, "c": 10},
			prevElo:      map[string]float64{"a": 1000, "b": 1000},
			want:         0.7424242424242424,
		},
		{
			// Opponent absent from prevElo falls back to startingElo.
			name:         "missing opponent rating falls back to startingElo",
			currentElo:   testStartingElo,
			playersScore: map[string]float64{"a": 10, "b": 10},
			prevElo:      nil, // both opponents fall back to startingElo -> equal rating
			want:         0.5,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := WinExpectation(c.currentElo, c.playersScore, testStartingElo, c.prevElo, testD)
			if !floatsEqual(got, c.want) {
				t.Errorf("WinExpectation = %v, want %v", got, c.want)
			}
		})
	}
}

func TestWinExpectationSymmetricSum(t *testing.T) {
	// For a symmetric 2-player game the two players' expectations must sum to 1.
	prev := map[string]float64{"a": 1100, "b": 900}
	scores := map[string]float64{"a": 1, "b": 0}
	ea := WinExpectation(1100, scores, testStartingElo, prev, testD)
	eb := WinExpectation(900, scores, testStartingElo, prev, testD)
	if !floatsEqual(ea+eb, 1.0) {
		t.Errorf("symmetric 2-player expectations sum = %v, want 1.0", ea+eb)
	}
}

func TestGetAbsoluteLoserScore(t *testing.T) {
	cases := []struct {
		name   string
		scores map[string]float64
		want   float64
	}{
		{"empty returns 0", map[string]float64{}, 0},
		{"single entry", map[string]float64{"a": 42}, 42},
		{"min of several", map[string]float64{"a": 10, "b": -3, "c": 7}, -3},
		{"negative values", map[string]float64{"a": -10, "b": -2}, -10},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := GetAbsoluteLoserScore(c.scores); got != c.want {
				t.Errorf("GetAbsoluteLoserScore = %v, want %v", got, c.want)
			}
		})
	}
}

func TestNormalizedScore(t *testing.T) {
	cases := []struct {
		name               string
		currentScore       float64
		playersScore       map[string]float64
		absoluteLoserScore float64
		want               float64
	}{
		{
			// all-equal scores -> numerator and denominator both 0 -> NaN -> fallback 1/N.
			name:               "all-equal scores fall back to uniform 1/N",
			currentScore:       10,
			playersScore:       map[string]float64{"a": 10, "b": 10},
			absoluteLoserScore: 10,
			want:               0.5,
		},
		{
			// Two players, scores 30 and 10, loser=10, winReward=2:
			// sumPow = (30-10)^2 + (10-10)^2 = 400 + 0 = 400
			// current=30: (30-10)^2 / 400 = 400/400 = 1.0 (the winner takes everything)
			name:               "winner with zero-score loser takes all",
			currentScore:       30,
			playersScore:       map[string]float64{"a": 30, "b": 10},
			absoluteLoserScore: 10,
			want:               1.0,
		},
		{
			// Three players scores {50,30,10}, loser=10, winReward=2:
			// sumPow = 40^2 + 20^2 + 0^2 = 1600+400 = 2000
			// current=30: 20^2/2000 = 400/2000 = 0.2
			name:               "middle player gets a share",
			currentScore:       30,
			playersScore:       map[string]float64{"a": 50, "b": 30, "c": 10},
			absoluteLoserScore: 10,
			want:               0.2,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := NormalizedScore(c.currentScore, c.playersScore, c.absoluteLoserScore, testWinReward)
			if !floatsEqual(got, c.want) {
				t.Errorf("NormalizedScore = %v, want %v", got, c.want)
			}
		})
	}
}

func TestNormalizedScoreMonotonic(t *testing.T) {
	// Holding everything else fixed, a higher currentScore must yield a higher
	// (or equal) normalized score.
	scores := map[string]float64{"a": 50, "b": 30, "c": 10}
	loser := 10.0
	prev := NormalizedScore(30, scores, loser, testWinReward)
	higher := NormalizedScore(50, scores, loser, testWinReward)
	if !(higher >= prev) {
		t.Errorf("expected higher score to yield >= normalized score: got %v vs %v", higher, prev)
	}
}

func TestNormalizedScoresSumToOne(t *testing.T) {
	// For non-degenerate inputs the normalized scores over all players sum to 1.
	scores := map[string]float64{"a": 50, "b": 30, "c": 10}
	loser := GetAbsoluteLoserScore(scores)
	var sum float64
	for _, s := range scores {
		sum += NormalizedScore(s, scores, loser, testWinReward)
	}
	if !floatsEqual(sum, 1.0) {
		t.Errorf("normalized scores sum = %v, want 1.0", sum)
	}
}

func TestCalculateNewElo(t *testing.T) {
	t.Run("equal-score symmetric match leaves ratings unchanged", func(t *testing.T) {
		prev := map[string]float64{"a": 1000.0, "b": 1000.0}
		// All-equal scores: NormalizedScore falls back to 1/N = 0.5 for each,
		// and WinExpectation for equal ratings is 0.5; delta = K*(0.5-0.5) = 0.
		scores := map[string]float64{"a": 10.0, "b": 10.0}
		got := CalculateNewElo(prev, testStartingElo, scores, testK, testD, testWinReward)
		for pid, elo := range got {
			if !floatsEqual(elo, testStartingElo) {
				t.Errorf("player %s elo = %v, want %v (no change)", pid, elo, testStartingElo)
			}
		}
	})

	t.Run("winner gains, loser loses by the same amount in a 2-player match", func(t *testing.T) {
		prev := map[string]float64{"a": 1000.0, "b": 1000.0}
		// Winner-takes-all scores: a wins everything.
		scores := map[string]float64{"a": 30.0, "b": 10.0}
		got := CalculateNewElo(prev, testStartingElo, scores, testK, testD, testWinReward)

		deltaA := got["a"] - 1000.0
		deltaB := got["b"] - 1000.0
		if !(deltaA > 0) {
			t.Errorf("winner should gain elo, got delta %v", deltaA)
		}
		if !(deltaB < 0) {
			t.Errorf("loser should lose elo, got delta %v", deltaB)
		}
		// Symmetric 2-player zero-sum: the deltas are equal and opposite.
		if !floatsEqual(deltaA, -deltaB) {
			t.Errorf("expected zero-sum deltas, got a=%v b=%v", deltaA, deltaB)
		}
	})

	t.Run("players not in the score map are passed through unchanged", func(t *testing.T) {
		prev := map[string]float64{"a": 1000.0, "b": 1500.0}
		scores := map[string]float64{"a": 30.0, "b": 10.0}
		got := CalculateNewElo(prev, testStartingElo, scores, testK, testD, testWinReward)
		// b participates and changes; but if we add a non-participating player
		// to prev, they must be carried over verbatim.
		prev["c"] = 777.0
		got = CalculateNewElo(prev, testStartingElo, scores, testK, testD, testWinReward)
		if got["c"] != 777.0 {
			t.Errorf("non-participating player c = %v, want 777.0", got["c"])
		}
	})

	t.Run("new player without prior elo falls back to startingElo", func(t *testing.T) {
		// Player b is new (no prior), so their baseline before the delta is startingElo.
		prev := map[string]float64{"a": 1000.0}
		scores := map[string]float64{"a": 30.0, "b": 10.0}
		got := CalculateNewElo(prev, testStartingElo, scores, testK, testD, testWinReward)
		// b lost; their new elo must be below the starting baseline.
		if !(got["b"] < testStartingElo) {
			t.Errorf("new losing player b = %v, want below %v", got["b"], testStartingElo)
		}
	})
}
