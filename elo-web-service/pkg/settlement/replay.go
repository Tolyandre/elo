package settlement

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"slices"
	"sort"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ---------------------------------------------------------------------------
// Whole-arena replay (ADR-38): the offline client's mirror of the server's
// arena recalculation (pkg/elo ArenaService.replayArenaMatchesWithinTx /
// EventProcessor.RecalculateFrom scoped to one arena), producing the full
// settlement chain, point-in-time standings and medal stats from pure inputs.
//
// The input carries ALL matches of the arena (client-evaluated membership,
// competitive only) — the club-scale history is small enough to always replay
// from epoch, which keeps the contract checkpoint-free. Market settlements
// are read-only frozen rows: the client cannot recompute them (markets stay
// online), so they enter the chain unchanged — an approximation around edited
// history that the server refines on sync.
//
// Boundary id convention: the client works in Base58 ids (the id.ID JSON
// hooks cover struct fields, but Go marshals map keys only through
// TextMarshaler, which id.ID does not implement), so the score/players maps
// are string-keyed and the replay converts both ways — Base58 in, Base58 out,
// canonical ordering inside.
// ---------------------------------------------------------------------------

// ReplayMatch is one arena member match: the client has already filtered by
// the arena's membership (tenant predicate or MatchFilter) and excluded coop.
// Scores keys are player ids in Base58 form (canonical accepted too).
type ReplayMatch struct {
	ID     id.ID              `json:"id"`
	Date   time.Time          `json:"date"`
	Scores map[string]float64 `json:"scores"`
}

// FrozenSettlement is a read-only ledger row the replay interleaves into the
// state chain at its recorded position — market and market-guarantor
// settlements (discriminator market/market_guarantor) mirrored from the
// server. The amounts are taken verbatim even when an edited match would have
// changed them: provisional, refined by the server after sync.
type FrozenSettlement struct {
	ID           id.ID     `json:"id"`
	PlayerID     id.ID     `json:"player_id"`
	Date         time.Time `json:"date"`
	RatingAfter  float64   `json:"rating_after"`
	EloAfter     float64   `json:"elo_after"`
	RatingStaked float64   `json:"rating_staked"`
	RatingEarned float64   `json:"rating_earned"`
	EloStaked    float64   `json:"elo_staked"`
	EloEarned    float64   `json:"elo_earned"`
	League       *string   `json:"league"`
}

// EloSettingsEntry is one elo_settings time-series row. The full history must
// be supplied — settlements resolve K/D/starting_elo/win_reward at the match
// date, so history changes are honored by replays exactly as on the server.
type EloSettingsEntry struct {
	EffectiveDate time.Time `json:"effective_date"`
	EloSettings             // promoted: marshals flat
}

type ReplayInput struct {
	SettingsRaw        json.RawMessage    `json:"settings"`
	SettingsVersion    int                `json:"settings_version"`
	EloSettingsHistory []EloSettingsEntry `json:"elo_settings"`
	Matches            []ReplayMatch      `json:"matches"`
	MarketSettlements  []FrozenSettlement `json:"market_settlements"`
	// SnapshotTimes are the points standings are computed at (e.g. now,
	// now−12h, now−7d+12h — the same offsets the /arenas/{id}/players
	// endpoint uses for rank history).
	SnapshotTimes []time.Time `json:"snapshot_times"`
}

// MatchSettlement is one match's per-player settlement results, keyed by
// player id in Base58 form.
type MatchSettlement struct {
	MatchID id.ID                   `json:"match_id"`
	Players map[string]PlayerResult `json:"players"`
}

// ArenaStanding is one player's row in a point-in-time standings list — the
// shape of the /arenas/{id}/players response minus the name.
type ArenaStanding struct {
	PlayerID     id.ID   `json:"player_id"`
	Rating       float64 `json:"rating"`
	League       *string `json:"league"`
	Rank         *int    `json:"rank"`
	MatchesCount int     `json:"matches_count"`
	FirstCount   int     `json:"first_count"`
	SecondCount  int     `json:"second_count"`
	ThirdCount   int     `json:"third_count"`
	FourthCount  int     `json:"fourth_count"`
	// Hint counters, only meaningful when the arena has the matching league.
	MatchesLeftForElite       int `json:"matches_left_for_elite"`
	WinsNeededForAmateurLower int `json:"wins_needed_for_amateur_lower"`
	WinsNeededForAmateurUpper int `json:"wins_needed_for_amateur_upper"`
}

