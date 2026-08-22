package elo

import "strings"

// OutcomeKey is the semantic identifier of an outcome a condition evaluates
// to: "player:<uuid>" for a target player's win outcome, or "other" for the
// catch-all outcome (tie at first place / non-target winner). It is pure
// (DB-free); the handler maps it to the market's concrete market_outcomes row
// id, which is what bets and resolution store.
type OutcomeKey string

const OutcomeKeyOther OutcomeKey = "other"

// OutcomeKeyYes / OutcomeKeyNo identify the two fixed outcomes of a
// win_streak market (their display names are Да / Нет).
const (
	OutcomeKeyYes OutcomeKey = "yes"
	OutcomeKeyNo  OutcomeKey = "no"
)

// PlayerOutcomeKey returns the key of a target player's win outcome.
func PlayerOutcomeKey(playerID string) OutcomeKey {
	return OutcomeKey("player:" + playerID)
}

// PlayerID extracts the player id from a "player:<uuid>" key.
func (k OutcomeKey) PlayerID() (string, bool) {
	pid, ok := strings.CutPrefix(string(k), "player:")
	return pid, ok
}

// MatchWinnerCondition is a pure, DB-free evaluation of the match_winner market
// condition. It is constructed from DB rows in the handler and evaluated
// against a MatchInfo.
type MatchWinnerCondition struct {
	TargetPlayerIDs []string
	// AllowOtherPlayers: true — every target must participate, extra players
	// allowed; false — the match must consist of exactly the target players.
	AllowOtherPlayers bool
	GameIDs           []string
}

// Evaluate returns (resolved, key) where key identifies the winning outcome:
// the sole first-place player's key when exactly one player holds the strict
// maximum score AND that player is a target; OutcomeKeyOther otherwise (tie at
// first place, or a non-target sole winner — possible only when other players
// are allowed). Returns (false, "") when the match does not satisfy this
// condition.
func (c MatchWinnerCondition) Evaluate(match MatchInfo, window TimeWindow) (bool, OutcomeKey) {
	if !window.Contains(match.Match.Date.Time) {
		return false, ""
	}
	if len(c.GameIDs) > 0 && !containsString(c.GameIDs, match.Match.GameID) {
		return false, ""
	}
	for _, t := range c.TargetPlayerIDs {
		if !match.ParticipantSet[t] {
			return false, ""
		}
	}
	if !c.AllowOtherPlayers {
		// The market targets a match with exactly these players.
		if len(match.ParticipantSet) != len(c.TargetPlayerIDs) {
			return false, ""
		}
	}
	if winner, ok := match.SoleWinnerID(); ok {
		if containsString(c.TargetPlayerIDs, winner) {
			return true, PlayerOutcomeKey(winner)
		}
	}
	return true, OutcomeKeyOther
}

func containsString(slice []string, v string) bool {
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
