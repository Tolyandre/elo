//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/elo"
	idpkg "github.com/tolyandre/elo-web-service/pkg/id"
)

// finalOnlyPlan is the minimal bracket: a single final slot seating all four
// participants directly; one match with a strict top-1 crowns the champion.
const finalOnlyPlan = `{"plan":{"elimination":"single","rounds":[
	{"track":"final","index":1,"advance":1,"slots":[
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]}]}}`

// startFinalOnlyTournament creates a 4-player tournament whose bracket is a
// single final slot and starts it. Returns the game, the tournament id, and
// the seated players in seat order.
func startFinalOnlyTournament(t *testing.T, pool *pgxpool.Pool, adminToken string, name string) (gameID, tid idpkg.ID, players []idpkg.ID) {
	t.Helper()
	router := setupRouter(pool)
	gameID = createTestGame(t, pool, name+" game")

	tid = newID(t)
	players = make([]idpkg.ID, 0, 4)
	ids := make([]string, 0, 4)
	for i := 0; i < 4; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("%s-%d", name, i))
		players = append(players, p)
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": %q, "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), name, short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", adminToken, createBody); w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", adminToken, finalOnlyPlan); w.Code != http.StatusOK {
		t.Fatalf("start tournament: %d %s", w.Code, w.Body.String())
	}

	// Report the seated order (the draw shuffles the participants).
	br := getBracket(t, router, short(tid))
	byShort := make(map[string]idpkg.ID, len(players))
	for _, p := range players {
		byShort[short(p)] = p
	}
	seated := make([]idpkg.ID, 0, len(players))
	for _, seat := range br.Data.Rounds[0].Slots[0].Seats {
		if seat.PlayerId == nil {
			t.Fatalf("final seat not drawn: %+v", seat)
		}
		seated = append(seated, byShort[*seat.PlayerId])
	}
	return gameID, tid, seated
}

// finalSlotID returns the bracket's single final slot id.
func finalSlotID(t *testing.T, router interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}, tid idpkg.ID) string {
	t.Helper()
	br := getBracket(t, router, short(tid))
	return br.Data.Rounds[0].Slots[0].Id
}

// winnersFinalPlan brackets 8 players into two 4-seat winners slots (advance 2)
// whose top-2 feed a 4-seat final (advance 1) — the multi-round shape whose
// early-round replays must not settle a tournament_winner market.
const winnersFinalPlan = `{"plan":{"elimination":"single","rounds":[
	{"track":"winners","index":1,"advance":2,"slots":[
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]},
		{"seat_count":4,"seats":[{"kind":"draw"},{"kind":"draw"},{"kind":"draw"},{"kind":"draw"}]}]},
	{"track":"final","index":1,"advance":1,"slots":[
		{"seat_count":4,"seats":[{"kind":"source","source_slot":0,"source_place":1},{"kind":"source","source_slot":0,"source_place":2},{"kind":"source","source_slot":1,"source_place":1},{"kind":"source","source_slot":1,"source_place":2}]}]}]}}`

// startWinnersFinalTournament creates an 8-player tournament with two winners
// slots feeding a final and starts it. Returns the game, the tournament id,
// and each winners slot's seated players (slot order).
func startWinnersFinalTournament(t *testing.T, pool *pgxpool.Pool, adminToken string, name string) (gameID, tid idpkg.ID, semis [][]idpkg.ID) {
	t.Helper()
	router := setupRouter(pool)
	gameID = createTestGame(t, pool, name+" game")

	tid = newID(t)
	players := make([]idpkg.ID, 0, 8)
	ids := make([]string, 0, 8)
	for i := 0; i < 8; i++ {
		p := createTestPlayer(t, pool, fmt.Sprintf("%s-%d", name, i))
		players = append(players, p)
		ids = append(ids, fmt.Sprintf("%q", short(p)))
	}
	createBody := fmt.Sprintf(`{"id": %q, "name": %q, "games": [{"game_id": %q, "min_players": 4, "max_players": 4}], "participant_ids": [%s]}`,
		short(tid), name, short(gameID), strings.Join(ids, ","))
	if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/tournaments", adminToken, createBody); w.Code != http.StatusOK {
		t.Fatalf("create tournament: %d %s", w.Code, w.Body.String())
	}
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/start", adminToken, winnersFinalPlan); w.Code != http.StatusOK {
		t.Fatalf("start tournament: %d %s", w.Code, w.Body.String())
	}

	// Report each winners slot's seated order (the draw shuffles participants).
	br := getBracket(t, router, short(tid))
	byShort := make(map[string]idpkg.ID, len(players))
	for _, p := range players {
		byShort[short(p)] = p
	}
	for _, slot := range br.Data.Rounds[0].Slots {
		seated := make([]idpkg.ID, 0, 4)
		for _, seat := range slot.Seats {
			if seat.PlayerId == nil {
				t.Fatalf("winners seat not drawn: %+v", seat)
			}
			seated = append(seated, byShort[*seat.PlayerId])
		}
		semis = append(semis, seated)
	}
	if len(semis) != 2 {
		t.Fatalf("winners slots = %d, want 2", len(semis))
	}
	return gameID, tid, semis
}