// StandingsAt holds the ranked standings list at one snapshot time.
type StandingsAt struct {
	Time    time.Time       `json:"time"`
	Players []ArenaStanding `json:"players"`
}

type ReplayOutput struct {
	// Settlements in replay (date, match id) order — the client looks rows up
	// by match id to fill the settlement columns of match cards.
	Settlements []MatchSettlement `json:"settlements"`
	Standings   []StandingsAt     `json:"standings"`
}

// replayMatchN is the internal, canonical-id form of a replay match.
type replayMatchN struct {
	id     id.ID
	date   time.Time
	scores map[id.ID]float64
}

// chainState is the per-player settlement state carried by the chain.
type chainState struct {
	elo    float64
	rating float64
	league *string
}

// chainEvent is one chain entry in processing order: a match settlement for
// one player or a frozen market row.
type chainEvent struct {
	date time.Time
	pid  id.ID
	st   chainState
}

// ReplayArena replays the whole arena history from epoch. The input matches
// may arrive in any order; the replay orders them by (date, id) — the same
// event order the server's replays use — and processes frozen market rows
// interleaved by (date, id) after the matches of the same date.
func ReplayArena(input ReplayInput) (ReplayOutput, error) {
	settings, err := ParseArenaSettings(input.SettingsRaw, input.SettingsVersion)
	if err != nil {
		return ReplayOutput{}, fmt.Errorf("parse arena settings: %w", err)
	}
	if len(input.EloSettingsHistory) == 0 {
		return ReplayOutput{}, fmt.Errorf("no elo settings history")
	}
	resolveSettings := settingsResolver(input.EloSettingsHistory)

	// Normalize id keys to canonical form, then sort by (date, id) —
	// ListMatchesForArenaReplay's event order.
	matches := make([]replayMatchN, len(input.Matches))
	for i, m := range input.Matches {
		n := replayMatchN{id: m.ID, date: m.Date, scores: make(map[id.ID]float64, len(m.Scores))}
		for key, score := range m.Scores {
			pid, err := id.ParseTolerant(key)
			if err != nil {
				return ReplayOutput{}, fmt.Errorf("match %s: bad player id %q: %w", m.ID, key, err)
			}
			n.scores[pid] = score
		}
		matches[i] = n
	}
	sort.Slice(matches, func(i, j int) bool {
		if !matches[i].date.Equal(matches[j].date) {
			return matches[i].date.Before(matches[j].date)
		}
		return matches[i].id < matches[j].id
	})

	// Frozen market rows sorted by (date, id); interleaved after same-date
	// matches (on the server a market resolving off a match settles right
	// after that match's settlement).
	markets := make([]FrozenSettlement, len(input.MarketSettlements))
	copy(markets, input.MarketSettlements)
	sort.Slice(markets, func(i, j int) bool {
		if !markets[i].Date.Equal(markets[j].Date) {
			return markets[i].Date.Before(markets[j].Date)
		}
		return markets[i].ID < markets[j].ID
	})

	// The event chain, in processing order. perPlayer holds the latest event
	// per player (the chain-so-far the per-match prior-state reads need);
	// the historical standings cut walks the events themselves.
	var events []chainEvent
	perPlayer := make(map[id.ID]chainState)
	out := ReplayOutput{Settlements: make([]MatchSettlement, 0, len(matches))}

	mi, ki := 0, 0
	for mi < len(matches) || ki < len(markets) {
		takeMatch := ki >= len(markets) ||
			(mi < len(matches) && !matches[mi].date.After(markets[ki].Date))
		if takeMatch {
			m := matches[mi]
			mi++
			settlement, typed, err := settleReplayMatch(m, matches, perPlayer, settings, resolveSettings)
			if err != nil {
				return ReplayOutput{}, err
			}
			out.Settlements = append(out.Settlements, settlement)
			for _, pid := range slices.Sorted(maps.Keys(typed)) {
				r := typed[pid]
				st := chainState{elo: r.NewElo, rating: r.NewRating, league: r.League}
				events = append(events, chainEvent{date: m.date, pid: pid, st: st})
				perPlayer[pid] = st
			}
		} else {
			row := markets[ki]
			ki++
			st := chainState{elo: row.EloAfter, rating: row.RatingAfter, league: row.League}
			events = append(events, chainEvent{date: row.Date, pid: row.PlayerID, st: st})
			perPlayer[row.PlayerID] = st
		}
	}

	for _, at := range input.SnapshotTimes {
		st, err := standingsAt(at, matches, events, settings, input.EloSettingsHistory)
		if err != nil {
			return ReplayOutput{}, err
		}
		out.Standings = append(out.Standings, st)
	}
	return out, nil
}

