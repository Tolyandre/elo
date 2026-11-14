package settlement

// EloSettings holds the Elo calculation constants effective at a point in
// time; the struct is never marshaled to the HTTP API.
type EloSettings struct {
	K           float64 `json:"k"`
	D           float64 `json:"d"`
	StartingElo float64 `json:"starting_elo"`
	WinReward   float64 `json:"win_reward"`

	// Newbie league earned scaling parameters.
	NewbieLeagueEarnedMin float64 `json:"newbie_league_earned_min"`
	NewbieLeagueEarnedMax float64 `json:"newbie_league_earned_max"`
	NewbieLeagueEarnedTau float64 `json:"newbie_league_earned_tau"`
	NewbieLeagueGoalGap   float64 `json:"newbie_league_goal_gap"` // gap threshold for newbie → amateur promotion

	EliteMatches6M int `json:"elite_league_matches_6m"`
	EliteMatches2M int `json:"elite_league_matches_2m"`
}
