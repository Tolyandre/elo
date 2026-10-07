//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

func slotAt(t *testing.T, br *bracketJSON, roundIdx int, pos int) *struct {
	Id       string
	GameId   string
	Position int
	Advance  int
	MinScore float64
	Status   string
	Seats    []struct {
		Position     int     `json:"position"`
		PlayerId     *string `json:"player_id"`
		SourceSlotId *string `json:"source_slot_id"`
		SourcePlace  *int    `json:"source_place"`
	}
	Matches []struct {
		MatchId string `json:"match_id"`
		Scores  []struct {
			PlayerId string  `json:"player_id"`
			Points   float64 `json:"points"`
		} `json:"scores"`
	} `json:"matches"`
	Standings []struct {
		PlayerId string  `json:"player_id"`
		Points   float64 `json:"points"`
		Place    int     `json:"place"`
		Advanced bool    `json:"advanced"`
	} `json:"standings"`
	Ruling *[]string `json:"ruling_player_ids"`
} {
	t.Helper()
	slot := br.Data.Rounds[roundIdx].Slots[pos]
	return &struct {
		Id       string
		GameId   string
		Position int
		Advance  int
		MinScore float64
		Status   string
		Seats    []struct {
			Position     int     `json:"position"`
			PlayerId     *string `json:"player_id"`
			SourceSlotId *string `json:"source_slot_id"`
			SourcePlace  *int    `json:"source_place"`
		}
		Matches []struct {
			MatchId string `json:"match_id"`
			Scores  []struct {
				PlayerId string  `json:"player_id"`
				Points   float64 `json:"points"`
			} `json:"scores"`
		} `json:"matches"`
		Standings []struct {
			PlayerId string  `json:"player_id"`
			Points   float64 `json:"points"`
			Place    int     `json:"place"`
			Advanced bool    `json:"advanced"`
		} `json:"standings"`
		Ruling *[]string `json:"ruling_player_ids"`
	}{
		Id: slot.Id, GameId: slot.GameId, Position: slot.Position, Advance: slot.Advance, MinScore: slot.MinScore,
		Status: slot.Status, Seats: slot.Seats, Matches: slot.Matches, Standings: slot.Standings,
		Ruling: slot.Ruling,
	}
}

// seatPlayer returns the drawn player of a round-1 seat position (base58).
func seatPlayer(t *testing.T, br *bracketJSON, roundIdx, pos, seatPos int) string {
	t.Helper()
	p := br.Data.Rounds[roundIdx].Slots[pos].Seats[seatPos].PlayerId
	if p == nil {
		t.Fatalf("round %d slot %d seat %d has no drawn player", roundIdx, pos, seatPos)
	}
	return *p
}

func getBracket(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, tid string) *bracketJSON {
	t.Helper()
	w := doJSON(t, router, http.MethodGet, "/tournaments/"+tid+"/bracket", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket: %d %s", w.Code, w.Body.String())
	}
	var br bracketJSON
	if err := json.Unmarshal(w.Body.Bytes(), &br); err != nil {
		t.Fatalf("decode bracket: %v", err)
	}
	return &br
}

const flagshipPlanBody = `{"plan":{"elimination":"single","rounds":[
	{"track":"winners","index":1,"advance":2,"slots":[
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
	{"track":"final","index":1,"advance":1,"slots":[
		{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`