// settleReplayMatch settles one match from the current chain state, mirroring
// lockAndGetPrevArenaState + BuildArenaResults + the settlement write. It
// returns both the boundary shape (Base58-keyed) and the typed results for
// the chain bookkeeping.
func settleReplayMatch(
	m replayMatchN, all []replayMatchN, perPlayer map[id.ID]chainState,
	settings ArenaSettings, resolveSettings func(time.Time) (EloSettings, error),
) (MatchSettlement, map[id.ID]PlayerResult, error) {
	s, err := resolveSettings(m.date)
	if err != nil {
		return MatchSettlement{}, nil, fmt.Errorf("elo settings for match %s: %w", m.id, err)
	}

	prev := ArenaPrevState{
		Elo:      make(map[id.ID]float64, len(m.scores)),
		Rating:   make(map[id.ID]float64, len(m.scores)),
		League:   make(map[id.ID]*string, len(m.scores)),
		Count6M:  make(map[id.ID]int, len(m.scores)),
		Count2M:  make(map[id.ID]int, len(m.scores)),
		Settings: s,
	}
	// Participants in sorted id order — the settlement write order the
	// server uses (its monotonic settlement ids then reproduce a stable
	// (date, id) event order).
	playerIDs := slices.Sorted(maps.Keys(m.scores))

	count6M := countsInWindow(all, m.date.Add(-180*24*time.Hour), m.date)
	count2M := countsInWindow(all, m.date.Add(-60*24*time.Hour), m.date)
	for _, pid := range playerIDs {
		// Prior state: latest chain settlement strictly before this match —
		// processing matches in (date, id) order and reading the chain-so-far
		// reproduces GetPlayerLatestArena{Elo,Rating}BeforeMatch exactly
		// (equal-date settlements of earlier matches are visible).
		if cs, ok := perPlayer[pid]; ok {
			prev.Elo[pid] = cs.elo
			prev.Rating[pid] = cs.rating
			prev.League[pid] = cs.league
		} else {
			prev.Elo[pid] = s.StartingElo
			prev.Rating[pid] = settings.StartingRating
			prev.League[pid] = InitialArenaLeague(settings, s)
		}
		// Stale-elite resolution with pre-match counts (the window counts
		// above include the current match).
		cnt60 := max(count2M[pid]-1, 0)
		cnt180 := max(count6M[pid]-1, 0)
		prev.League[pid] = EffectiveArenaLeague(prev.League[pid], cnt60, cnt180, settings)
	}

	results := BuildArenaResults(m.scores, prev, settings)
	settlement := MatchSettlement{MatchID: m.id, Players: make(map[string]PlayerResult, len(playerIDs))}
	for _, pid := range playerIDs {
		settlement.Players[pid.Base58().String()] = results[pid]
	}
	return settlement, results, nil
}

// settingsResolver resolves the settings effective at t — the
// GetEloSettingsForDate semantics (latest effective_date ≤ t).
func settingsResolver(history []EloSettingsEntry) func(time.Time) (EloSettings, error) {
	return func(t time.Time) (EloSettings, error) {
		var best *EloSettingsEntry
		for i := range history {
			if !history[i].EffectiveDate.After(t) {
				if best == nil || history[i].EffectiveDate.After(best.EffectiveDate) {
					best = &history[i]
				}
			}
		}
		if best == nil {
			return EloSettings{}, fmt.Errorf("no elo settings effective at %v", t)
		}
		return best.EloSettings, nil
	}
}