// createTournamentWinnerMarket creates the market on a running tournament and
// backs it with a sole zero-fee guarantor so it becomes tradable.
func createTournamentWinnerMarket(t *testing.T, ctx context.Context, pool *pgxpool.Pool, adminID idpkg.ID, tid idpkg.ID, participants []idpkg.ID) (*elo.MarketService, db.Market) {
	t.Helper()
	marketSvc := elo.NewMarketService(pool)
	market, err := marketSvc.CreateMarket(ctx, elo.CreateMarketParams{
		TenantID:         blueMenTenantID,
		ID:               newID(t),
		MarketType:       "tournament_winner",
		StartsAt:         time.Now().Add(-time.Minute),
		CreatedBy:        adminID,
		TournamentWinner: &elo.TournamentWinnerCreateParams{TournamentID: tid},
	})
	if err != nil {
		t.Fatalf("CreateMarket(tournament_winner): %v", err)
	}

	// The outcomes are exactly the tournament's participants — one "player"
	// outcome each, no "other".
	outcomes, err := marketSvc.Queries.ListMarketOutcomes(ctx, market.ID)
	if err != nil {
		t.Fatalf("ListMarketOutcomes: %v", err)
	}
	if len(outcomes) != len(participants) {
		t.Fatalf("outcomes = %d, want %d (one per participant)", len(outcomes), len(participants))
	}
	seen := make(map[idpkg.ID]bool, len(participants))
	for _, o := range outcomes {
		if o.Kind != "player" || o.PlayerID == nil || !containsID(participants, *o.PlayerID) {
			t.Fatalf("unexpected outcome %+v", o)
		}
		seen[*o.PlayerID] = true
	}
	if len(seen) != len(participants) {
		t.Fatalf("outcome players = %d, want %d distinct", len(seen), len(participants))
	}
	return marketSvc, market
}

func containsID(ids []idpkg.ID, want idpkg.ID) bool {
	for _, v := range ids {
		if v == want {
			return true
		}
	}
	return false
}

// playMatch adds a tournament match through the service (acceptance links it
// to the final slot) and returns the match.
func playMatch(t *testing.T, ctx context.Context, pool *pgxpool.Pool, gameID idpkg.ID, date time.Time, scores map[idpkg.ID]float64) db.Match {
	t.Helper()
	matchSvc := newMatchService(pool)
	m, err := matchSvc.AddMatch(ctx, gameID, scores, date, newMatchOpts(t))
	if err != nil {
		t.Fatalf("AddMatch: %v", err)
	}
	return m
}

func tournamentWinnerMarketSetups(t *testing.T) (*pgxpool.Pool, func(), context.Context, idpkg.ID, idpkg.ID, idpkg.ID, []idpkg.ID) {
	pool, cleanup := setupTestDB(t)
	ctx := context.Background()
	adminToken, _ := createTestUserWithID(t, pool, true)
	adminID := createTestAdmin(t, pool)
	gameID, tid, players := startFinalOnlyTournament(t, pool, adminToken, "Рыночный кубок")
	_ = gameID
	return pool, cleanup, ctx, adminID, tid, gameID, players
}

