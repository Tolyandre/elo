package elo

// MatchWinnerCondition is a pure, DB-free evaluation of the match_winner market condition.
// It is constructed from DB rows in the handler and evaluated against a MatchInfo.
type MatchWinnerCondition struct {
	TargetPlayerID    int32
	RequiredPlayerIDs []int32
	GameIDs           []int32
}

// Evaluate returns (resolved, outcome) where outcome is OutcomeYes or OutcomeNo.
// Returns (false, "") when the match does not satisfy this condition.
func (c MatchWinnerCondition) Evaluate(match MatchInfo, window TimeWindow) (bool, MarketOutcome) {
	if !window.Contains(match.Match.Date.Time) {
		return false, ""
	}
	if len(c.GameIDs) > 0 && !containsInt32(c.GameIDs, match.Match.GameID) {
		return false, ""
	}
	for _, req := range c.RequiredPlayerIDs {
		if !match.ParticipantSet[req] {
			return false, ""
		}
	}
	if !match.ParticipantSet[c.TargetPlayerID] {
		return false, ""
	}
	if match.PlayerScoreMap[c.TargetPlayerID] >= match.MaxScore {
		return true, OutcomeYes
	}
	return true, OutcomeNo
}

func containsInt32(slice []int32, v int32) bool {
	for _, s := range slice {
		if s == v {
			return true
		}
	}
	return false
}

// WinStreakCondition evaluates win/loss counts against the streak thresholds.
// The caller is responsible for: window check, participant check, and querying streak stats.
type WinStreakCondition struct {
	WinsRequired int32
	MaxLosses    *int32
}

// Evaluate returns (resolved, outcome) given streak counts.
// Loss limit is checked before win target so that hitting both on the same match resolves OutcomeNo.
func (c WinStreakCondition) Evaluate(wins, losses int32) (bool, MarketOutcome) {
	if c.MaxLosses != nil && losses > *c.MaxLosses {
		return true, OutcomeNo
	}
	if wins >= c.WinsRequired {
		return true, OutcomeYes
	}
	return false, ""
}