// TestTournament_SingleElimEndToEnd is the ADR-26 rollout's flagship: an
// 8-player single-elimination on a 4-seat-only pool (4+4 advance-2 → final 4
// advance-1) including a slot that needed a replay (shared top game score in
// the first match → no strict cut → the same table plays again).
func TestTournament_StartMaterializesBracket(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Стартовая игра")

	tid := newID(t)
	var ids []string
	players := make([]idpkg.ID, 0, 8)
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Стартер%d", i))
		players = append(players, p)
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Стартовый кубок", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// A hand-forged plan (advance 3 against 4-seat tables is fine per bounds,
	// but this shape leaves 3 players output where the final needs 4 — not
	// offered by the enumerator) must be rejected.
	handForged := `{"elimination":"single","rounds":[
		{"track":"winners","index":1,"advance":3,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
		{"track":"final","index":1,"advance":1,"slots":[
			{"seat_count":6,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":0,"source_place":3},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2},{"kind":"source","source_slot":1,"source_place":3}]}]}]}`
	w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":`+handForged+`}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("hand-forged plan must 400, got %d %s", w.Code, w.Body.String())
	}

	// The flagship plan goes through.
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"winners","index":1,"advance":2,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
		{"track":"final","index":1,"advance":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	// A second start is a 409.
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":{"elimination":"single","rounds":[
		{"track":"winners","index":1,"advance":2,"slots":[
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
			{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
		{"track":"final","index":1,"advance":1,"slots":[
			{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("second start must 409, got %d", w.Code)
	}

	// The bracket: round 1 fully drawn and playing, the final waiting on
	// sources, the tournament's own game on every slot.
	w = doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket: %d %s", w.Code, w.Body.String())
	}
	var br bracketJSON
	if err := json.Unmarshal(w.Body.Bytes(), &br); err != nil {
		t.Fatalf("decode bracket: %v", err)
	}
	if br.Data.Status != "running" || br.Data.Elimination != "single" || len(br.Data.Rounds) != 2 {
		t.Fatalf("bracket head: %+v", br.Data)
	}
	r1 := br.Data.Rounds[0]
	if r1.Track != "winners" || len(r1.Slots) != 2 {
		t.Fatalf("round 1: %+v", r1)
	}
	seen := map[string]bool{}
	for _, slot := range r1.Slots {
		if slot.Status != "playing" || slot.GameId != short(gameID) || slot.Advance != 2 {
			t.Fatalf("round-1 slot: %+v", slot)
		}
		for _, seat := range slot.Seats {
			if seat.PlayerId == nil || seat.SourceSlotId != nil {
				t.Fatalf("round-1 seat must be drawn: %+v", seat)
			}
			seen[*seat.PlayerId] = true
		}
	}
	if len(seen) != 8 {
		t.Fatalf("the draw must seat all 8 participants exactly once, got %d distinct", len(seen))
	}
	final := br.Data.Rounds[1]
	if final.Track != "final" || len(final.Slots) != 1 || len(final.Slots[0].Seats) != 4 {
		t.Fatalf("final: %+v", final)
	}
	for _, seat := range final.Slots[0].Seats {
		if seat.PlayerId != nil || seat.SourceSlotId == nil || seat.SourcePlace == nil {
			t.Fatalf("final seats must wait on sources: %+v", seat)
		}
	}

	// The tournament arena exists and is anchored to the tournament.
	var arenaName string
	if err := pool.QueryRow(context.Background(),
		`SELECT a.name FROM arenas a WHERE a.tournament_id = $1`, tid).Scan(&arenaName); err != nil {
		t.Fatalf("tournament arena: %v", err)
	}
	w = doJSON(t, router, http.MethodGet, "/arenas?tournament_id="+short(tid), "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("arenas?tournament_id: %d %s", w.Code, w.Body.String())
	}

	// Audit: a tournament-start document with the plan, seed, participants.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	if len(page.Data) == 0 {
		t.Fatalf("no audit rows for the tournament")
	}
	var startDetails struct {
		Plan           json.RawMessage `json:"plan"`
		Seed           int64           `json:"seed"`
		ParticipantIds []string        `json:"participant_ids"`
	}
	found := false
	for _, e := range page.Data {
		if e.Details == nil {
			continue
		}
		if err := json.Unmarshal(e.Details, &startDetails); err == nil && startDetails.Seed != 0 && len(startDetails.ParticipantIds) == 8 {
			found = true
			var planDoc map[string]any
			if err := json.Unmarshal(startDetails.Plan, &planDoc); err != nil || planDoc["elimination"] != "single" {
				t.Fatalf("start details plan: %v %v", err, planDoc["elimination"])
			}
		}
	}
	if !found {
		t.Fatalf("no tournament-start details document found")
	}

	// Cancel from running works and is audited with reason "organizer".
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/cancel", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}
	var stateDetails struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Reason string `json:"reason"`
	}
	found = false
	for _, e := range listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid)).Data {
		if e.Details == nil {
			continue
		}
		if err := json.Unmarshal(e.Details, &stateDetails); err == nil && stateDetails.Reason == "organizer" && stateDetails.To == "cancelled" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no tournament-state cancelled document")
	}
	_ = players
}