// TestTournamentWinnerMarket_CompletesWithDeterminingMatch: a market on a
// running tournament resolves when the grand final crowns the champion; the
// resolution carries the determining match and settles at its date.
func TestTournamentWinnerMarket_CompletesWithDeterminingMatch(t *testing.T) {
	pool, cleanup, ctx, adminID, tid, gameID, players := tournamentWinnerMarketSetups(t)
	defer cleanup()

	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, players)

	guarantor := createTestPlayer(t, pool, "Рыночный поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	setBetLimit(t, pool, blueMenTenantID, players[0], 16)
	setBetLimit(t, pool, blueMenTenantID, players[1], 16)

	outcome0 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[0])
	outcome1 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[1])
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[0], outcome0, 1); err != nil {
		t.Fatalf("PlaceBet players[0]: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[1], outcome1, 1); err != nil {
		t.Fatalf("PlaceBet players[1]: %v", err)
	}

	gfDate := time.Now().Add(-time.Hour).Truncate(time.Second)
	gf := playMatch(t, ctx, pool, gameID, gfDate, map[idpkg.ID]float64{players[0]: 10, players[1]: 6, players[2]: 2, players[3]: 0})

	// The tournament is completed with the strict top-1 player; the market
	// resolved onto that player's outcome, attached to the grand final.
	var status, winner *string
	if err := pool.QueryRow(ctx, `SELECT status, winner_player_id::text FROM tournaments WHERE id = $1`, tid).Scan(&status, &winner); err != nil {
		t.Fatalf("tournament status: %v", err)
	}
	if status == nil || *status != "completed" || winner == nil || *winner != string(players[0]) {
		t.Fatalf("tournament: status=%v winner=%v", status, winner)
	}

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "resolved" {
		t.Errorf("market status = %q, want resolved", m.Status)
	}
	if m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcome0 {
		t.Errorf("resolution_outcome = %v, want players[0]'s outcome", m.ResolutionOutcome)
	}
	if m.ResolutionMatchID == nil || *m.ResolutionMatchID != gf.ID {
		t.Errorf("resolution_match_id = %v, want the grand final %s", m.ResolutionMatchID, gf.ID)
	}
	if !m.ResolvedAt.Time.Equal(gfDate) {
		t.Errorf("resolved_at = %v, want the grand final date %v", m.ResolvedAt.Time, gfDate)
	}

	// The winner bettor is paid their shares; the loser earns 0.
	shares0 := readBetShares(t, pool, market.ID, players[0])
	if got := playerMarketEarned(t, pool, market.ID, players[0]); math.Abs(got-shares0) > 1e-6 {
		t.Errorf("players[0] earned = %.6f, want shares %.6f", got, shares0)
	}
	if got := playerMarketEarned(t, pool, market.ID, players[1]); math.Abs(got) > 1e-6 {
		t.Errorf("players[1] earned = %.6f, want 0 (loser)", got)
	}

	// Elo stays conserved across buyers + guarantor.
	var deltaSum float64
	rows, err := pool.Query(ctx, `SELECT elo_staked, elo_earned FROM arena_settlements WHERE arena_id = $1 AND market_id = $2`, globalArenaUUID, market.ID)
	if err != nil {
		t.Fatalf("query settlements: %v", err)
	}
	for rows.Next() {
		var staked, earned float64
		if err := rows.Scan(&staked, &earned); err != nil {
			rows.Close()
			t.Fatalf("scan: %v", err)
		}
		deltaSum += staked + earned
	}
	rows.Close()
	if math.Abs(deltaSum) > 1e-6 {
		t.Errorf("market settlement not zero-sum: %.6f", deltaSum)
	}
}

