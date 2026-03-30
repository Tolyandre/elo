package elo

// MatchWinnerCondition is a pure, DB-free evaluation of the match_winner market condition.
// It is constructed from DB rows in the handler and evaluated against a MatchInfo.
type MatchWinnerCondition struct {
	TargetPlayerID    int32
	RequiredPlayerIDs []int32
	GameID            *int32
}

// Evaluate returns (resolved, outcome) where outcome is "resolved_yes" or "resolved_no".
// Returns (false, "") when the match does not satisfy this condition.
func (c MatchWinnerCondition) Evaluate(match MatchInfo, window TimeWindow) (bool, string) {
	if !window.Contains(match.Match.Date.Time) {
		return false, ""
	}
	if c.GameID != nil && *c.GameID != match.Match.GameID {
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
		return true, "resolved_yes"
	}
	return true, "resolved_no"
}

// WinStreakCondition evaluates win/loss counts against the streak thresholds.
// The caller is responsible for: window check, participant check, and querying streak stats.
type WinStreakCondition struct {
	WinsRequired int32
	MaxLosses    *int32
}

// Evaluate returns (resolved, outcome) given streak counts.
// Loss limit is checked before win target so that hitting both on the same match resolves_no.
func (c WinStreakCondition) Evaluate(wins, losses int32) (bool, string) {
	if c.MaxLosses != nil && losses > *c.MaxLosses {
		return true, "resolved_no"
	}
	if wins >= c.WinsRequired {
		return true, "resolved_yes"
	}
	return false, ""
}
