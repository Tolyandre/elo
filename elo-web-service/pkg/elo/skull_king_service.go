package elo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/tolyandre/elo-web-service/pkg/db"
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
// during player bid/result submissions.
type SkullKingGameState struct {
	Phase              string              `json:"phase"`
	Players            []SkullKingPlayer   `json:"players"`
	CurrentRound       int                 `json:"currentRound"`
	CurrentPlayerIndex int                 `json:"currentPlayerIndex"`
	Rounds             [][]json.RawMessage `json:"rounds"` // [roundIdx][playerIdx], null entries allowed
	FallbackGameId     *string             `json:"fallbackGameId,omitempty"`
}

type SkullKingPlayer struct {
	ID   string `json:"id"`
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
	HostUserID         int32              `json:"host_user_id"`
	GameState          SkullKingGameState `json:"game_state"`
	ConnectedPlayerIDs []int32            `json:"connected_player_ids"`
	CreatedAt          time.Time          `json:"created_at"`
	ExpiresAt          time.Time          `json:"expires_at"`
}

// sseEvent wraps an SSE payload.
type sseEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// ─── Service interface ────────────────────────────────────────────────────────

type ISkullKingTableService interface {
	ListTables(ctx context.Context) ([]SkullKingTableSummary, error)
	CreateTable(ctx context.Context, hostUserID int32, initialState json.RawMessage) (SkullKingTableSummary, error)
	GetTable(ctx context.Context, tableID string) (SkullKingTableSummary, error)
	UpdateTableState(ctx context.Context, tableID string, hostUserID int32, newState json.RawMessage) (SkullKingTableSummary, error)
	JoinTable(ctx context.Context, tableID string, playerID int32) (SkullKingTableSummary, error)
	SubmitBid(ctx context.Context, tableID string, playerID int32, bid int) (SkullKingTableSummary, error)
	SubmitResult(ctx context.Context, tableID string, playerID int32, actual int, bonus int) (SkullKingTableSummary, error)
	DeleteTable(ctx context.Context, tableID string, hostUserID int32) error
	DeleteExpiredTables(ctx context.Context) error
	ScheduleNextCleanup(ctx context.Context)
}

// ─── Implementation ───────────────────────────────────────────────────────────

type SkullKingTableService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *SkullKingHub
	timer   *time.Timer
	timerMu sync.Mutex
}

func NewSkullKingTableService(pool *pgxpool.Pool, hub *SkullKingHub) ISkullKingTableService {
	return &SkullKingTableService{
		Queries: db.New(pool),
		Pool:    pool,
		Hub:     hub,
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("invalid table id: %w", err)
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}

func toTableSummary(row db.SkullKingTable) (SkullKingTableSummary, error) {
	var gs SkullKingGameState
	if err := json.Unmarshal(row.GameState, &gs); err != nil {
		return SkullKingTableSummary{}, fmt.Errorf("corrupt game state: %w", err)
	}
	return SkullKingTableSummary{
		ID:                 uuidToString(row.ID),
		HostUserID:         row.HostUserID,
		GameState:          gs,
		ConnectedPlayerIDs: row.ConnectedPlayerIds,
		CreatedAt:          row.CreatedAt,
		ExpiresAt:          row.ExpiresAt,
	}, nil
}

func (s *SkullKingTableService) broadcast(tableID string, summary SkullKingTableSummary) {
	payload, err := json.Marshal(sseEvent{Type: "state", Data: summary})
	if err != nil {
		return
	}
	s.Hub.Broadcast(tableID, payload)
}

// findPlayerIndex returns the index of the player with the given app player ID
// (stored as a string in GameState.Players[].ID), or -1 if not found.
func findPlayerIndex(players []SkullKingPlayer, playerID int32) int {
	target := strconv.Itoa(int(playerID))
	for i, p := range players {
		if p.ID == target {
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

func (s *SkullKingTableService) CreateTable(ctx context.Context, hostUserID int32, initialState json.RawMessage) (SkullKingTableSummary, error) {
	row, err := s.Queries.CreateSkullKingTable(ctx, db.CreateSkullKingTableParams{
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
	return summary, nil
}

func (s *SkullKingTableService) GetTable(ctx context.Context, tableID string) (SkullKingTableSummary, error) {
	pgID, err := parseUUID(tableID)
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

func (s *SkullKingTableService) UpdateTableState(ctx context.Context, tableID string, hostUserID int32, newState json.RawMessage) (SkullKingTableSummary, error) {
	pgID, err := parseUUID(tableID)
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

func (s *SkullKingTableService) JoinTable(ctx context.Context, tableID string, playerID int32) (SkullKingTableSummary, error) {
	pgID, err := parseUUID(tableID)
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

func (s *SkullKingTableService) SubmitBid(ctx context.Context, tableID string, playerID int32, bid int) (SkullKingTableSummary, error) {
	pgID, err := parseUUID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

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

func (s *SkullKingTableService) SubmitResult(ctx context.Context, tableID string, playerID int32, actual int, bonus int) (SkullKingTableSummary, error) {
	pgID, err := parseUUID(tableID)
	if err != nil {
		return SkullKingTableSummary{}, ErrTableNotFound
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SkullKingTableSummary{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

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

func (s *SkullKingTableService) DeleteTable(ctx context.Context, tableID string, hostUserID int32) error {
	pgID, err := parseUUID(tableID)
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
	return s.Queries.DeleteSkullKingTable(ctx, pgID)
}

// ─── Cleanup timer ────────────────────────────────────────────────────────────

func (s *SkullKingTableService) DeleteExpiredTables(ctx context.Context) error {
	return s.Queries.DeleteExpiredSkullKingTables(ctx)
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