// TestTournamentWinnerMarket_RulingCompletionHasNoMatch: a champion crowned by
// an organizer ruling resolves the market without a resolution match.
func TestTournamentWinnerMarket_RulingCompletionHasNoMatch(t *testing.T) {
	pool, cleanup, ctx, adminID, tid, _, players := tournamentWinnerMarketSetups(t)
	defer cleanup()

	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, players)

	guarantor := createTestPlayer(t, pool, "Регламентный поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	setBetLimit(t, pool, blueMenTenantID, players[0], 16)
	outcome0 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[0])
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[0], outcome0, 1); err != nil {
		t.Fatalf("PlaceBet players[0]: %v", err)
	}

	router := setupRouter(pool)
	adminToken, _ := createTestUserWithID(t, pool, true)
	slotID := finalSlotID(t, router, tid)
	ruling := fmt.Sprintf(`{"player_ids": [%q]}`, short(players[0]))
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/slots/"+slotID+"/ruling", adminToken, ruling); w.Code != http.StatusOK {
		t.Fatalf("ruling: %d %s", w.Code, w.Body.String())
	}

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "resolved" {
		t.Errorf("market status = %q, want resolved", m.Status)
	}
	if m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcome0 {
		t.Errorf("resolution_outcome = %v, want the ruled player's outcome", m.ResolutionOutcome)
	}
	if m.ResolutionMatchID != nil {
		t.Errorf("resolution_match_id = %v, want nil (ruling-decided)", *m.ResolutionMatchID)
	}
	if got := playerMarketEarned(t, pool, market.ID, players[0]); got <= 0 {
		t.Errorf("players[0] earned = %.6f, want a positive payout", got)
	}
}

// TestTournamentWinnerMarket_OrganizerCancelRefunds: cancelling the tournament
// cancels the market and returns every bet.
func TestTournamentWinnerMarket_OrganizerCancelRefunds(t *testing.T) {
	pool, cleanup, ctx, adminID, tid, _, players := tournamentWinnerMarketSetups(t)
	defer cleanup()

	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, players)

	guarantor := createTestPlayer(t, pool, "Отменный поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	setBetLimit(t, pool, blueMenTenantID, players[0], 16)
	setBetLimit(t, pool, blueMenTenantID, players[1], 16)
	outcome0 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[0])
	outcome1 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[1])
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[0], outcome0, 1); err != nil {
		t.Fatalf("PlaceBet players[0]: %v", err)
	}
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[1], outcome1, 1); err != nil {
		t.Fatalf("PlaceBet players[1]: %v", err)
	}
	cost0, cost1 := readBetCost(t, pool, market.ID, players[0]), readBetCost(t, pool, market.ID, players[1])

	router := setupRouter(pool)
	adminToken, _ := createTestUserWithID(t, pool, true)
	if w := doJSON(t, router, http.MethodPost, "/tournaments/"+short(tid)+"/cancel", adminToken, ""); w.Code != http.StatusOK {
		t.Fatalf("cancel: %d %s", w.Code, w.Body.String())
	}

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "cancelled" {
		t.Errorf("market status = %q, want cancelled", m.Status)
	}
	if m.ResolutionOutcome != nil {
		t.Errorf("resolution_outcome = %v, want nil on cancel", *m.ResolutionOutcome)
	}
	if !m.ResolvedAt.Valid {
		t.Errorf("resolved_at must be set on cancel")
	}

	// Every bettor is refunded in full: earned == staked, net zero.
	if got := playerMarketEarned(t, pool, market.ID, players[0]); math.Abs(got-cost0) > 1e-6 {
		t.Errorf("players[0] refund = %.6f, want cost %.6f", got, cost0)
	}
	if got := playerMarketEarned(t, pool, market.ID, players[1]); math.Abs(got-cost1) > 1e-6 {
		t.Errorf("players[1] refund = %.6f, want cost %.6f", got, cost1)
	}
	if got := playerMarketDelta(t, pool, market.ID, players[0]); math.Abs(got) > 1e-6 {
		t.Errorf("players[0] net delta = %.6f, want 0", got)
	}
}

