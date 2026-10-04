package elo

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/tesera"
)

type GameTitles struct {
	Id           id.ID
	Name         string
	NameOriginal string
	NameRu       string
	Alias        string
	BggRef       int64
	TeseraRef    int64
	TotalMatches int
	Tags         []TagRef
}

// GameInfo is the slim single-game read (the game's arena data lives under
// the arena endpoints since ADR-24).
type GameInfo struct {
	ID           id.ID
	Name         string
	NameOriginal string
	NameRu       string
	Alias        string
	BggRef       int64
	TeseraRef    int64
	TotalMatches int
}

// GameMetaPatch is the desired metadata state of a game. For updates it is
// the complete new state (nil pointer = cleared field); for creation the
// canonical names/refs are optional suggestions accepted from the picker.
type GameMetaPatch struct {
	Alias        *string
	NameOriginal *string
	NameRu       *string
	BggRef       *int64
	TeseraRef    *int64
}

// GameSuggestion is one Tesera match candidate for a name being typed.
type GameSuggestion struct {
	TeseraRef    int64
	BggRef       int64
	NameRu       string
	NameOriginal string
	Title        string
	Year         int32
	PhotoURL     string
	IsAddition   bool
}

// AutoMatchResult reports the auto-match outcome for one previously
// unmatched game.
type AutoMatchResult struct {
	GameID  id.ID
	Name    string
	Matched bool
	Reason  string
}

var (
	// ErrGameNameRequired: an update would leave the game without any name
	// (alias, localized, and original all empty).
	ErrGameNameRequired = errors.New("at least one game name is required")
	// ErrTeseraUnavailable: the Tesera client is not configured.
	ErrTeseraUnavailable = errors.New("tesera integration is unavailable")
)

type IGameService interface {
	GetGameTitlesOrderedByLastPlayed(ctx context.Context) ([]GameTitles, error)
	GetGameInfo(ctx context.Context, gameID id.ID) (*GameInfo, error)
	// DeleteGame/UpdateGame/AddGame record audit events for the actor
	// (ADR-14); a zero actor skips the audit row.
	DeleteGame(ctx context.Context, gameID id.ID, actor id.ID) (*db.Game, error)
	UpdateGame(ctx context.Context, gameID id.ID, meta GameMetaPatch, actor id.ID) (*db.Game, error)
	// AddGame takes the metadata of an accepted catalogue suggestion as an
	// optional trailing argument; without it the typed name is the only
	// canonical name.
	AddGame(ctx context.Context, gameID id.ID, name string, actor id.ID, meta ...GameMetaPatch) (*db.Game, error)
	SuggestGames(ctx context.Context, query string) ([]GameSuggestion, error)
	AutoMatchGames(ctx context.Context, actor id.ID) ([]AutoMatchResult, error)
}

type GameService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Arenas  *ArenaService
	Tesera  *tesera.Client
}

func NewGameService(pool *pgxpool.Pool, arenas *ArenaService, teseraClient *tesera.Client) IGameService {
	return &GameService{
		Queries: db.New(pool),
		Pool:    pool,
		Arenas:  arenas,
		Tesera:  teseraClient,
	}
}

// Suggestion search/enrichment bounds: how many search rows get their detail
// fetched per query (bggId/isAddition live only on the detail object) and how
// many candidates are returned.
const (
	suggestDetailFetchLimit = 8
	suggestResultLimit      = 6
	// autoMatchThrottle spaces out requests to the undocumented Tesera API
	// while bulk-matching the catalogue; the client adds retries with backoff
	// for DDos-Guard's bursty 403s on top.
	autoMatchThrottle = 500 * time.Millisecond
)

func (s *GameService) GetGameTitlesOrderedByLastPlayed(ctx context.Context) ([]GameTitles, error) {
	rows, err := s.Queries.ListGamesOrderedByLastPlayed(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve games from db: %w", err)
	}

	tagRows, err := s.Queries.ListGameTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve game tags from db: %w", err)
	}
	tagsByGame := make(map[id.ID][]TagRef, len(rows))
	for _, t := range tagRows {
		tagsByGame[t.GameID] = append(tagsByGame[t.GameID], TagRef{Id: t.TagID, Name: t.TagName})
	}

	gameList := make([]GameTitles, 0, len(rows))
	for _, r := range rows {
		tags := tagsByGame[r.ID]
		if tags == nil {
			tags = []TagRef{}
		}
		gameList = append(gameList, GameTitles{
			Id:           r.ID,
			Name:         r.Name,
			NameOriginal: textOf(r.NameOriginal),
			NameRu:       textOf(r.NameRu),
			Alias:        textOf(r.Alias),
			BggRef:       int64Of(r.BggID),
			TeseraRef:    int64Of(r.TeseraID),
			TotalMatches: int(r.TotalMatches),
			Tags:         tags,
		})
	}

	return gameList, nil
}

