package elo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ─── Errors ──────────────────────────────────────────────────────────────────

var (
	ErrTableNotFound   = errors.New("table not found")
	ErrNotTableHost    = errors.New("only the host can perform this action")
	ErrPlayerNotInGame = errors.New("player is not in this game")
	ErrSlotAlreadySet  = errors.New("slot already filled by host")
	ErrWrongPhase      = errors.New("action not allowed in current game phase")
	ErrAlreadyJoined   = errors.New("player already connected to this table")
)

// ─── Domain types ─────────────────────────────────────────────────────────────

// SkullKingGameState mirrors the TypeScript GameState. Used for conflict checks
// during player bid/result submissions. Player ids are typed so the JSON hooks
// canonicalize them on parse and shorten them on marshal — game_state is a
// freeform blob otherwise untouched by the boundary (ADR-12).
type SkullKingGameState struct {
	Phase              string              `json:"phase"`
	Players            []SkullKingPlayer   `json:"players"`
	CurrentRound       int                 `json:"currentRound"`
	CurrentPlayerIndex int                 `json:"currentPlayerIndex"`
	Rounds             [][]json.RawMessage `json:"rounds"` // [roundIdx][playerIdx], null entries allowed
	FallbackGameId     *id.ID              `json:"fallbackGameId,omitempty"`
}

type SkullKingPlayer struct {
	ID   id.ID  `json:"id"`
	Name string `json:"name"`
}

// SkullKingEntry — actual Go struct for a round entry; used only for conflict checks.
type SkullKingEntry struct {
	Bid    int  `json:"bid"`
	Actual *int `json:"actual"` // null = not yet entered
	Bonus  int  `json:"bonus"`
}

// SkullKingTableSummary is the public representation sent to clients.
type SkullKingTableSummary struct {
	ID                 string             `json:"id"`
	HostUserID         string             `json:"host_user_id"`
	GameState          SkullKingGameState `json:"game_state"`
	ConnectedPlayerIDs []string           `json:"connected_player_ids"`
	CreatedAt          time.Time          `json:"created_at"`
	ExpiresAt          time.Time          `json:"expires_at"`
}

// ─── Service interface ────────────────────────────────────────────────────────

type ISkullKingTableService interface {
	ListTables(ctx context.Context) ([]SkullKingTableSummary, error)
	CreateTable(ctx context.Context, tableID id.ID, hostUserID id.ID, initialState json.RawMessage) (SkullKingTableSummary, error)
	GetTable(ctx context.Context, tableID id.ID) (SkullKingTableSummary, error)
	UpdateTableState(ctx context.Context, tableID id.ID, hostUserID id.ID, newState json.RawMessage) (SkullKingTableSummary, error)
	JoinTable(ctx context.Context, tableID id.ID, playerID id.ID) (SkullKingTableSummary, error)
	SubmitBid(ctx context.Context, tableID id.ID, playerID id.ID, bid int) (SkullKingTableSummary, error)
	SubmitResult(ctx context.Context, tableID id.ID, playerID id.ID, actual int, bonus int) (SkullKingTableSummary, error)
	DeleteTable(ctx context.Context, tableID id.ID, hostUserID id.ID, savedMatchID id.ID) error
	DeleteExpiredTables(ctx context.Context) error
	ScheduleNextCleanup(ctx context.Context)
}

// ─── Implementation ───────────────────────────────────────────────────────────

type SkullKingTableService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *Hub
	timer   *time.Timer
	timerMu sync.Mutex
}