// TestTournamentWinnerMarket_DeadlineCancelRefunds: the grand-final deadline
// auto-cancel takes the market with it (the market has no deadline of its own).
func TestTournamentWinnerMarket_DeadlineCancelRefunds(t *testing.T) {
	pool, cleanup, ctx, adminID, tid, _, players := tournamentWinnerMarketSetups(t)
	defer cleanup()

	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, players)
	guarantor := createTestPlayer(t, pool, "Дедл поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	setBetLimit(t, pool, blueMenTenantID, players[0], 16)
	outcome0 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[0])
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[0], outcome0, 1); err != nil {
		t.Fatalf("PlaceBet players[0]: %v", err)
	}
	cost0 := readBetCost(t, pool, market.ID, players[0])

	// Backdate the deadline; the lazy enforcement on the next bracket read
	// cancels the tournament and must cancel the market too.
	if _, err := pool.Exec(ctx, `UPDATE tournaments SET grand_final_deadline = NOW() - INTERVAL '1 minute' WHERE id = $1`, tid); err != nil {
		t.Fatalf("backdate deadline: %v", err)
	}
	router := setupRouter(pool)
	getBracket(t, router, short(tid))

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "cancelled" {
		t.Fatalf("market status = %q, want cancelled by the deadline cancel", m.Status)
	}
	if got := playerMarketEarned(t, pool, market.ID, players[0]); math.Abs(got-cost0) > 1e-6 {
		t.Errorf("players[0] refund = %.6f, want cost %.6f", got, cost0)
	}
}

