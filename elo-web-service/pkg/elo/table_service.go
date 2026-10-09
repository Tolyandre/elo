package elo

import (
	"bytes"
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
	ErrTableNotFound        = errors.New("table not found")
	ErrNotTableHost         = errors.New("only the host can perform this action")
	ErrPlayerNotInGame      = errors.New("player is not in this game")
	ErrSlotAlreadySet       = errors.New("slot already filled")
	ErrWrongPhase           = errors.New("action not allowed in current game phase")
	ErrAlreadyJoined        = errors.New("player already connected to this table")
	ErrUnknownGame          = errors.New("unknown game")
	ErrInvalidState         = errors.New("invalid game state")
	ErrInvalidInput         = errors.New("invalid input")
	ErrTableVersionConflict = errors.New("table state was modified by someone else")
)

// ─── Domain types ─────────────────────────────────────────────────────────────

// TablePlayer is a participant entry inside a game state. Player ids are typed
// so the JSON hooks canonicalize them on parse and shorten them on marshal —
// game_state is a freeform blob otherwise untouched by the boundary (ADR-12).
type TablePlayer struct {
	ID   id.ID  `json:"id"`
	Name string `json:"name"`
}

// TableSubmitInput was the shared submission union; each game now unmarshals
// its own submit shape (see tableGame.applySubmit), so a game only ever sees
// its own fields.

// TableSummary is the public representation sent to clients. GameState is the
// per-game state document in its wire form (Base58 player ids) — every write
// path normalizes through the game's typed state, so it passes through raw.
// The id fields are typed: their JSON hooks emit the short wire form, so both
// the HTTP responses and the SSE frames (which bypass the idcodec middleware)
// encode ids identically (ADR-12). HostClientToken identifies the device that
// last claimed hosting: a host session whose token differs steps down to
// player/viewer mode (empty string on legacy tables — nothing enforces it).
type TableSummary struct {
	ID                 id.ID           `json:"id"`
	TenantID           id.ID           `json:"tenant_id"`
	GameID             id.ID           `json:"game_id"`
	HostUserID         id.ID           `json:"host_user_id"`
	HostClientToken    string          `json:"host_client_token"`
	GameState          json.RawMessage `json:"game_state"`
	ConnectedPlayerIDs []id.ID         `json:"connected_player_ids"`
	Version            int64           `json:"version"`
	CreatedAt          time.Time       `json:"created_at"`
	ExpiresAt          time.Time       `json:"expires_at"`
}

// savedMatchPayload is the "saved" SSE frame: the host saved the table's match,
// and connected players redirect to it.
type savedMatchPayload struct {
	MatchID id.ID `json:"match_id"`
}

// tableInvitePayload is the transient "table-invite" SSE frame.
type tableInvitePayload struct {
	TableID  id.ID  `json:"table_id"`
	GameID   id.ID  `json:"game_id"`
	Game     string `json:"game"`
	HostName string `json:"host_name"`
}

// ─── Per-game behavior ────────────────────────────────────────────────────────

// tableGame is the per-game behavior plugged into TableService (ADR-16).
type tableGame interface {
	// normalize validates the state structure and returns its canonical
	// wire-form encoding (Base58 player ids, ADR-12).
	normalize(state json.RawMessage) (json.RawMessage, error)
	// applySubmit unmarshals the raw submit body into the game's own input
	// shape and applies it against the state. Called with the table row
	// locked.
	applySubmit(state json.RawMessage, playerID id.ID, submit json.RawMessage) (json.RawMessage, error)
	// playerIDs extracts the app player ids participating in the state
	// (invite fan-out).
	playerIDs(state json.RawMessage) []id.ID
}

var tableGames = map[id.ID]tableGame{
	GameIDSkullKing: skullKingTableGame{},
	GameIDIAWW:      iawwTableGame{},
}

// ─── Service interface ────────────────────────────────────────────────────────