func NewSkullKingTableService(pool *pgxpool.Pool, hub *Hub) ISkullKingTableService {
	return &SkullKingTableService{
		Queries: db.New(pool),
		Pool:    pool,
		Hub:     hub,
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func parseID(s id.ID) (id.ID, error) {
	if _, err := uuid.Parse(string(s)); err != nil {
		return "", fmt.Errorf("invalid table id: %w", err)
	}
	return s, nil
}

func toTableSummary(row db.SkullKingTable) (SkullKingTableSummary, error) {
	var gs SkullKingGameState
	if err := json.Unmarshal(row.GameState, &gs); err != nil {
		return SkullKingTableSummary{}, fmt.Errorf("corrupt game state: %w", err)
	}
	// SSE frames bypass the idcodec middleware (it only rewrites buffered
	// application/json responses), so the short id encoding every other payload
	// uses is applied here, at construction.
	connected := make([]string, len(row.ConnectedPlayerIds))
	for i, pid := range row.ConnectedPlayerIds {
		connected[i] = string(pid.Base58())
	}
	return SkullKingTableSummary{
		ID:                 string(row.ID.Base58()),
		HostUserID:         string(row.HostUserID.Base58()),
		GameState:          gs,
		ConnectedPlayerIDs: connected,
		CreatedAt:          row.CreatedAt,
		ExpiresAt:          row.ExpiresAt,
	}, nil
}

func (s *SkullKingTableService) broadcast(tableID id.ID, summary SkullKingTableSummary) {
	payload, err := json.Marshal(SSEEvent{Type: "state", Data: summary})
	if err != nil {
		return
	}
	s.Hub.Broadcast(SkullKingTableTopic(tableID), payload)
}

// broadcastSavedMatch tells table subscribers that the host saved the match,
// carrying the new match id so connected players can redirect to it.
// Sent before the table row is deleted so currently-connected clients receive it.
// Like every SSE frame, the id is embedded in its short form.
func (s *SkullKingTableService) broadcastSavedMatch(tableID, matchID id.ID) {
	payload, err := json.Marshal(SSEEvent{
		Type: "saved",
		Data: map[string]string{"match_id": string(matchID.Base58())},
	})
	if err != nil {
		return
	}
	s.Hub.Broadcast(SkullKingTableTopic(tableID), payload)
}

// broadcastClosed tells table subscribers the host tore the table down without
// saving (reset / new game). Payload-less: connected players clear their
// session and return to the setup screen.
func (s *SkullKingTableService) broadcastClosed(tableID id.ID) {
	payload, err := json.Marshal(SSEEvent{Type: "closed"})
	if err != nil {
		return
	}
	s.Hub.Broadcast(SkullKingTableTopic(tableID), payload)
}

// broadcastLobby signals lobby subscribers that the set of tables changed.
// The signal carries no payload — clients refetch the full list.
func (s *SkullKingTableService) broadcastLobby() {
	s.Hub.PublishSignal(TopicLobbySkullKing, "tables-changed")
}

// broadcastInvites sends a table-invite event to the user controlling each
// picked player (except the host). Transient by design: only currently
// connected clients see it; everyone else finds the table in the lobby list.
// Like every SSE frame, the table id is embedded in its short form.
func (s *SkullKingTableService) broadcastInvites(summary SkullKingTableSummary, hostUserID id.ID) {
	playerIDs := make([]id.ID, 0, len(summary.GameState.Players))
	for _, p := range summary.GameState.Players {
		playerIDs = append(playerIDs, p.ID)
	}

	ctx := context.Background()
	links, err := s.Queries.ListUserIDsByPlayerIDs(ctx, playerIDs)
	if err != nil {
		return
	}
	host, err := s.Queries.GetUser(ctx, hostUserID)
	if err != nil {
		return
	}

	payload, err := json.Marshal(SSEEvent{
		Type: "table-invite",
		Data: map[string]string{
			"table_id":  summary.ID,
			"host_name": host.GoogleOauthUserName,
		},
	})
	if err != nil {
		return
	}
	for _, link := range links {
		if link.UserID == hostUserID {
			continue
		}
		s.Hub.Broadcast(UserTopic(link.UserID), payload)
	}
}

// findPlayerIndex returns the index of the player with the given app player ID
// (GameState.Players[].ID, canonical after the typed unmarshal), or -1.
func findPlayerIndex(players []SkullKingPlayer, playerID id.ID) int {
	for i, p := range players {
		if p.ID == playerID {
			return i
		}
	}
	return -1
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

func (s *SkullKingTableService) ListTables(ctx context.Context) ([]SkullKingTableSummary, error) {
	rows, err := s.Queries.ListSkullKingTables(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]SkullKingTableSummary, 0, len(rows))
	for _, row := range rows {
		summary, err := toTableSummary(row)
		if err != nil {
			continue // skip corrupt rows
		}
		result = append(result, summary)
	}
	return result, nil
}

func (s *SkullKingTableService) CreateTable(ctx context.Context, tableID id.ID, hostUserID id.ID, initialState json.RawMessage) (SkullKingTableSummary, error) {
	if _, err := parseID(tableID); err != nil {
		return SkullKingTableSummary{}, fmt.Errorf("invalid table id: %w", err)
	}
	row, err := s.Queries.CreateSkullKingTable(ctx, db.CreateSkullKingTableParams{
		ID:         tableID,
		HostUserID: hostUserID,
		GameState:  []byte(initialState),
	})
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	summary, err := toTableSummary(row)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	// Reschedule cleanup timer to account for the new table's expiry
	go s.ScheduleNextCleanup(context.Background())
	s.broadcastLobby()
	s.broadcastInvites(summary, hostUserID)
	return summary, nil
}

func (s *SkullKingTableService) GetTable(ctx context.Context, tableID id.ID) (SkullKingTableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}
	row, err := s.Queries.GetSkullKingTable(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SkullKingTableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	return toTableSummary(row)
}

func (s *SkullKingTableService) UpdateTableState(ctx context.Context, tableID id.ID, hostUserID id.ID, newState json.RawMessage) (SkullKingTableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}
	row, err := s.Queries.GetSkullKingTable(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SkullKingTableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	if row.HostUserID != hostUserID {
		return SkullKingTableSummary{}, ErrNotTableHost
	}

	updated, err := s.Queries.UpdateSkullKingTableState(ctx, db.UpdateSkullKingTableStateParams{
		ID:        pgID,
		GameState: []byte(newState),
	})
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	summary, err := toTableSummary(updated)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	s.broadcast(tableID, summary)
	return summary, nil
}

func (s *SkullKingTableService) JoinTable(ctx context.Context, tableID id.ID, playerID id.ID) (SkullKingTableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}

	updated, err := s.Queries.AddSkullKingTablePlayer(ctx, db.AddSkullKingTablePlayerParams{
		ID:          pgID,
		ArrayAppend: playerID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Either table not found or player already in list (the WHERE NOT... returns no rows)
		// Check which case it is
		row, getErr := s.Queries.GetSkullKingTable(ctx, pgID)
		if errors.Is(getErr, pgx.ErrNoRows) {
			return SkullKingTableSummary{}, ErrTableNotFound
		}
		if getErr == nil {
			// Table exists — player was already in the list
			return toTableSummary(row)
		}
		return SkullKingTableSummary{}, err
	}
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	summary, err := toTableSummary(updated)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	s.broadcast(tableID, summary)
	return summary, nil
}

// ─── Bid / Result submission ──────────────────────────────────────────────────

func (s *SkullKingTableService) SubmitBid(ctx context.Context, tableID id.ID, playerID id.ID, bid int) (SkullKingTableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)
	row, err := q.GetSkullKingTableForUpdate(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SkullKingTableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return SkullKingTableSummary{}, err
	}

	var gs SkullKingGameState
	if err := json.Unmarshal(row.GameState, &gs); err != nil {
		return SkullKingTableSummary{}, fmt.Errorf("corrupt game state: %w", err)
	}

	if gs.Phase != "waiting-for-bids" {
		return SkullKingTableSummary{}, ErrWrongPhase
	}

	playerIdx := findPlayerIndex(gs.Players, playerID)
	if playerIdx == -1 {
		return SkullKingTableSummary{}, ErrPlayerNotInGame
	}

	roundIdx := gs.CurrentRound - 1
	if roundIdx < 0 {
		return SkullKingTableSummary{}, ErrWrongPhase
	}
	// Initialize missing round slots (game may start in waiting-for-bids with empty rounds)
	for len(gs.Rounds) <= roundIdx {
		gs.Rounds = append(gs.Rounds, make([]json.RawMessage, 0))
	}

	if playerIdx < len(gs.Rounds[roundIdx]) && gs.Rounds[roundIdx][playerIdx] != nil {
		var existing SkullKingEntry
		if json.Unmarshal(gs.Rounds[roundIdx][playerIdx], &existing) == nil && existing.Bid != 0 {
			return SkullKingTableSummary{}, ErrSlotAlreadySet
		}
	}

	// Set the bid for this player slot
	entryJSON, _ := json.Marshal(SkullKingEntry{Bid: bid, Actual: nil, Bonus: 0})
	for len(gs.Rounds[roundIdx]) <= playerIdx {
		gs.Rounds[roundIdx] = append(gs.Rounds[roundIdx], nil)
	}
	gs.Rounds[roundIdx][playerIdx] = entryJSON

	newStateBytes, err := json.Marshal(gs)
	if err != nil {
		return SkullKingTableSummary{}, err
	}

	updated, err := q.UpdateSkullKingTableState(ctx, db.UpdateSkullKingTableStateParams{
		ID:        pgID,
		GameState: newStateBytes,
	})
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SkullKingTableSummary{}, err
	}

	summary, err := toTableSummary(updated)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	s.broadcast(tableID, summary)
	return summary, nil
}