// TestTournamentWinnerMarket_RevertOnEdit: rewriting the grand final's scores
// to a tie reverts the completed tournament — the settled market reopens; a
// later deciding match completes the tournament again and re-resolves the
// market with the new champion.
func TestTournamentWinnerMarket_RevertOnEdit(t *testing.T) {
	pool, cleanup, ctx, adminID, tid, gameID, players := tournamentWinnerMarketSetups(t)
	defer cleanup()

	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, players)
	guarantor := createTestPlayer(t, pool, "Каскад поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	setBetLimit(t, pool, blueMenTenantID, players[0], 16)
	setBetLimit(t, pool, blueMenTenantID, players[1], 16)
	outcome0 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[0])
	outcome1 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[1])
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[0], outcome0, 1); err != nil {
		t.Fatalf("PlaceBet players[0]: %v", err)
	}

	gfDate := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	gf := playMatch(t, ctx, pool, gameID, gfDate, map[idpkg.ID]float64{players[0]: 10, players[1]: 6, players[2]: 2, players[3]: 0})

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket after completion: %v", err)
	}
	if m.Status != "resolved" {
		t.Fatalf("market must be resolved after the grand final, got %q", m.Status)
	}

	// Tie at the top: no strict cut — the final replays, the tournament goes
	// back to running and the settled market reopens.
	matchSvc := newMatchService(pool)
	if _, err := matchSvc.UpdateMatch(ctx, gf.ID, gameID, map[idpkg.ID]float64{players[0]: 10, players[1]: 10, players[2]: 2, players[3]: 0}, gfDate, elo.UpdateMatchOpts{}); err != nil {
		t.Fatalf("UpdateMatch (tie): %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM tournaments WHERE id = $1`, tid).Scan(&status); err != nil {
		t.Fatalf("tournament status: %v", err)
	}
	if status != "running" {
		t.Fatalf("tournament must be running after the tie edit, got %s", status)
	}
	m, err = db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket after revert: %v", err)
	}
	if m.Status != "open" || m.ResolvedAt.Valid || m.ResolutionOutcome != nil {
		t.Fatalf("market must be reopened, got status=%q resolved_at=%v outcome=%v", m.Status, m.ResolvedAt, m.ResolutionOutcome)
	}
	var rowCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM arena_settlements WHERE arena_id = $1 AND market_id = $2`, globalArenaUUID, market.ID).Scan(&rowCount); err != nil {
		t.Fatalf("count settlements: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("reverted market must carry no settlement rows, got %d", rowCount)
	}

	// A deciding replay crowns a new champion — the market re-resolves onto
	// players[1], attached to the new determining match.
	gf2Date := gfDate.Add(time.Hour)
	gf2 := playMatch(t, ctx, pool, gameID, gf2Date, map[idpkg.ID]float64{players[0]: 1, players[1]: 12, players[2]: 0, players[3]: 2})

	m, err = db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket after re-completion: %v", err)
	}
	if m.Status != "resolved" || m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcome1 {
		t.Fatalf("market must resolve onto players[1], got status=%q outcome=%v", m.Status, m.ResolutionOutcome)
	}
	if m.ResolutionMatchID == nil || *m.ResolutionMatchID != gf2.ID {
		t.Errorf("resolution_match_id = %v, want the deciding match %s", m.ResolutionMatchID, gf2.ID)
	}
}

// TestTournamentWinnerMarket_RecalcIdempotent: replaying history from the
// determining match's date unsets and re-settles the market deterministically
// — the resolution stays attached to the match, dated at it, and the balances
// are unchanged.
func TestTournamentWinnerMarket_RecalcIdempotent(t *testing.T) {
	pool, cleanup, ctx, adminID, tid, gameID, players := tournamentWinnerMarketSetups(t)
	defer cleanup()

	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, players)
	guarantor := createTestPlayer(t, pool, "Реплей поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)
	setBetLimit(t, pool, blueMenTenantID, players[0], 16)
	outcome0 := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", players[0])
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, players[0], outcome0, 1); err != nil {
		t.Fatalf("PlaceBet players[0]: %v", err)
	}

	gfDate := time.Now().Add(-time.Hour).Truncate(time.Second)
	gf := playMatch(t, ctx, pool, gameID, gfDate, map[idpkg.ID]float64{players[0]: 10, players[1]: 6, players[2]: 2, players[3]: 0})

	snapshotRating := latestRating(t, pool, players[0])
	snapshotEarned := playerMarketEarned(t, pool, market.ID, players[0])

	// An identical rewrite of the determining match triggers a full recalc
	// from its date — which unsets the market and must re-settle it inline.
	matchSvc := newMatchService(pool)
	if _, err := matchSvc.UpdateMatch(ctx, gf.ID, gameID, map[idpkg.ID]float64{players[0]: 10, players[1]: 6, players[2]: 2, players[3]: 0}, gfDate, elo.UpdateMatchOpts{}); err != nil {
		t.Fatalf("UpdateMatch (recalc trigger): %v", err)
	}

	m, err := db.New(pool).GetMarket(ctx, market.ID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "resolved" || m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcome0 {
		t.Fatalf("market must be resolved onto players[0] after the replay, got status=%q outcome=%v", m.Status, m.ResolutionOutcome)
	}
	if m.ResolutionMatchID == nil || *m.ResolutionMatchID != gf.ID {
		t.Errorf("resolution_match_id = %v, want the grand final %s", m.ResolutionMatchID, gf.ID)
	}
	if !m.ResolvedAt.Time.Equal(gfDate) {
		t.Errorf("resolved_at = %v, want %v", m.ResolvedAt.Time, gfDate)
	}
	const epsilon = 1e-6
	if got := playerMarketEarned(t, pool, market.ID, players[0]); math.Abs(got-snapshotEarned) > epsilon {
		t.Errorf("earned after recalc = %.6f, want %.6f", got, snapshotEarned)
	}
	if got := latestRating(t, pool, players[0]); math.Abs(got-snapshotRating) > epsilon {
		t.Errorf("rating after recalc = %.6f, want %.6f", got, snapshotRating)
	}
}

// TestTournamentWinnerMarket_RecalcKeepsFinalResolution: replaying a
// multi-round bracket must keep the market resolved at the final's
// determining match. Without the final-slot guard, the replay settled it at
// the earliest winners-round determining match instead — the resolution moved
// earlier, and the history-conflict validation then rejected the whole save
// because bets placed between the rounds landed after the bogus resolution
// time.
func TestTournamentWinnerMarket_RecalcKeepsFinalResolution(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	ctx := context.Background()
	adminToken, _ := createTestUserWithID(t, pool, true)
	adminID := createTestAdmin(t, pool)
	gameID, tid, semis := startWinnersFinalTournament(t, pool, adminToken, "Многокруговой кубок")

	participants := append(append([]idpkg.ID{}, semis[0]...), semis[1]...)
	marketSvc, market := createTournamentWinnerMarket(t, ctx, pool, adminID, tid, participants)
	guarantor := createTestPlayer(t, pool, "Досрочный поручитель")
	setBetLimit(t, pool, blueMenTenantID, guarantor, 16)
	joinGuarantee(ctx, t, marketSvc, market.ID, guarantor)

	// Both winners rounds play out with a strict top-2 cut, hours apart.
	semiADate := time.Now().Add(-3 * time.Hour).Truncate(time.Second)
	semiBDate := time.Now().Add(-2 * time.Hour).Truncate(time.Second)
	semiAScores := map[idpkg.ID]float64{semis[0][0]: 10, semis[0][1]: 8, semis[0][2]: 2, semis[0][3]: 0}
	semiBScores := map[idpkg.ID]float64{semis[1][0]: 10, semis[1][1]: 8, semis[1][2]: 2, semis[1][3]: 0}
	semiA := playMatch(t, ctx, pool, gameID, semiADate, semiAScores)
	playMatch(t, ctx, pool, gameID, semiBDate, semiBScores)

	// A bet lands between the rounds — inside the bogus window that a
	// wrong replay opens when it resolves the market at a winners date.
	setBetLimit(t, pool, blueMenTenantID, semis[0][0], 16)
	champion := semis[0][0]
	outcomeChampion := marketOutcomeID(t, ctx, marketSvc, market.ID, "player", champion)
	if _, err := placeBetAtCurrentPrice(ctx, t, marketSvc, market.ID, champion, outcomeChampion, 1); err != nil {
		t.Fatalf("PlaceBet between rounds: %v", err)
	}

	// The final is played by each semi's top-2 and crowns the champion; the
	// market resolves at the final's date, attached to it.
	finalDate := time.Now().Add(-time.Hour).Truncate(time.Second)
	finalScores := map[idpkg.ID]float64{semis[0][0]: 10, semis[0][1]: 6, semis[1][0]: 2, semis[1][1]: 0}
	final := playMatch(t, ctx, pool, gameID, finalDate, finalScores)

	assertMarketResolvedAt := func(where string) {
		t.Helper()
		m, err := db.New(pool).GetMarket(ctx, market.ID)
		if err != nil {
			t.Fatalf("%s: GetMarket: %v", where, err)
		}
		if m.Status != "resolved" || m.ResolutionOutcome == nil || *m.ResolutionOutcome != outcomeChampion {
			t.Fatalf("%s: market must be resolved onto the champion, got status=%q outcome=%v", where, m.Status, m.ResolutionOutcome)
		}
		if m.ResolutionMatchID == nil || *m.ResolutionMatchID != final.ID {
			t.Errorf("%s: resolution_match_id = %v, want the final %s", where, m.ResolutionMatchID, final.ID)
		}
		if !m.ResolvedAt.Time.Equal(finalDate) {
			t.Errorf("%s: resolved_at = %v, want the final date %v", where, m.ResolvedAt.Time, finalDate)
		}
	}
	assertMarketResolvedAt("after completion")

	snapshotEarned := playerMarketEarned(t, pool, market.ID, champion)

	// A no-op rewrite of the first winners match replays the whole bracket
	// from its date — over both winners rounds and the final — and must keep
	// the resolution identical (same date, same determining match).
	matchSvc := newMatchService(pool)
	if _, err := matchSvc.UpdateMatch(ctx, semiA.ID, gameID, semiAScores, semiADate, elo.UpdateMatchOpts{}); err != nil {
		t.Fatalf("UpdateMatch (recalc over earlier rounds): %v", err)
	}

	assertMarketResolvedAt("after replay")
	const epsilon = 1e-6
	if got := playerMarketEarned(t, pool, market.ID, champion); math.Abs(got-snapshotEarned) > epsilon {
		t.Errorf("earned after replay = %.6f, want %.6f", got, snapshotEarned)
	}
}

// TestTournamentWinnerMarket_CreateValidation drives the ADR-35 contract:
// manual creation of a tournament_winner market is rejected, and starting the
// tournament auto-creates exactly one — born with the start actor, carrying
// the tournament params, a null closes_at, and one outcome per participant.
func TestTournamentWinnerMarket_CreateValidation(t *testing.T) {
	pool, cleanup := setupTestDB(t)
	defer cleanup()
	router := setupRouter(pool)

	adminToken, adminUserID := createTestUserWithID(t, pool, true)
	_, runningID, players := startFinalOnlyTournament(t, pool, adminToken, "Валидный кубок")

	// Manual creation is gone whole (ADR-35): the type itself is not accepted
	// — a running tournament and an unknown one are rejected the same way.
	for _, tid := range []idpkg.ID{runningID, newID(t)} {
		body := fmt.Sprintf(`{"id": %q, "market_type": "tournament_winner", "tournament_id": %q}`, short(newID(t)), short(tid))
		if w := doJSON(t, router, http.MethodPost, "/tenants/00000000-0000-0000-0000-000000000101/markets", adminToken, body); w.Code != http.StatusBadRequest {
			t.Fatalf("manual tournament_winner market must 400, got %d %s", w.Code, w.Body.String())
		}
	}

	// Exactly one market was born with the start, attributed to the acting
	// organizer.
	ctx := context.Background()
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM market_tournament_winner_params WHERE tournament_id = $1`, runningID).Scan(&n); err != nil {
		t.Fatalf("count tournament_winner markets: %v", err)
	}
	if n != 1 {
		t.Fatalf("tournament_winner markets = %d, want exactly the auto-created one", n)
	}
	var marketID idpkg.ID
	if err := pool.QueryRow(ctx, `SELECT market_id FROM market_tournament_winner_params WHERE tournament_id = $1`, runningID).Scan(&marketID); err != nil {
		t.Fatalf("auto-created tournament_winner market: %v", err)
	}
	m, err := db.New(pool).GetMarket(ctx, marketID)
	if err != nil {
		t.Fatalf("GetMarket: %v", err)
	}
	if m.Status != "open" {
		t.Errorf("auto market status = %q, want open", m.Status)
	}
	if m.CreatedBy != idpkg.ID(adminUserID) {
		t.Errorf("auto market created_by = %s, want the starting organizer %s", m.CreatedBy, adminUserID)
	}

	// The outcomes are exactly the tournament's participants — one "player"
	// outcome each, no "other".
	marketSvc := elo.NewMarketService(pool)
	outcomes, err := marketSvc.Queries.ListMarketOutcomes(ctx, marketID)
	if err != nil {
		t.Fatalf("ListMarketOutcomes: %v", err)
	}
	if len(outcomes) != len(players) {
		t.Fatalf("outcomes = %d, want %d (one per participant)", len(outcomes), len(players))
	}
	seen := make(map[idpkg.ID]bool, len(players))
	for _, o := range outcomes {
		if o.Kind != "player" || o.PlayerID == nil || !containsID(players, *o.PlayerID) {
			t.Fatalf("unexpected outcome %+v", o)
		}
		seen[*o.PlayerID] = true
	}
	if len(seen) != len(players) {
		t.Fatalf("outcome players = %d, want %d distinct", len(seen), len(players))
	}

	// Read back over the API: the market is active, params carry the
	// tournament, closes_at is null.
	w := doJSON(t, router, http.MethodGet, "/markets", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list markets: %d %s", w.Code, w.Body.String())
	}
	var list struct {
		Data struct {
			Active []struct {
				MarketType string  `json:"market_type"`
				ClosesAt   *string `json:"closes_at"`
				Params     *struct {
					TournamentID   string `json:"tournament_id"`
					TournamentName string `json:"tournament_name"`
				} `json:"params"`
			} `json:"active"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode markets: %v", err)
	}
	found := false
	for _, m := range list.Data.Active {
		if m.MarketType != "tournament_winner" || m.Params == nil || m.Params.TournamentID != short(runningID) {
			continue
		}
		found = true
		if m.ClosesAt != nil {
			t.Errorf("tournament_winner closes_at = %v, want null", *m.ClosesAt)
		}
		if m.Params.TournamentName != "Валидный кубок" {
			t.Errorf("tournament_winner params: %+v", m.Params)
		}
	}
	if !found {
		t.Fatalf("auto-created tournament_winner market not in the active list")
	}
}