// countsInWindow counts, per player, the matches with date in [from, to]
// (both ends inclusive — the SQL window is inclusive) that the player has a
// score in. The O(N) scan per call makes the whole replay O(N²) — fine at
// club scale (thousands of matches); a cumulative-per-date series is the
// ready optimization if history ever grows.
func countsInWindow(matches []replayMatchN, from, to time.Time) map[id.ID]int {
	counts := make(map[id.ID]int)
	for _, m := range matches {
		if m.date.Before(from) || m.date.After(to) {
			continue
		}
		for pid := range m.scores {
			counts[pid]++
		}
	}
	return counts
}

// standingsAt builds the ranked standings at one point in time — the mirror
// of GetArenaPlayers (at now) and GetArenaPlayersAt (historical): every
// player with at least one settlement ever, the latest settlement at or
// before `at` (fallback to the starting values), the window counts the hints
// need, medal stats over matches up to `at`, then the league-priority /
// rating ranking with shared ranks.
func standingsAt(
	at time.Time, matches []replayMatchN, events []chainEvent,
	settings ArenaSettings, history []EloSettingsEntry,
) (StandingsAt, error) {
	s, err := settingsResolver(history)(at)
	if err != nil {
		return StandingsAt{}, fmt.Errorf("elo settings at %v: %w", at, err)
	}

	// Latest settlement at or before `at` per player — the LATERAL
	// "latest settlement ≤ at" the listing queries use. Events are in
	// processing order, so a plain scan leaves the latest per player.
	latest := make(map[id.ID]chainState)
	ever := make(map[id.ID]bool, len(events))
	for _, e := range events {
		ever[e.pid] = true
		if !e.date.After(at) {
			latest[e.pid] = e.st
		}
	}

	count60 := countsInWindow(matches, at.Add(-60*24*time.Hour), at)
	count180 := countsInWindow(matches, at.Add(-180*24*time.Hour), at)
	medals := medalStats(matches, at)

	// Base list: every player with at least one settlement ever (match
	// participants plus frozen market rows' players).
	pids := make([]id.ID, 0, len(ever))
	for pid := range ever {
		pids = append(pids, pid)
	}
	slices.Sort(pids)

	players := make([]ArenaStanding, 0, len(pids))
	for _, pid := range pids {
		row := ArenaStanding{PlayerID: pid}
		if st, ok := latest[pid]; ok {
			row.Rating = st.rating
			row.League = st.league
		} else {
			// The listing falls back per column: a player with no
			// settlement at or before `at` shows the starting values.
			row.Rating = settings.StartingRating
			row.League = nil
		}
		row.MatchesCount = countMatches(matches, pid, at)
		if c, ok := medals[pid]; ok {
			row.FirstCount, row.SecondCount = c[0], c[1]
			row.ThirdCount, row.FourthCount = c[2], c[3]
		}
		// Hints read the latest state's elo (with the starting-elo fallback
		// for players with no settlement at or before `at`), like
		// applyArenaPlayerHints does.
		eloAfter := s.StartingElo
		if st, ok := latest[pid]; ok {
			eloAfter = st.elo
		}
		applyHints(&row, eloAfter, count60[pid], count180[pid], settings, s)
		players = append(players, row)
	}

	rankStandings(players, settings)
	return StandingsAt{Time: at, Players: players}, nil
}

// countMatches counts the arena matches up to `at` the player has a score in.
func countMatches(matches []replayMatchN, pid id.ID, at time.Time) int {
	n := 0
	for _, m := range matches {
		if m.date.After(at) {
			continue
		}
		if _, ok := m.scores[pid]; ok {
			n++
		}
	}
	return n
}

// applyHints fills the informational newbie/elite promotion counters when the
// player is in the matching league — the applyArenaPlayerHints semantics.
func applyHints(p *ArenaStanding, eloAfter float64, cnt60, cnt180 int, settings ArenaSettings, s EloSettings) {
	if p.League == nil {
		return
	}
	if *p.League == LeagueNewbie {
		if gap := eloAfter - p.Rating; gap > 0 {
			if nl, ok := settings.Newbie(); ok {
				p.WinsNeededForAmateurLower, p.WinsNeededForAmateurUpper = WinsNeededForAmateur(gap, nl, settings.CatchUp, s)
			}
		}
	}
	if *p.League == LeagueAmateur {
		if el, ok := settings.Elite(); ok {
			deficit := max(el.Matches6M-cnt180, el.Matches2M-cnt60)
			if deficit > 0 {
				p.MatchesLeftForElite = deficit
			}
		}
	}
}