// TestTournament_StartCarriedWinner pins the reported regression: 6 players on
// a strict 2-seat pool — round 2 seats two of the three round-1 winners, the
// third waits that round and plays the grand final. The listed plan must feed
// the final from round-1 slot 3 (a source seat, not an anonymous bye), and the
// start must materialize without overdrawing the seeded draw (the anonymized
// bye used to draw a seventh participant and panic 500).
func TestTournament_StartByeRemainder(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Двойки")

	tid := newID(t)
	var ids []string
	for i := 0; i < 5; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Парник%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок двоек", "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// The shape picker's list for this setup: exactly one single-elim plan —
	// 2+2 with a round-1 bye that waits through round 2 and starts in the
	// grand final (a not-yet-played player may wait; a played one may not).
	w := doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans?elimination=single", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("bracket-plans: %d %s", w.Code, w.Body.String())
	}
	var listed struct {
		Data struct {
			Plans []json.RawMessage `json:"plans"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode plans: %v", err)
	}
	if len(listed.Data.Plans) != 1 {
		t.Fatalf("5/{{2,2}} single must offer exactly 1 plan, got %d", len(listed.Data.Plans))
	}

	// Regression guard for the start draw: draw + bye seats must number the
	// participant count exactly (this start used to panic with index out of
	// range when seat provenance drifted).
	w = doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, fmt.Sprintf(`{"plan":%s}`, listed.Data.Plans[0]))
	if w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	br := getBracket(t, router, short(tid))
	if len(br.Data.Rounds) != 3 {
		t.Fatalf("rounds: %d", len(br.Data.Rounds))
	}
	r1, r2, final := br.Data.Rounds[0], br.Data.Rounds[1], br.Data.Rounds[2]
	if len(r1.Slots) != 2 || len(r2.Slots) != 1 || len(final.Slots) != 1 || final.Track != "final" {
		t.Fatalf("shape: %+v %+v %+v", r1, r2, final)
	}

	// The draw seats 4 participants in round 1; the 5th waits as the bye.
	seen := map[string]bool{}
	for _, slot := range r1.Slots {
		if slot.Status != "playing" {
			t.Fatalf("round-1 slot must play: %+v", slot)
		}
		for _, seat := range slot.Seats {
			if seat.PlayerId == nil || seat.SourceSlotId != nil {
				t.Fatalf("round-1 seat must be drawn: %+v", seat)
			}
			seen[*seat.PlayerId] = true
		}
	}
	if len(seen) != 4 {
		t.Fatalf("round 1 must seat 4 distinct participants, got %d", len(seen))
	}

	// Round 2 seats exactly the two round-1 winners — no waiting survivor.
	if r2.Slots[0].Status != "waiting" {
		t.Fatalf("round 2 must wait: %+v", r2.Slots[0])
	}
	r2Sources := map[string]bool{}
	for _, seat := range r2.Slots[0].Seats {
		if seat.PlayerId != nil || seat.SourceSlotId == nil {
			t.Fatalf("round-2 seat must wait on a source: %+v", seat)
		}
		r2Sources[*seat.SourceSlotId] = true
	}
	if len(r2Sources) != 2 || !r2Sources[r1.Slots[0].Id] || !r2Sources[r1.Slots[1].Id] {
		t.Fatalf("round 2 must be fed by both round-1 slots: %+v", r2.Slots[0].Seats)
	}

	// The grand final waits on the round-2 winner and seats the bye — the
	// participant who has not played yet starts right here.
	finalBye := 0
	for _, seat := range final.Slots[0].Seats {
		if seat.SourceSlotId != nil {
			continue
		}
		if seat.PlayerId == nil {
			t.Fatalf("final bye seat must be drawn: %+v", seat)
		}
		finalBye++
		seen[*seat.PlayerId] = true
	}
	if finalBye != 1 {
		t.Fatalf("the final must seat exactly one bye seat, got %d: %+v", finalBye, final.Slots[0].Seats)
	}
	if len(seen) != 5 {
		t.Fatalf("the draw must seat all 5 participants exactly once, got %d distinct", len(seen))
	}
}

// ---------------------------------------------------------------------------
// Phase 5: acceptance, placement points, completion
// ---------------------------------------------------------------------------

// matchIDsOf returns the linked match ids of one bracket slot from the wire.
func TestTournament_SingleElimEndToEnd(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Флажная игра")

	tid := newID(t)
	var ids []string
	players := make([]idpkg.ID, 0, 8)
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Финалист%d", i))
		players = append(players, p)
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Кубок флажков", "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, flagshipPlanBody); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	br := getBracket(t, router, short(tid))
	if len(br.Data.Rounds) != 2 {
		t.Fatalf("rounds: %d", len(br.Data.Rounds))
	}

	// Table A (round 1, position 1) — first match ends with a shared top
	// score → 5–5–0–0 (tenths), no strict cut, the slot replays.
	aSeat := func(i int) string { return seatPlayer(t, br, 0, 0, i) }
	newMatch := func(mdate string, scores ...string) string {
		mid := newID(t)
		body := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": %q, "score": {%s}}`,
			short(mid), short(gameID), mdate, strings.Join(scores, ","))
		if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
			t.Fatalf("post match: %d %s", w.Code, w.Body.String())
		}
		return short(mid)
	}
	sc := func(pid string, v float64) string { return fmt.Sprintf(`%q:%v`, pid, v) }

	// Match 1: shared top → the slot must stay playing with no advancements.
	m1 := newMatch(matchDate(4, 0), sc(aSeat(0), 10), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	br = getBracket(t, router, short(tid))
	slotA := slotAt(t, br, 0, 0)
	if slotA.Status != "playing" {
		t.Fatalf("slot A must still be playing after a tied match: %s", slotA.Status)
	}
	if len(slotA.Matches) != 1 || slotA.Matches[0].MatchId != m1 {
		t.Fatalf("slot A matches: %+v", slotA.Matches)
	}
	// Live standings show the 1.0-1.0-0.1-0 shares (equal points share the
	// rank) while the slot replays; the advanced flags stay off and the final
	// seat stays unfilled.
	if len(slotA.Standings) != 4 || slotA.Standings[0].Points != 1 || slotA.Standings[1].Points != 1 ||
		slotA.Standings[2].Points != 0.1 || slotA.Standings[3].Points != 0 ||
		slotA.Standings[0].Place != 1 || slotA.Standings[1].Place != 1 || slotA.Standings[2].Place != 3 ||
		slotA.Standings[0].Advanced || slotA.Standings[1].Advanced ||
		br.Data.Rounds[1].Slots[0].Seats[0].PlayerId != nil {
		t.Fatalf("tied match: live standings but no advancement: %+v", slotA.Standings)
	}

	// The match DTO carries the tournament badge.
	w := doJSON(t, router, http.MethodGet, "/matches/"+m1, "", "")
	var matchResp struct {
		Data struct {
			Tournament *struct {
				Id     string `json:"id"`
				Name   string `json:"name"`
				SlotId string `json:"slot_id"`
			} `json:"tournament"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &matchResp); err != nil {
		t.Fatalf("decode match: %v", err)
	}
	if matchResp.Data.Tournament == nil || matchResp.Data.Tournament.Id != short(tid) || matchResp.Data.Tournament.SlotId != slotA.Id {
		t.Fatalf("match badge: %+v", matchResp.Data.Tournament)
	}

	// Match 2 (the replay): seat1 takes a decisive win → cumulative
	// 2.0–1.5–0.2–0 → strict top-2.
	newMatch(matchDate(4, 1), sc(aSeat(0), 5), sc(aSeat(1), 10), sc(aSeat(2), 1), sc(aSeat(3), 0))
	br = getBracket(t, router, short(tid))
	slotA = slotAt(t, br, 0, 0)
	if slotA.Status != "completed" || len(slotA.Matches) != 2 {
		t.Fatalf("slot A after the replay: %s with %d matches", slotA.Status, len(slotA.Matches))
	}
	// Standings (shares): 2.0–1.5–0.2–0, advanced {seat1, seat0}.
	if len(slotA.Standings) != 4 || slotA.Standings[0].PlayerId != aSeat(1) || slotA.Standings[1].PlayerId != aSeat(0) ||
		!slotA.Standings[0].Advanced || !slotA.Standings[1].Advanced || slotA.Standings[0].Points != 2 || slotA.Standings[1].Points != 1.5 {
		t.Fatalf("slot A standings: %+v", slotA.Standings)
	}

	// Table B: a decisive first match completes the slot immediately.
	bSeat := func(i int) string { return seatPlayer(t, br, 0, 1, i) }
	newMatch(matchDate(4, 2), sc(bSeat(0), 10), sc(bSeat(1), 2), sc(bSeat(2), 1), sc(bSeat(3), 0))
	br = getBracket(t, router, short(tid))
	slotB := slotAt(t, br, 0, 1)
	if slotB.Status != "completed" {
		t.Fatalf("slot B must complete on a strict cut: %s", slotB.Status)
	}

	// The final's seat caches are refilled with the advanced players.
	finalSeats := br.Data.Rounds[1].Slots[0].Seats
	gotFinal := map[string]bool{}
	for _, seat := range finalSeats {
		if seat.PlayerId == nil {
			t.Fatalf("final seat not refilled: %+v", seat)
		}
		gotFinal[*seat.PlayerId] = true
	}
	if len(gotFinal) != 4 || !gotFinal[aSeat(1)] || !gotFinal[aSeat(0)] || !gotFinal[bSeat(0)] || !gotFinal[bSeat(1)] {
		t.Fatalf("final participants: %v", gotFinal)
	}

	// The grand final: one match with a strict cut crowns the champion.
	finalDate := matchDate(3, 0)
	newMatch(finalDate, sc(aSeat(1), 10), sc(bSeat(0), 6), sc(aSeat(0), 2), sc(bSeat(1), 0))
	br = getBracket(t, router, short(tid))
	if br.Data.Status != "completed" {
		t.Fatalf("tournament must be completed, got %s", br.Data.Status)
	}
	if br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId != aSeat(1) {
		t.Fatalf("winner: %v", br.Data.WinnerPlayerId)
	}

	// The tournament arena counts the matches (rating and medals for free).
	var arenaID idpkg.ID
	if err := pool.QueryRow(context.Background(),
		`SELECT id FROM arenas WHERE tournament_id = $1`, tid).Scan(&arenaID); err != nil {
		t.Fatalf("arena lookup: %v", err)
	}
	w = doJSON(t, router, http.MethodGet, "/arenas/"+short(arenaID)+"/players", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("arena players: %d %s", w.Code, w.Body.String())
	}
	var arenaPlayers struct {
		Data []struct {
			PlayerId     string `json:"player_id"`
			MatchesCount int    `json:"matches_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &arenaPlayers); err != nil {
		t.Fatalf("decode arena players: %v", err)
	}
	if len(arenaPlayers.Data) != 8 {
		t.Fatalf("arena must count all 8 players, got %d", len(arenaPlayers.Data))
	}

	// Feed match cards carry the tournament badge too (the match card's link
	// to the bracket slot).
	w = doJSON(t, router, http.MethodGet, "/arenas/"+short(arenaID)+"/feed?limit=1", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("arena feed: %d %s", w.Code, w.Body.String())
	}
	var arenaFeed struct {
		Data []struct {
			Type string `json:"type"`
			Data struct {
				Tournament *struct {
					Id string `json:"id"`
				} `json:"tournament"`
			} `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &arenaFeed); err != nil {
		t.Fatalf("decode arena feed: %v", err)
	}
	if len(arenaFeed.Data) == 0 || arenaFeed.Data[0].Type != "match" || arenaFeed.Data[0].Data.Tournament == nil ||
		arenaFeed.Data[0].Data.Tournament.Id != short(tid) {
		t.Fatalf("feed match must carry the tournament badge: %+v", arenaFeed.Data)
	}

	// Audit: six slot-link attaches + the state documents.
	page := listAudit(t, router, "?entity_type=tournament&entity_id="+short(tid))
	attaches, states := 0, 0
	for _, e := range page.Data {
		if e.Details == nil {
			continue
		}
		var d map[string]any
		if err := json.Unmarshal(e.Details, &d); err != nil {
			continue
		}
		if d["op"] == "attach" {
			attaches++
		}
		if d["reason"] == "grand-final" {
			states++
		}
	}
	if attaches != 4 || states != 1 {
		t.Fatalf("audit: %d attaches, %d grand-final states (want 4, 1)", attaches, states)
	}
}

// TestTournament_MatchSkipAndNonFit covers the acceptance opt-outs: the
// explicit skip flag keeps a fitting match out of the bracket, and a
// non-fitting roster never links.
func TestTournament_WBLBRunWithMerge(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	admin, _ := createTestUserWithID(t, pool, true)
	gameID := createTestGame(t, pool, "Парный дедлайн")

	tid := newID(t)
	var ids []string
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("Дабл%d", i))
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": "Дабл-кубок", "games": [{"game_id": %q, "min_players": 2, "max_players": 2}], "participant_ids": [%s]}`,
		short(tid), short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/clubs/00000000-0000-0000-0000-000000000001/tournaments", admin, createBody); w.Code != http.StatusOK {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// The plans endpoint offers double-elimination shapes; take the head
	// (fewest rounds) and submit it verbatim.
	w := doJSON(t, router, http.MethodGet, "/tournaments/"+short(tid)+"/bracket-plans", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("plans: %d %s", w.Code, w.Body.String())
	}
	var plans bracketPlansJSON
	if err := json.Unmarshal(w.Body.Bytes(), &plans); err != nil {
		t.Fatalf("decode plans: %v", err)
	}
	if len(plans.Data.Plans) == 0 {
		t.Fatalf("no plans offered")
	}
	// Take the first plan that actually runs the losers track (the
	// fewest-rounds head may be the valid pause-the-LB-forever variant).
	var chosen map[string]any
	for _, p := range plans.Data.Plans {
		hasLosers := false
		for _, r := range p.Rounds {
			if r.Track == "losers" {
				hasLosers = true
			}
		}
		if hasLosers {
			chosen = mustPlanMap(t, p)
			break
		}
	}
	if chosen == nil {
		t.Fatalf("no plan with a losers track offered")
	}
	planRaw, err := json.Marshal(chosen)
	if err != nil {
		t.Fatalf("encode plan: %v", err)
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", admin, `{"plan":`+string(planRaw)+`}`); w.Code != http.StatusOK {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}

	// Driver: play every fully-seated playing slot (distinct scores → strict
	// cut for any advance count), then repeat until the champion emerges.
	gameShort := short(gameID)
	mday := 10
	for round := 0; ; round++ {
		if round > 30 {
			t.Fatalf("the bracket did not finish playing")
		}
		br := getBracket(t, router, short(tid))
		if br.Data.Status == "completed" {
			if br.Data.WinnerPlayerId == nil || *br.Data.WinnerPlayerId == "" {
				t.Fatalf("completed without a champion")
			}
			var hasLosers bool
			for _, r := range br.Data.Rounds {
				if r.Track == "losers" {
					hasLosers = true
				}
			}
			if !hasLosers {
				t.Fatalf("double-elimination bracket without a losers track")
			}
			break
		}
		played := 0
		for _, r := range br.Data.Rounds {
			for _, slot := range r.Slots {
				if slot.Status != "playing" || len(slot.Matches) > 0 {
					continue
				}
				seated := true
				var scores []string
				v := float64(len(slot.Seats)) * 10
				for _, seat := range slot.Seats {
					if seat.PlayerId == nil {
						seated = false
						break
					}
					scores = append(scores, fmt.Sprintf(`%q:%v`, *seat.PlayerId, v))
					v -= 3
				}
				if !seated {
					continue
				}
				mid := short(newID(t))
				// Dates walk backwards from now, staying inside the 30-day
				// window the match-write validation allows.
				mdate := time.Now().UTC().Add(-time.Duration(mday) * 24 * time.Hour).Truncate(time.Second).Format(time.RFC3339)
				body := fmt.Sprintf(`{"id": %q, "game_id": %q, "date": %q, "score": {%s}}`,
					mid, gameShort, mdate, strings.Join(scores, ","))
				if w := doJSON(t, router, http.MethodPost, "/matches", admin, body); w.Code != http.StatusOK {
					t.Fatalf("driver match: %d %s", w.Code, w.Body.String())
				}
				mday++
				if mday > 20 {
					mday = 1
				}
				played++
			}
		}
		if played == 0 {
			t.Fatalf("no playable slot and the tournament is not completed: %+v", br.Data)
		}
	}
}

// mustPlanMap converts a decoded plan object to a generic map for verbatim
// resubmission.
func mustPlanMap(t *testing.T, p any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("re-encode plan: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("decode plan: %v", err)
	}
	return m
}
