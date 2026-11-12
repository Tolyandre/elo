package settlement

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/id"
)

// The golden fixtures pin the settlement core's behavior and are the parity
// gate for the offline client (ADR-38): the frontend's Vitest suite replays
// every fixture's input through the wasm build and must reproduce the output
// exactly — the browser runs the same Go code, so any drift is a bug.
//
// Regenerate after a deliberate change to the settlement math:
//
//	ELO_UPDATE_GOLDEN=1 go test ./pkg/settlement/ -run TestGoldenFixtures
//
// (run via `make golden`); the regenerated nextjs/__tests__/fixtures/
// settlement-golden.json must be committed together with the change.

const goldenFixtureRelPath = "../../../nextjs/__tests__/fixtures/settlement-golden.json"

type goldenCase struct {
	Name   string       `json:"name"`
	Input  ReplayInput  `json:"input"`
	Output ReplayOutput `json:"output"`
}

type goldenFile struct {
	Version int          `json:"version"`
	Cases   []goldenCase `json:"cases"`
}

// Fixed timestamps: the fixtures must be byte-stable across runs.
var (
	goldenEpoch = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	goldenNow   = time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	goldenDay   = goldenNow.Add(-12 * time.Hour)                // the /players day-ago offset
	goldenWeek  = goldenNow.Add(-7*24*time.Hour + 12*time.Hour) // the week-ago offset
)