func (s *SkullKingTableService) SubmitResult(ctx context.Context, tableID id.ID, playerID id.ID, actual int, bonus int) (SkullKingTableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)
	row, err := q.GetSkullKingTableForUpdate(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SkullKingTableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return SkullKingTableSummary{}, err
	}

	var gs SkullKingGameState
	if err := json.Unmarshal(row.GameState, &gs); err != nil {
		return SkullKingTableSummary{}, fmt.Errorf("corrupt game state: %w", err)
	}

	if gs.Phase != "result-entry" {
		return SkullKingTableSummary{}, ErrWrongPhase
	}

	playerIdx := findPlayerIndex(gs.Players, playerID)
	if playerIdx == -1 {
		return SkullKingTableSummary{}, ErrPlayerNotInGame
	}

	roundIdx := gs.CurrentRound - 1
	if roundIdx < 0 || roundIdx >= len(gs.Rounds) {
		return SkullKingTableSummary{}, ErrWrongPhase
	}

	// Reject if host already set actual for this slot
	if playerIdx < len(gs.Rounds[roundIdx]) && gs.Rounds[roundIdx][playerIdx] != nil {
		var existing SkullKingEntry
		if json.Unmarshal(gs.Rounds[roundIdx][playerIdx], &existing) == nil && existing.Actual != nil {
			return SkullKingTableSummary{}, ErrSlotAlreadySet
		}
	}

	// Get the bid from the existing entry
	var existingEntry SkullKingEntry
	if playerIdx < len(gs.Rounds[roundIdx]) && gs.Rounds[roundIdx][playerIdx] != nil {
		json.Unmarshal(gs.Rounds[roundIdx][playerIdx], &existingEntry) //nolint:errcheck
	}

	entryJSON, _ := json.Marshal(SkullKingEntry{Bid: existingEntry.Bid, Actual: &actual, Bonus: bonus})
	for len(gs.Rounds[roundIdx]) <= playerIdx {
		gs.Rounds[roundIdx] = append(gs.Rounds[roundIdx], nil)
	}
	gs.Rounds[roundIdx][playerIdx] = entryJSON

	newStateBytes, err := json.Marshal(gs)
	if err != nil {
		return SkullKingTableSummary{}, err
	}

	updated, err := q.UpdateSkullKingTableState(ctx, db.UpdateSkullKingTableStateParams{
		ID:        pgID,
		GameState: newStateBytes,
	})
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SkullKingTableSummary{}, err
	}

	summary, err := toTableSummary(updated)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	s.broadcast(tableID, summary)
	return summary, nil
}

