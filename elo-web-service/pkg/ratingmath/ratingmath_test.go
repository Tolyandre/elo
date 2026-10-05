package ratingmath

import (
	"math"
	"testing"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// Standard Elo constants used as fixtures across the math tests.
const testWinReward = 2.0

func floatsEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func TestGetAbsoluteLoserScore(t *testing.T) {
	cases := []struct {
		name   string
		scores map[id.ID]float64
		want   float64
	}{
		{"empty returns 0", map[id.ID]float64{}, 0},
		{"single entry", map[id.ID]float64{"a": 42}, 42},
		{"min of several", map[id.ID]float64{"a": 10, "b": -3, "c": 7}, -3},
		{"negative values", map[id.ID]float64{"a": -10, "b": -2}, -10},
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
		playersScore       map[id.ID]float64
		absoluteLoserScore float64
		want               float64
	}{
		{
			// all-equal scores -> numerator and denominator both 0 -> NaN -> fallback 1/N.
			name:               "all-equal scores fall back to uniform 1/N",
			currentScore:       10,
			playersScore:       map[id.ID]float64{"a": 10, "b": 10},
			absoluteLoserScore: 10,
			want:               0.5,
		},
		{
			// Two players, scores 30 and 10, loser=10, winReward=2:
			// sumPow = (30-10)^2 + (10-10)^2 = 400 + 0 = 400
			// current=30: (30-10)^2 / 400 = 400/400 = 1.0 (the winner takes everything)
			name:               "winner with zero-score loser takes all",
			currentScore:       30,
			playersScore:       map[id.ID]float64{"a": 30, "b": 10},
			absoluteLoserScore: 10,
			want:               1.0,
		},
		{
			// Three players scores {50,30,10}, loser=10, winReward=2:
			// sumPow = 40^2 + 20^2 + 0^2 = 1600+400 = 2000
			// current=30: 20^2/2000 = 400/2000 = 0.2
			name:               "middle player gets a share",
			currentScore:       30,
			playersScore:       map[id.ID]float64{"a": 50, "b": 30, "c": 10},
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
	scores := map[id.ID]float64{"a": 50, "b": 30, "c": 10}
	loser := 10.0
	prev := NormalizedScore(30, scores, loser, testWinReward)
	higher := NormalizedScore(50, scores, loser, testWinReward)
	if !(higher >= prev) {
		t.Errorf("expected higher score to yield >= normalized score: got %v vs %v", higher, prev)
	}
}

func TestNormalizedScoresSumToOne(t *testing.T) {
	// For non-degenerate inputs the normalized scores over all players sum to 1.
	scores := map[id.ID]float64{"a": 50, "b": 30, "c": 10}
	loser := GetAbsoluteLoserScore(scores)
	var sum float64
	for _, s := range scores {
		sum += NormalizedScore(s, scores, loser, testWinReward)
	}
	if !floatsEqual(sum, 1.0) {
		t.Errorf("normalized scores sum = %v, want 1.0", sum)
	}
}

// TestNormalizedScoreDeterministic pins the share arithmetic to bit-identical
// results across repeated invocations. The sum runs over a player map, and Go
// randomizes map range order — unordered accumulation would drift the last
// bits and make replays irreproducible.
func TestNormalizedScoreDeterministic(t *testing.T) {
	scores := map[id.ID]float64{"a": 10, "b": 7, "c": 5, "d": 2}
	want := math.Float64bits(NormalizedScore(scores["c"], scores, GetAbsoluteLoserScore(scores), testWinReward))
	for i := 0; i < 5000; i++ {
		if got := math.Float64bits(NormalizedScore(scores["c"], scores, GetAbsoluteLoserScore(scores), testWinReward)); got != want {
			t.Fatalf("NormalizedScore is not deterministic: %b vs %b", got, want)
		}
	}
}