// rankStandings mirrors sortAndRankArenaPlayers: league priority, then rating
// descending; rows with an equal rounded rating in the same league share a
// rank. The sort adds a player-id tie-break the server lacks (its sort is
// non-stable): equal-rating rows render in a reproducible order offline, and
// ranks are unaffected since such rows share a rank anyway.
func rankStandings(players []ArenaStanding, settings ArenaSettings) {
	slices.SortFunc(players, func(a, b ArenaStanding) int {
		pa, pb := ArenaLeaguePriority(a.League, settings), ArenaLeaguePriority(b.League, settings)
		if pa != pb {
			return pa - pb
		}
		if b.Rating-a.Rating > 0 {
			return 1
		}
		if b.Rating-a.Rating < 0 {
			return -1
		}
		if a.PlayerID < b.PlayerID {
			return -1
		}
		if a.PlayerID > b.PlayerID {
			return 1
		}
		return 0
	})

	rank := 0
	var prevRound float64 = math.NaN()
	var prevRank *int
	var prevLeague *string
	for i := range players {
		rounded := math.Round(players[i].Rating)
		if !math.IsNaN(prevRound) && rounded == prevRound && leaguePtrEqual(players[i].League, prevLeague) {
			players[i].Rank = prevRank
		} else {
			r := rank + 1
			players[i].Rank = &r
			prevRank = players[i].Rank
			prevRound = rounded
			prevLeague = players[i].League
		}
		rank++
	}
}

func leaguePtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// medalStats counts the places per player over matches up to `at` — the
// InsertArenaStats semantics: per match, RANK() over score DESC (standard
// competition ranking: ties share the place, the next place skips), places
// 1–4 counted.
func medalStats(matches []replayMatchN, at time.Time) map[id.ID][4]int {
	stats := make(map[id.ID][4]int)
	for _, m := range matches {
		if m.date.After(at) {
			continue
		}
		type placed struct {
			pid   id.ID
			score float64
		}
		row := make([]placed, 0, len(m.scores))
		for pid, score := range m.scores {
			row = append(row, placed{pid, score})
		}
		sort.Slice(row, func(i, j int) bool { return row[i].score > row[j].score })
		place := 1
		for i, p := range row {
			if i > 0 && p.score != row[i-1].score {
				place = i + 1
			}
			if place <= 4 {
				c := stats[p.pid]
				c[place-1]++
				stats[p.pid] = c
			}
		}
	}
	return stats
}

// WinsNeededForAmateur estimates the wins an amateur-bound newbie needs to
// close the directed gap (elo − rating) to the goal — the numerical
// integration behind the "wins needed" hint (mirror of pkg/elo's
// calcWinsNeededForAmateur; the frontend's winsNeededForAmateur mirrors the
// same loop).
func WinsNeededForAmateur(gap float64, nl League, cu CatchUp, s EloSettings) (lower, upper int) {
	goalGap := nl.GoalGap
	if gap <= goalGap || s.D == 0 {
		return 0, 0
	}
	const step = 1.0
	deltaEloPerWin := s.K / 2
	var totalLower, totalUpper float64
	for g := goalGap; g < gap; g += step {
		delta := math.Min(step, gap-g)
		mid := g + delta/2
		earnedMax := s.K + (cu.EarnedMax-s.K)*(1-expDeterministic(-mid/cu.Tau))
		eWin := 1.0 / (1.0 + math.Pow(10, mid/s.D))
		netRating := earnedMax - s.K*eWin
		if netRating > 0 {
			totalLower += delta / netRating
		}
		netGap := netRating - deltaEloPerWin
		if netGap > 0 {
			totalUpper += delta / netGap
		}
	}
	return int(math.Ceil(totalLower)), int(math.Ceil(totalUpper))
}