func goldenDate(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

// tenantArenaDoc is a league-less tenant-main-arena settings document: the
// display rating starts equal to starting_elo, so rating ≡ elo.
const tenantArenaDoc = `{"starting_rating": 1000, "catch_up": {"earned_min": 2, "earned_max": 64, "tau": 100}, "leagues": []}`

// gameArenaDoc is a per-game arena with a lower starting rating and the full
// league ladder: the rating track catches up through the scaled earned.
const gameArenaDoc = `{"starting_rating": 900, "catch_up": {"earned_min": 2, "earned_max": 64, "tau": 100}, "leagues": [{"kind": "newbie", "goal_gap": 16}, {"kind": "amateur"}, {"kind": "elite", "matches_6m": 20, "matches_2m": 3}]}`

func goldenEloSettings(effective time.Time, k, d, startingElo, winReward float64) EloSettingsEntry {
	return EloSettingsEntry{
		EffectiveDate: effective,
		EloSettings: EloSettings{
			K: k, D: d, StartingElo: startingElo, WinReward: winReward,
			NewbieLeagueEarnedMin: 2, NewbieLeagueEarnedMax: 64, NewbieLeagueEarnedTau: 100,
			NewbieLeagueGoalGap: 16,
			EliteMatches6M:      20, EliteMatches2M: 3,
		},
	}
}

func mustID(t *testing.T, name, s string) id.ID {
	t.Helper()
	parsed, err := id.Parse(s)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return parsed
}

// goldenCases builds the fixture corpus. Ids are fixed UUIDs; the fixture
// names say what each case pins. Inputs are pre-filtered arena-member
// competitive matches (the client's membership evaluation is out of scope
// here — the pure replay sees only what belongs to the arena).
func goldenCases(t *testing.T) []goldenCase {
	pA := mustID(t, "pA", "018f6b48-0000-7000-8000-00000000000a")
	pB := mustID(t, "pB", "018f6b48-0000-7000-8000-00000000000b")
	pC := mustID(t, "pC", "018f6b48-0000-7000-8000-00000000000c")
	pD := mustID(t, "pD", "018f6b48-0000-7000-8000-00000000000d")
	m1 := mustID(t, "m1", "018f6b49-0000-7000-8000-000000000001")
	m2 := mustID(t, "m2", "018f6b49-0000-7000-8000-000000000002")
	m3 := mustID(t, "m3", "018f6b49-0000-7000-8000-000000000003")
	m4 := mustID(t, "m4", "018f6b49-0000-7000-8000-000000000004")
	baseSettings := []EloSettingsEntry{
		goldenEloSettings(goldenEpoch, 32, 400, 1000, 1),
	}
	baseSnapshots := []time.Time{goldenWeek, goldenDay, goldenNow}

	base := func(doc string, matches []ReplayMatch) ReplayInput {
		return ReplayInput{
			SettingsRaw:        json.RawMessage(doc),
			SettingsVersion:    CurrentVersion,
			EloSettingsHistory: baseSettings,
			Matches:            matches,
			SnapshotTimes:      baseSnapshots,
		}
	}

	var cases []goldenCase
	add := func(name string, in ReplayInput) {
		out, err := ReplayArena(in)
		if err != nil {
			t.Fatalf("%s: replay failed: %v", name, err)
		}
		cases = append(cases, goldenCase{Name: name, Input: in, Output: out})
	}

	// Two players, head-to-head, league-less tenant arena: the baseline the
	// classic Elo formula is checked against.
	add("two players head-to-head", base(tenantArenaDoc, []ReplayMatch{{
		ID: m1, Date: goldenDate("2025-06-10T10:00:00Z"),
		Scores: map[string]float64{pA.String(): 10, pB.String(): 5},
	}}))

	// Four players with distinct scores — the multi-player normalization
	// relative to the lowest score, zero-sum deltas.
	add("four players distinct scores", base(tenantArenaDoc, []ReplayMatch{{
		ID: m1, Date: goldenDate("2025-06-10T10:00:00Z"),
		Scores: map[string]float64{pA.String(): 120, pB.String(): 80, pC.String(): 40, pD.String(): 10},
	}}))

	// All-equal scores: the 0/0 normalization falls back to uniform shares;
	// expectations still differ by rating.
	add("tie scores all equal", base(tenantArenaDoc, []ReplayMatch{{
		ID: m1, Date: goldenDate("2025-06-10T10:00:00Z"),
		Scores: map[string]float64{pA.String(): 7, pB.String(): 7, pC.String(): 7},
	}}))

	// winReward = 2: the score surplus is squared before normalization.
	add("win reward exponent 2", func() ReplayInput {
		in := base(tenantArenaDoc, []ReplayMatch{{
			ID: m1, Date: goldenDate("2025-06-10T10:00:00Z"),
			Scores: map[string]float64{pA.String(): 100, pB.String(): 60, pC.String(): 10},
		}})
		in.EloSettingsHistory = []EloSettingsEntry{goldenEloSettings(goldenEpoch, 32, 400, 1000, 2)}
		return in
	}())

	// A three-match chain: each match settles on the previous chain state.
	add("chain of three matches", base(tenantArenaDoc, []ReplayMatch{
		{ID: m1, Date: goldenDate("2025-06-01T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
		{ID: m2, Date: goldenDate("2025-06-05T10:00:00Z"), Scores: map[string]float64{pA.String(): 2, pB.String(): 9}},
		{ID: m3, Date: goldenDate("2025-06-10T10:00:00Z"), Scores: map[string]float64{pA.String(): 6, pB.String(): 6}},
	}))

	// Two matches on the same date: the (date, id) tie-break orders them —
	// m2's higher id settles second.
	add("same-date matches order by id", base(tenantArenaDoc, []ReplayMatch{
		{ID: m2, Date: goldenDate("2025-06-10T10:00:00Z"), Scores: map[string]float64{pA.String(): 3, pB.String(): 9}},
		{ID: m1, Date: goldenDate("2025-06-10T10:00:00Z"), Scores: map[string]float64{pA.String(): 9, pB.String(): 3}},
	}))

	// Catch-up arena (starting rating 900 vs starting elo 1000, full league
	// ladder): the rating track converges through the scaled earned; players
	// starting below the newbie gap open as newbies.
	add("catch-up arena rating convergence", base(gameArenaDoc, []ReplayMatch{
		{ID: m1, Date: goldenDate("2025-06-01T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
		{ID: m2, Date: goldenDate("2025-06-05T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
		{ID: m3, Date: goldenDate("2025-06-10T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
		{ID: m4, Date: goldenDate("2025-06-14T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
	}))

	// Settings change mid-history: the second match settles under the new
	// K and starting elo; the replay honors the as-of-date resolution.
	add("elo settings change mid-history", func() ReplayInput {
		in := base(tenantArenaDoc, []ReplayMatch{
			{ID: m1, Date: goldenDate("2025-06-01T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
			{ID: m2, Date: goldenDate("2025-06-10T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
		})
		in.EloSettingsHistory = []EloSettingsEntry{
			goldenEloSettings(goldenEpoch, 32, 400, 1000, 1),
			goldenEloSettings(goldenDate("2025-06-05T00:00:00Z"), 24, 400, 1200, 1),
		}
		return in
	}())

	// Frozen market settlements interleave into the chain after same-date
	// matches: the pC-only row shifts the chain without belonging to a match.
	add("frozen market settlements", func() ReplayInput {
		in := base(tenantArenaDoc, []ReplayMatch{
			{ID: m1, Date: goldenDate("2025-06-01T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
			{ID: m2, Date: goldenDate("2025-06-10T10:00:00Z"), Scores: map[string]float64{pA.String(): 5, pB.String(): 10}},
		})
		loser := mustID(t, "mkt", "018f6b4a-0000-7000-8000-000000000009")
		in.MarketSettlements = []FrozenSettlement{{
			ID: loser, PlayerID: pB, Date: goldenDate("2025-06-01T10:00:00Z"),
			RatingAfter: 990, EloAfter: 990,
			RatingStaked: -10, RatingEarned: 0, EloStaked: -10, EloEarned: 0,
		}}
		return in
	}())

	// Elite promotion then stale demotion: pA plays the matches_6m/2m counts
	// into elite early, then the late snapshot times see the demotion (the
	// week-ago standings still count the old matches; now does not).
	add("elite promotion and stale demotion", func() ReplayInput {
		matches := make([]ReplayMatch, 0, 22)
		day := goldenEpoch.AddDate(0, 0, 0)
		for i := 0; i < 21; i++ {
			mid := mustID(t, "mm", "018f6c00-0000-7000-8000-"+padUint64(uint64(i+1), 12))
			matches = append(matches, ReplayMatch{
				ID: mid, Date: day,
				Scores: map[string]float64{pA.String(): 10, pB.String(): 5, pC.String(): 3},
			})
			day = day.Add(24 * time.Hour)
		}
		in := base(gameArenaDoc, matches)
		in.SnapshotTimes = []time.Time{goldenNow.AddDate(0, 0, -40), goldenNow}
		return in
	}())

	// Historical snapshots cut the chain: a match after the day-ago point
	// shows in `now` standings only; the week-ago point predates everything.
	add("snapshot times cut the chain", base(tenantArenaDoc, []ReplayMatch{
		{ID: m1, Date: goldenDate("2025-06-05T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
		{ID: m2, Date: goldenDate("2025-06-14T10:00:00Z"), Scores: map[string]float64{pA.String(): 10, pB.String(): 5}},
	}))

	// Empty arena: no matches, empty standings at every snapshot.
	add("empty arena", base(tenantArenaDoc, nil))

	return cases
}

func padUint64(v uint64, width int) string {
	s := ""
	for i := 0; i < width; i++ {
		s = string(rune('0'+v%10)) + s
		v /= 10
	}
	return s
}

// TestGoldenFixtures verifies the settlement core against the committed
// fixtures (or regenerates them under ELO_UPDATE_GOLDEN=1).
func TestGoldenFixtures(t *testing.T) {
	cases := goldenCases(t)
	path := filepath.Join(envWorkDir(t), goldenFixtureRelPath)

	if os.Getenv("ELO_UPDATE_GOLDEN") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		data, err := json.MarshalIndent(goldenFile{Version: 1, Cases: cases}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s (%d cases)", path, len(cases))
		return
	}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("no golden fixtures at %s yet — run `make golden` to generate", path)
	}
	if err != nil {
		t.Fatal(err)
	}
	var file goldenFile
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("corrupt golden file: %v", err)
	}
	if len(file.Cases) != len(cases) {
		t.Fatalf("golden file has %d cases, generator defines %d — regenerate with `make golden`", len(file.Cases), len(cases))
	}
	for i, tc := range cases {
		if file.Cases[i].Name != tc.Name {
			t.Fatalf("case %d: golden name %q, generator %q — regenerate", i, file.Cases[i].Name, tc.Name)
		}
		got, err := ReplayArena(tc.Input)
		if err != nil {
			t.Fatalf("%s: replay failed: %v", tc.Name, err)
		}
		wantJSON, _ := json.Marshal(file.Cases[i].Output)
		gotJSON, _ := json.Marshal(got)
		if string(wantJSON) != string(gotJSON) {
			t.Errorf("%s: output drifted from the committed golden — regenerate with `make golden` if the change is deliberate", tc.Name)
		}
	}
}

func envWorkDir(t *testing.T) string {
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return dir
}