type ITableService interface {
	// ListTables lists the tenant's live tables — the «Сейчас играют» lobby
	// is tenant-scoped (ADR-36 phase 7). An unknown tenant is
	// ErrTenantNotFound.
	ListTables(ctx context.Context, tenantID id.ID) ([]TableSummary, error)
	// CreateTable creates the table under the tenant (the owner is immutable).
	// The seating must relate to the tenant per its openness mode
	// (validateSeatingTenant).
	CreateTable(ctx context.Context, tenantID, tableID, hostUserID, gameID id.ID, hostClientToken string, initialState json.RawMessage) (TableSummary, error)
	GetTable(ctx context.Context, tableID id.ID) (TableSummary, error)
	UpdateTableState(ctx context.Context, tableID, hostUserID id.ID, expectedVersion int64, newState json.RawMessage) (TableSummary, error)
	JoinTable(ctx context.Context, tableID, playerID id.ID) (TableSummary, error)
	SubmitTable(ctx context.Context, tableID, playerID id.ID, submit json.RawMessage) (TableSummary, error)
	TakeoverTable(ctx context.Context, tableID, userID id.ID, hostClientToken string, allowNonHost bool) (TableSummary, error)
	DeleteTable(ctx context.Context, tableID, hostUserID id.ID, savedMatchID id.ID) error
	DeleteExpiredTables(ctx context.Context) error
	ScheduleNextCleanup(ctx context.Context)
}

// ─── Implementation ───────────────────────────────────────────────────────────

type TableService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Hub     *Hub
	timer   *time.Timer
	timerMu sync.Mutex
}