// GetGameInfo returns the game's name and total match count. The game row is
// read FOR UPDATE-free by pk; a missing game surfaces as the raw no-rows
// error, which the handler maps to 404.
func (s *GameService) GetGameInfo(ctx context.Context, gameID id.ID) (*GameInfo, error) {
	game, err := s.Queries.GetGameByID(ctx, gameID)
	if err != nil {
		return nil, err
	}
	total, err := s.Queries.GetCountMatchesByGame(ctx, gameID)
	if err != nil {
		return nil, fmt.Errorf("get match count: %w", err)
	}
	return &GameInfo{
		ID:           game.ID,
		Name:         game.Name,
		NameOriginal: textOf(game.NameOriginal),
		NameRu:       textOf(game.NameRu),
		Alias:        textOf(game.Alias),
		BggRef:       int64Of(game.BggID),
		TeseraRef:    int64Of(game.TeseraID),
		TotalMatches: int(total),
	}, nil
}

func (s *GameService) DeleteGame(ctx context.Context, gameID id.ID, actor id.ID) (*db.Game, error) {
	// DeleteGame returns the deleted row, so the audit event captures the name
	// without a pre-read. Atomic with the delete via runInTx (ADR-14).
	var deleted *db.Game
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		g, err := q.DeleteGame(ctx, gameID)
		if err != nil {
			return err
		}
		deleted = &g
		return recordAuditEvent(ctx, q, actor, audit.EntityGame, audit.ActionDeleted, gameID, audit.KindEntity, audit.NewEntityDetails(g.Name))
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

// UpdateGame replaces the game's metadata. The display name is recomputed as
// alias → name_ru → name_original and must not end up empty; a collision with
// another game's display name surfaces the usual unique-constraint conflict.
func (s *GameService) UpdateGame(ctx context.Context, gameID id.ID, meta GameMetaPatch, actor id.ID) (*db.Game, error) {
	var updated *db.Game
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetGameByID(ctx, gameID)
		if err != nil {
			return err
		}
		alias, nameOriginal, nameRu := trimmed(meta.Alias), trimmed(meta.NameOriginal), trimmed(meta.NameRu)
		name := displayName(alias, nameRu, nameOriginal)
		if name == "" {
			return ErrGameNameRequired
		}
		g, err := q.UpdateGame(ctx, db.UpdateGameParams{
			ID:           gameID,
			Name:         name,
			NameOriginal: pgText(nameOriginal),
			NameRu:       pgText(nameRu),
			Alias:        pgText(alias),
			BggID:        pgInt4(meta.BggRef),
			TeseraID:     pgInt4(meta.TeseraRef),
		})
		if err != nil {
			return err
		}
		updated = &g
		// The game's arena is auto-managed: its name follows the game's.
		if arena, aerr := q.GetArenaByGame(ctx, &gameID); aerr == nil {
			a, err := arenaFromGetArenaByGameRow(arena)
			if err != nil {
				return err
			}
			if err := s.Arenas.SyncArenaName(ctx, q, a, name); err != nil {
				return err
			}
		} else if !db.IsNoRows(aerr) {
			return aerr
		}
		switch {
		case old.Name != name:
			return recordAuditEvent(ctx, q, actor, audit.EntityGame, audit.ActionRenamed, gameID, audit.KindRename, audit.NewRenameDetails(old.Name, name))
		case gameMetaChanged(old, alias, nameOriginal, nameRu, meta):
			return recordAuditEvent(ctx, q, actor, audit.EntityGame, audit.ActionUpdated, gameID, audit.KindEntity, audit.NewEntityDetails(name))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *GameService) AddGame(ctx context.Context, gameID id.ID, name string, actor id.ID, meta ...GameMetaPatch) (*db.Game, error) {
	// Without an accepted suggestion the typed name is the only canonical
	// name; with one, a typed name equal to a canonical name (normalized)
	// is not an alias — only genuinely custom names become aliases.
	nameRu, nameOriginal := "", ""
	alias := ""
	var bgg, teseraRef *int64
	if len(meta) > 0 {
		m := meta[0]
		nameOriginal = trimmed(m.NameOriginal)
		nameRu = trimmed(m.NameRu)
		bgg, teseraRef = m.BggRef, m.TeseraRef
		if nameOriginal == "" && nameRu == "" {
			nameOriginal = strings.TrimSpace(name)
		} else {
			display, derivedAlias := canonicalizeNames(name, nameRu, nameOriginal)
			alias = derivedAlias
			name = display
		}
	} else {
		nameOriginal = strings.TrimSpace(name)
	}

	var added *db.Game
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		// AddGame upserts on id; an idempotent replay must not emit a second
		// created event, so audit only genuinely new rows. A zero id cannot
		// exist yet — skip the probe and let AddGame surface the error.
		isNew := true
		if !gameID.IsZero() {
			_, err := q.GetGameByID(ctx, gameID)
			isNew = db.IsNoRows(err)
			if err != nil && !isNew {
				return err
			}
		}
		g, err := q.AddGame(ctx, db.AddGameParams{
			ID:           gameID,
			Name:         name,
			NameOriginal: pgText(nameOriginal),
			NameRu:       pgText(nameRu),
			Alias:        pgText(alias),
			BggID:        pgInt4(bgg),
			TeseraID:     pgInt4(teseraRef),
		})
		if err != nil {
			return err
		}
		added = &g
		// Every game gets its own arena (ADR-24); it starts stale and the
		// background worker fills it.
		if isNew {
			if err := s.Arenas.EnsureGameArena(ctx, q, gameID, name); err != nil {
				return err
			}
			return recordAuditEvent(ctx, q, actor, audit.EntityGame, audit.ActionCreated, gameID, audit.KindEntity, audit.NewEntityDetails(name))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return added, nil
}

// SuggestGames searches Tesera for games matching the query. Exact
// (normalized) name matches sort first, then base games, then Tesera-flagged
// additions (the flag is unreliable — some base games carry it — so nothing
// is filtered out of the picker).
func (s *GameService) SuggestGames(ctx context.Context, query string) ([]GameSuggestion, error) {
	if s.Tesera == nil {
		return nil, ErrTeseraUnavailable
	}
	items, err := s.Tesera.SearchGames(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("tesera search: %w", err)
	}

	type scored struct {
		suggestion GameSuggestion
		exact      bool
		addition   bool
	}
	var out []scored
	seen := make(map[int64]bool, len(items))
	for i, item := range items {
		if i >= suggestDetailFetchLimit || len(out) >= suggestResultLimit {
			break
		}
		if seen[item.TeseraID] {
			continue
		}
		detail, derr := s.Tesera.GetGame(ctx, item.Alias)
		if derr != nil {
			continue // a broken search row must not fail the whole query
		}
		cand := tesera.CandidateFromDetail(detail)
		if cand == nil {
			continue
		}
		seen[cand.TeseraRef] = true
		out = append(out, scored{
			suggestion: GameSuggestion{
				TeseraRef:    cand.TeseraRef,
				BggRef:       cand.BggRef,
				NameRu:       cand.NameRu,
				NameOriginal: cand.NameOriginal,
				Title:        cand.Title,
				Year:         cand.Year,
				PhotoURL:     cand.PhotoURL,
				IsAddition:   cand.IsAddition,
			},
			exact:    cand.MatchesName(query),
			addition: cand.IsAddition,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].exact != out[j].exact {
			return out[i].exact
		}
		if out[i].addition != out[j].addition {
			return !out[i].addition
		}
		return false
	})

	suggestions := make([]GameSuggestion, 0, len(out))
	for _, o := range out {
		suggestions = append(suggestions, o.suggestion)
	}
	return suggestions, nil
}

// AutoMatchGames matches every game lacking a Tesera reference against the
// Tesera catalogue. Only exact normalized matches are applied (base games
// preferred over Tesera-flagged additions; each applied in its own
// transaction with an audit row); everything else — ambiguous names, Tesera
// errors — is reported and left for manual matching in the admin UI.
// Per-game failures never abort the run.
func (s *GameService) AutoMatchGames(ctx context.Context, actor id.ID) ([]AutoMatchResult, error) {
	if s.Tesera == nil {
		return nil, ErrTeseraUnavailable
	}
	rows, err := s.Queries.ListGamesWithoutTeseraRef(ctx)
	if err != nil {
		return nil, fmt.Errorf("list unmatched games: %w", err)
	}

	results := make([]AutoMatchResult, 0, len(rows))
	for _, g := range rows {
		res := AutoMatchResult{GameID: g.ID, Name: g.Name}
		cand, cerr := s.findExactMatch(ctx, g.Name)
		switch {
		case cerr != nil:
			res.Reason = "tesera unavailable"
		case cand == nil:
			res.Reason = "no exact match"
		default:
			_, alias := canonicalizeNames(g.Name, cand.NameRu, cand.NameOriginal)
			nameRu, nameOriginal := cand.NameRu, cand.NameOriginal
			bgg, teseraRef := cand.BggRef, cand.TeseraRef
			patch := GameMetaPatch{
				Alias:        strPtr(alias),
				NameOriginal: strPtr(nameOriginal),
				NameRu:       strPtr(nameRu),
				BggRef:       &bgg,
				TeseraRef:    &teseraRef,
			}
			if _, uerr := s.UpdateGame(ctx, g.ID, patch, actor); uerr != nil {
				res.Reason = "name conflict"
			} else {
				res.Matched = true
			}
		}
		results = append(results, res)
		if cerr == nil {
			time.Sleep(autoMatchThrottle)
		}
	}
	return results, nil
}

// findExactMatch returns the candidate whose localized or original title
// equals name (normalized), preferring a base game when Tesera flags several
// matches as additions (the flag is unreliable in both directions). Nil when
// nothing matches exactly.
func (s *GameService) findExactMatch(ctx context.Context, name string) (*tesera.Candidate, error) {
	items, err := s.Tesera.SearchGames(ctx, name)
	if err != nil {
		return nil, err
	}
	var flaggedExact *tesera.Candidate
	detailAttempts, detailFailures := 0, 0
	for i, item := range items {
		if i >= suggestDetailFetchLimit {
			break
		}
		detailAttempts++
		detail, derr := s.Tesera.GetGame(ctx, item.Alias)
		if derr != nil {
			detailFailures++
			continue
		}
		cand := tesera.CandidateFromDetail(detail)
		if cand == nil || !cand.MatchesName(name) {
			continue
		}
		if !cand.IsAddition {
			return cand, nil
		}
		if flaggedExact == nil {
			flaggedExact = cand
		}
	}
	// The search worked but every detail fetch failed — rate limiting, not a
	// genuinely unmatched game; report it so the run can be resumed.
	if detailAttempts > 0 && detailFailures == detailAttempts {
		return nil, fmt.Errorf("tesera detail fetches failed for %q", name)
	}
	return flaggedExact, nil
}

// displayName is the stored games.name: alias if set, else the localized,
// else the original name. Never empty for a valid row.
func displayName(alias, nameRu, nameOriginal string) string {
	for _, n := range []string{alias, nameRu, nameOriginal} {
		if n != "" {
			return n
		}
	}
	return ""
}

// canonicalizeNames derives the alias and stored display name from the typed
// name and the canonical names: a typed name equal to a canonical name
// (normalized) replaces it as the display name instead of becoming an alias.
func canonicalizeNames(typed, nameRu, nameOriginal string) (display, alias string) {
	for _, canonical := range []string{nameRu, nameOriginal} {
		if canonical != "" && tesera.NormalizeName(typed) == tesera.NormalizeName(canonical) {
			return canonical, ""
		}
	}
	return typed, typed
}

// gameMetaChanged reports whether the metadata update touches anything
// besides the (unchanged) display name.
func gameMetaChanged(old db.Game, alias, nameOriginal, nameRu string, meta GameMetaPatch) bool {
	return textOf(old.Alias) != alias ||
		textOf(old.NameOriginal) != nameOriginal ||
		textOf(old.NameRu) != nameRu ||
		int64Of(old.BggID) != derefInt64(meta.BggRef) ||
		int64Of(old.TeseraID) != derefInt64(meta.TeseraRef)
}

func trimmed(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}

func textOf(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func int64Of(i pgtype.Int4) int64 {
	if !i.Valid {
		return 0
	}
	return int64(i.Int32)
}

func derefInt64(i *int64) int64 {
	if i == nil {
		return 0
	}
	return *i
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func pgInt4(i *int64) pgtype.Int4 {
	if i == nil || *i == 0 || *i < -1<<31 || *i > 1<<31-1 {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*i), Valid: true}
}

func reduce[T, M any](s []T, f func(M, *T) M, initValue M) M {
	acc := initValue
	for _, v := range s {
		acc = f(acc, &v)
	}
	return acc
}