func (s *SkullKingTableService) DeleteTable(ctx context.Context, tableID id.ID, hostUserID id.ID, savedMatchID id.ID) error {
	pgID, err := parseID(tableID)
	if err != nil {
		return ErrTableNotFound
	}
	row, err := s.Queries.GetSkullKingTable(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTableNotFound
	}
	if err != nil {
		return err
	}
	if row.HostUserID != hostUserID {
		return ErrNotTableHost
	}
	// If the host saved the match, tell connected players which match to open
	// before tearing down the table (and thus the SSE channel).
	if savedMatchID != "" {
		s.broadcastSavedMatch(tableID, savedMatchID)
	} else {
		// Host reset without saving: tell connected players the table is gone
		// so they exit to the setup screen instead of discovering a 404 on
		// their next reconnect.
		s.broadcastClosed(tableID)
	}
	if err := s.Queries.DeleteSkullKingTable(ctx, pgID); err != nil {
		return err
	}
	s.broadcastLobby()
	return nil
}

// ─── Cleanup timer ────────────────────────────────────────────────────────────

func (s *SkullKingTableService) DeleteExpiredTables(ctx context.Context) error {
	if err := s.Queries.DeleteExpiredSkullKingTables(ctx); err != nil {
		return err
	}
	s.broadcastLobby()
	return nil
}

// ScheduleNextCleanup mirrors MarketService.ScheduleNextExpiry.
func (s *SkullKingTableService) ScheduleNextCleanup(ctx context.Context) {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()

	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}

	nextExpiry, err := s.Queries.GetNearestSkullKingTableExpiry(ctx)
	if err != nil {
		// pgx.ErrNoRows means no tables — nothing to schedule
		return
	}

	dur := time.Until(nextExpiry)
	if dur < 0 {
		dur = 0
	}

	bgCtx := context.Background()
	s.timer = time.AfterFunc(dur, func() {
		if err := s.DeleteExpiredTables(bgCtx); err != nil {
			log.Printf("DeleteExpiredSkullKingTables error: %v", err)
		}
		s.ScheduleNextCleanup(bgCtx)
	})
}
