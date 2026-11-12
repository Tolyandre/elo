package settlement

// League-kind constants. The canonical promotion order is newbie → amateur →
// elite (enforced by ParseArenaSettings).
const (
	LeagueNewbie  = "newbie"
	LeagueAmateur = "amateur"
	LeagueElite   = "elite"
)

func strPtr(s string) *string { return &s }

// ArenaLeaguePriority orders leagues for ranking: lower = ranked higher.
// The settings list is in promotion order (newbie → amateur → elite), so the
// priority inverts it: elite sorts first. League-less arenas put everyone in
// one bucket (all equal, ties broken by rating).
func ArenaLeaguePriority(league *string, settings ArenaSettings) int {
	if league == nil {
		return len(settings.Leagues)
	}
	for i, l := range settings.Leagues {
		if l.Kind == *league {
			return len(settings.Leagues) - 1 - i
		}
	}
	return len(settings.Leagues)
}

// BaseLeague returns the highest non-elite league (the tier players settle in
// when they leave newbie and do not qualify for elite).
func BaseLeague(settings ArenaSettings) string {
	for i := len(settings.Leagues) - 1; i >= 0; i-- {
		if settings.Leagues[i].Kind != LeagueElite {
			return settings.Leagues[i].Kind
		}
	}
	return settings.Leagues[len(settings.Leagues)-1].Kind
}

// InitialArenaLeague returns the league for a player with no prior settlement
// in the arena. Players whose starting gap exceeds the newbie threshold start
// as newbies (ADR-03); when the arena has no newbie league they start in the
// first league.
func InitialArenaLeague(settings ArenaSettings, s EloSettings) *string {
	if len(settings.Leagues) == 0 {
		return nil
	}
	if nl, ok := settings.Newbie(); ok {
		if s.StartingElo-settings.StartingRating > nl.GoalGap {
			return strPtr(LeagueNewbie)
		}
	}
	for _, l := range settings.Leagues {
		if l.Kind != LeagueNewbie {
			return strPtr(l.Kind)
		}
	}
	return strPtr(LeagueNewbie)
}

// EffectiveArenaLeague accounts for time-based demotion from elite: the
// stored league is set at write time; if the player's recent match counts have
// dropped below the elite thresholds they are effectively in the base league.
func EffectiveArenaLeague(stored *string, cnt60, cnt180 int, settings ArenaSettings) *string {
	if stored == nil {
		return nil
	}
	if *stored == LeagueElite {
		if el, ok := settings.Elite(); ok && cnt180 >= el.Matches6M && cnt60 >= el.Matches2M {
			return stored
		}
		return strPtr(BaseLeague(settings))
	}
	return stored
}

// DisplayLeague is the league a players listing shows: unsettled players
// derive from the starting values, settled players get the stale-elite
// correction. A league-less arena names no league — the empty string (the
// helpers above return nil there, and the listing SQL coalesces the stored
// NULL league to 'newbie', which would misreport every settled player).
func DisplayLeague(stored *string, settled bool, cnt60, cnt180 int, settings ArenaSettings, s EloSettings) string {
	if len(settings.Leagues) == 0 {
		return ""
	}
	var league *string
	if settled {
		league = EffectiveArenaLeague(stored, cnt60, cnt180, settings)
	} else {
		league = InitialArenaLeague(settings, s)
	}
	if league == nil {
		return ""
	}
	return *league
}

// DetermineArenaLeague returns the league a player is in AFTER a settlement.
// A newbie stays while the elo−rating gap exceeds the newbie goal; the elite
// check applies immediately when the counts qualify (a promoted newbie can
// jump straight to elite); everyone else lands in the base league.
func DetermineArenaLeague(prev *string, newRating, newElo float64, count6M, count2M int, settings ArenaSettings) *string {
	if len(settings.Leagues) == 0 {
		return nil
	}
	if nl, ok := settings.Newbie(); ok {
		if prev != nil && *prev == LeagueNewbie && newElo-newRating > nl.GoalGap {
			return strPtr(LeagueNewbie)
		}
	}
	if el, ok := settings.Elite(); ok {
		if count6M >= el.Matches6M && count2M >= el.Matches2M {
			return strPtr(LeagueElite)
		}
	}
	return strPtr(BaseLeague(settings))
}