func NewTableService(pool *pgxpool.Pool, hub *Hub) ITableService {
	return &TableService{
		Queries: db.New(pool),
		Pool:    pool,
		Hub:     hub,
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// parseID canonicalizes a table id or fails.
func parseID(s id.ID) (id.ID, error) {
	if _, err := uuid.Parse(string(s)); err != nil {
		return "", fmt.Errorf("invalid table id: %w", err)
	}
	return s, nil
}

// decodeSubmit decodes a raw submit body into a game's input shape, rejecting
// fields the game does not know: a payload for another game (or a typo) is a
// client bug, never an empty update.
func decodeSubmit(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	return nil
}

// strictDecode decodes a stored/host-provided game state with the same
// unknown-field strictness as decodeSubmit: the re-marshal in a game's
// normalize would otherwise silently erase a field the typed state does not
// know (client/server shape drift), so it fails the write loudly instead
// (ADR-18).
func strictDecode(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// toSummary renders a row for clients; HostConnected is derived from the
// presence registry (open SSE streams).
func (s *TableService) toSummary(row db.GameTable) (TableSummary, error) {
	// Corrupt states are impossible in practice (every write normalizes
	// through the game's typed state), but a summary must never 500 the
	// whole list because of one bad row.
	if _, ok := tableGames[row.GameID]; !ok {
		return TableSummary{}, fmt.Errorf("unknown game on table %s", row.ID)
	}
	return TableSummary{
		ID:                 row.ID,
		TenantID:           row.TenantID,
		GameID:             row.GameID,
		HostUserID:         row.HostUserID,
		HostClientToken:    row.HostClientToken,
		GameState:          row.GameState,
		ConnectedPlayerIDs: row.ConnectedPlayerIds,
		Version:            row.Version,
		CreatedAt:          row.CreatedAt,
		ExpiresAt:          row.ExpiresAt,
	}, nil
}

func (s *TableService) broadcast(tableID id.ID, summary TableSummary) {
	payload, err := json.Marshal(SSEEvent{Type: "state", Data: summary})
	if err != nil {
		return
	}
	s.Hub.Broadcast(TableTopic(tableID), payload)
}

// broadcastSavedMatch tells table subscribers that the host saved the match,
// carrying the new match id so connected players can redirect to it.
// Sent before the table row is deleted so currently-connected clients receive it.
// Like every SSE frame, the id is embedded in its short form.
func (s *TableService) broadcastSavedMatch(tableID, matchID id.ID) {
	payload, err := json.Marshal(SSEEvent{
		Type: "saved",
		Data: savedMatchPayload{MatchID: matchID},
	})
	if err != nil {
		return
	}
	s.Hub.Broadcast(TableTopic(tableID), payload)
}

// broadcastClosed tells table subscribers the host tore the table down without
// saving (reset / new game). Payload-less: connected players clear their
// session and return to the setup screen.
func (s *TableService) broadcastClosed(tableID id.ID) {
	payload, err := json.Marshal(SSEEvent{Type: "closed"})
	if err != nil {
		return
	}
	s.Hub.Broadcast(TableTopic(tableID), payload)
}

// broadcastLobby signals lobby subscribers that the set of tables changed.
// The signal carries no payload — clients refetch the full list.
func (s *TableService) broadcastLobby() {
	s.Hub.PublishSignal(TopicLobbyTables, "tables-changed")
}

// broadcastInvites sends a table-invite event to the user controlling each
// picked player (except the host). Transient by design: only currently
// connected clients see it; everyone else finds the table in the lobby list.
// Like every SSE frame, the table id is embedded in its short form.
func (s *TableService) broadcastInvites(row db.GameTable, summary TableSummary, hostUserID id.ID) {
	game, ok := tableGames[row.GameID]
	if !ok {
		return
	}
	playerIDs := game.playerIDs(summary.GameState)

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
		Data: tableInvitePayload{
			TableID:  summary.ID,
			GameID:   summary.GameID,
			Game:     Games[row.GameID].Title,
			HostName: host.GoogleOauthUserName,
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

// ─── CRUD ─────────────────────────────────────────────────────────────────────

func (s *TableService) ListTables(ctx context.Context, tenantID id.ID) ([]TableSummary, error) {
	// An unknown tenant is a 404, not an empty lobby (ADR-36: reads name an
	// existing tenant).
	if _, err := s.Queries.GetTenantByID(ctx, tenantID); err != nil {
		if db.IsNoRows(err) {
			return nil, ErrTenantNotFound
		}
		return nil, err
	}
	rows, err := s.Queries.ListGameTables(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	result := make([]TableSummary, 0, len(rows))
	for _, row := range rows {
		summary, err := s.toSummary(row)
		if err != nil {
			continue // skip corrupt rows
		}
		result = append(result, summary)
	}
	return result, nil
}

// validateSeatingTenant checks the seating against the tenant's openness mode
// (ADR-36 phase 7) — the same rule the match and table forms apply
// client-side, now enforced at creation: members_only seats members only,
// any_member demands at least one current member, all accepts anyone. Later
// joins and submissions are deliberately unguarded — a live game must never
// break mid-play.
func validateSeatingTenant(ctx context.Context, q *db.Queries, tenant db.Tenant, playerIDs []id.ID) error {
	if tenant.ArenaMembershipMode == ArenaMembershipAll {
		return nil
	}
	return checkTenantParticipantRule(ctx, q, tenant, playerIDs, ErrTableOutsideTenant, ErrTableOutsideTenant)
}

func (s *TableService) CreateTable(ctx context.Context, tenantID, tableID, hostUserID, gameID id.ID, hostClientToken string, initialState json.RawMessage) (TableSummary, error) {
	if _, err := parseID(tableID); err != nil {
		return TableSummary{}, fmt.Errorf("invalid table id: %w", err)
	}
	game, ok := tableGames[gameID]
	if !ok {
		return TableSummary{}, ErrUnknownGame
	}
	normalized, err := game.normalize(initialState)
	if err != nil {
		return TableSummary{}, err
	}
	// The tenant's row is re-read and the seating checked inside the write
	// transaction, so a concurrent openness change cannot slip past the guard
	// (the same discipline the match create/edit guards follow).
	summary, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (db.GameTable, error) {
		tenant, err := q.GetTenantByID(ctx, tenantID)
		if db.IsNoRows(err) {
			return db.GameTable{}, ErrTenantNotFound
		}
		if err != nil {
			return db.GameTable{}, fmt.Errorf("get tenant: %w", err)
		}
		if err := validateSeatingTenant(ctx, q, tenant, game.playerIDs(normalized)); err != nil {
			return db.GameTable{}, err
		}
		return q.CreateGameTable(ctx, db.CreateGameTableParams{
			ID:              tableID,
			HostUserID:      hostUserID,
			GameID:          gameID,
			HostClientToken: hostClientToken,
			GameState:       normalized,
			TenantID:        tenantID,
		})
	})
	if err != nil {
		return TableSummary{}, err
	}
	summary2, err := s.toSummary(summary)
	if err != nil {
		return TableSummary{}, err
	}
	// Reschedule cleanup timer to account for the new table's expiry
	go s.ScheduleNextCleanup(context.Background())
	s.broadcastLobby()
	s.broadcastInvites(summary, summary2, hostUserID)
	return summary2, nil
}

func (s *TableService) GetTable(ctx context.Context, tableID id.ID) (TableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return TableSummary{}, ErrTableNotFound
	}
	row, err := s.Queries.GetGameTable(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return TableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return TableSummary{}, err
	}
	return s.toSummary(row)
}

// UpdateTableState replaces the whole game state (host only). expectedVersion
// is the optimistic lock: the host sends the version its edit was based on,
// and a concurrent change (player submission or the host's other device)
// makes the update fail with ErrTableVersionConflict — together with the
// current summary — instead of silently erasing the other writer's input.
func (s *TableService) UpdateTableState(ctx context.Context, tableID, hostUserID id.ID, expectedVersion int64, newState json.RawMessage) (TableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return TableSummary{}, ErrTableNotFound
	}
	row, err := s.Queries.GetGameTable(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return TableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return TableSummary{}, err
	}
	if row.HostUserID != hostUserID {
		return TableSummary{}, ErrNotTableHost
	}
	game, ok := tableGames[row.GameID]
	if !ok {
		return TableSummary{}, ErrUnknownGame
	}
	normalized, err := game.normalize(newState)
	if err != nil {
		return TableSummary{}, err
	}

	updated, err := s.Queries.UpdateGameTableState(ctx, db.UpdateGameTableStateParams{
		ID:        pgID,
		Version:   expectedVersion,
		GameState: normalized,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The conditional update (version check) matched nothing: either the
		// table vanished or the version is stale. Report the current row so
		// the caller can merge and retry.
		fresh, getErr := s.Queries.GetGameTable(ctx, pgID)
		if errors.Is(getErr, pgx.ErrNoRows) {
			return TableSummary{}, ErrTableNotFound
		}
		if getErr != nil {
			return TableSummary{}, getErr
		}
		summary, sumErr := s.toSummary(fresh)
		if sumErr != nil {
			return TableSummary{}, sumErr
		}
		return summary, ErrTableVersionConflict
	}
	if err != nil {
		return TableSummary{}, err
	}
	summary, err := s.toSummary(updated)
	if err != nil {
		return TableSummary{}, err
	}
	s.broadcast(tableID, summary)
	return summary, nil
}

func (s *TableService) JoinTable(ctx context.Context, tableID, playerID id.ID) (TableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return TableSummary{}, ErrTableNotFound
	}

	updated, err := s.Queries.AddGameTablePlayer(ctx, db.AddGameTablePlayerParams{
		ID:          pgID,
		ArrayAppend: playerID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Either table not found or player already in list (the WHERE NOT... returns no rows)
		// Check which case it is
		row, getErr := s.Queries.GetGameTable(ctx, pgID)
		if errors.Is(getErr, pgx.ErrNoRows) {
			return TableSummary{}, ErrTableNotFound
		}
		if getErr == nil {
			// Table exists — player was already in the list
			return s.toSummary(row)
		}
		return TableSummary{}, err
	}
	if err != nil {
		return TableSummary{}, err
	}
	summary, err := s.toSummary(updated)
	if err != nil {
		return TableSummary{}, err
	}
	s.broadcast(tableID, summary)
	// The roster changed: lobby consumers (header table indicator, "Активные
	// столы" card) refetch so the joining player sees their table right away.
	s.broadcastLobby()
	return summary, nil
}

// ─── Host takeover ────────────────────────────────────────────────────────────

// TakeoverTable claims hosting of the table for the requesting device
// (hostClientToken). The current host may always re-claim — this is how
// resuming on another device transfers hosting to it; any other user needs
// edit permission (allowNonHost, decided by the API layer). The broadcast
// summary carries the new host_user_id and client token, so a displaced host
// — including the same user's other device — steps down on the next snapshot.
func (s *TableService) TakeoverTable(ctx context.Context, tableID, userID id.ID, hostClientToken string, allowNonHost bool) (TableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return TableSummary{}, ErrTableNotFound
	}
	row, err := s.Queries.GetGameTable(ctx, pgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return TableSummary{}, ErrTableNotFound
	}
	if err != nil {
		return TableSummary{}, err
	}
	if row.HostUserID != userID {
		if !allowNonHost {
			return TableSummary{}, ErrNotTableHost
		}
	}
	if row.HostUserID != userID || row.HostClientToken != hostClientToken {
		row, err = s.Queries.SetGameTableHost(ctx, db.SetGameTableHostParams{
			ID:              pgID,
			HostUserID:      userID,
			HostClientToken: hostClientToken,
		})
		if err != nil {
			return TableSummary{}, err
		}
	}

	summary, err := s.toSummary(row)
	if err != nil {
		return TableSummary{}, err
	}
	// Always broadcast, even on the idempotent path: the token change is what
	// tells the same user's other devices to step down.
	s.broadcast(tableID, summary)
	return summary, nil
}

// ─── Player submission ────────────────────────────────────────────────────────

// SubmitTable applies a connected player's input (bid, round result, or
// scoring) to the table's game state. The row is locked for the
// read-modify-write so concurrent submissions never lose updates; the raw
// submit body is decoded by the table's game into its own input shape.
func (s *TableService) SubmitTable(ctx context.Context, tableID, playerID id.ID, submit json.RawMessage) (TableSummary, error) {
	pgID, err := parseID(tableID)
	if err != nil {
		return TableSummary{}, ErrTableNotFound
	}

	updated, err := runInTxResult(ctx, s.Pool, func(q *db.Queries) (db.GameTable, error) {
		// The row is locked for the read-modify-write so concurrent
		// submissions never lose updates.
		row, err := q.GetGameTableForUpdate(ctx, pgID)
		if errors.Is(err, pgx.ErrNoRows) {
			return db.GameTable{}, ErrTableNotFound
		}
		if err != nil {
			return db.GameTable{}, err
		}
		game, ok := tableGames[row.GameID]
		if !ok {
			return db.GameTable{}, ErrUnknownGame
		}

		newState, err := game.applySubmit(row.GameState, playerID, submit)
		if err != nil {
			return db.GameTable{}, err
		}

		return q.UpdateGameTableState(ctx, db.UpdateGameTableStateParams{
			ID:        pgID,
			Version:   row.Version, // row is locked; the check always matches
			GameState: newState,
		})
	})
	if err != nil {
		return TableSummary{}, err
	}

	summary, err := s.toSummary(updated)
	if err != nil {
		return TableSummary{}, err
	}
	s.broadcast(tableID, summary)
	return summary, nil
}

func (s *TableService) DeleteTable(ctx context.Context, tableID, hostUserID id.ID, savedMatchID id.ID) error {
	pgID, err := parseID(tableID)
	if err != nil {
		return ErrTableNotFound
	}
	row, err := s.Queries.GetGameTable(ctx, pgID)
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
		// Host closed the table without saving: tell connected players it is
		// gone so they exit to the setup screen instead of discovering a 404
		// on their next reconnect.
		s.broadcastClosed(tableID)
	}
	if err := s.Queries.DeleteGameTable(ctx, pgID); err != nil {
		return err
	}
	s.broadcastLobby()
	return nil
}

// ─── Cleanup timer ────────────────────────────────────────────────────────────

func (s *TableService) DeleteExpiredTables(ctx context.Context) error {
	if err := s.Queries.DeleteExpiredGameTables(ctx); err != nil {
		return err
	}
	s.broadcastLobby()
	return nil
}

// ScheduleNextCleanup mirrors MarketService.ScheduleNextExpiry.
func (s *TableService) ScheduleNextCleanup(ctx context.Context) {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()

	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}

	nextExpiry, err := s.Queries.GetNearestGameTableExpiry(ctx)
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
			log.Printf("DeleteExpiredGameTables error: %v", err)
		}
		s.ScheduleNextCleanup(bgCtx)
	})
}
