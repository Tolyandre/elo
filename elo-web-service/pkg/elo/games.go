package elo

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/bgg"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
	"github.com/tolyandre/elo-web-service/pkg/tesera"
)

type GameTitles struct {
	Id            id.ID
	Name          string
	NameEn        string
	NameRu        string
	Alias         string
	BggRef        int64
	TeseraRef     int64
	ImageURL      string
	ImageThumbURL string
	GameMode      string
	TotalMatches  int
	Tags          []TagRef
}

// Game modes of a game (ADR-33). A match's mode is resolved from these plus
// the per-match request; the resolution is snapshotted onto matches.mode.
const (
	GameModeCompetitive = "competitive"
	GameModeCoop        = "coop"
	GameModeMixed       = "mixed"
)

// Match modes (ADR-33): the two ways a match can be recorded.
const (
	MatchModeCompetitive = "competitive"
	MatchModeCoop        = "coop"
)

// ErrInvalidGameMode: a game_mode value outside the known set.
var ErrInvalidGameMode = errors.New("unknown game mode")

// NormalizeGameMode validates a game_mode value; empty defaults to
// competitive (the mode of every game created before ADR-33).
func NormalizeGameMode(mode *string) (string, error) {
	if mode == nil || *mode == "" {
		return GameModeCompetitive, nil
	}
	switch *mode {
	case GameModeCompetitive, GameModeCoop, GameModeMixed:
		return strings.TrimSpace(*mode), nil
	}
	return "", ErrInvalidGameMode
}

// MatchModeForGame resolves a match's mode from its game's mode and the
// optional per-match request value (ADR-33). requestMode is "" when the
// request omitted it.
func MatchModeForGame(gameMode, requestMode string) (string, error) {
	switch gameMode {
	case GameModeCoop:
		return MatchModeCoop, nil
	case GameModeMixed:
		switch requestMode {
		case "", MatchModeCompetitive:
			return MatchModeCompetitive, nil
		case MatchModeCoop:
			return MatchModeCoop, nil
		}
		return "", ErrInvalidGameMode
	default:
		if requestMode == "" || requestMode == MatchModeCompetitive {
			return MatchModeCompetitive, nil
		}
		return "", ErrInvalidGameMode
	}
}

// RejectCoopGames validates that none of the referenced games is coop-only
// (ADR-33): coop games never produce rating matches, so markets and
// tournaments cannot be built on them. Unknown ids pass through — the
// foreign keys surface them.
func RejectCoopGames(ctx context.Context, q *db.Queries, gameIDs []id.ID) error {
	if len(gameIDs) == 0 {
		return nil
	}
	coop, err := q.FilterCoopGameIDs(ctx, gameIDs)
	if err != nil {
		return fmt.Errorf("check game modes: %w", err)
	}
	if len(coop) > 0 {
		return ErrCoopGameNotAllowed
	}
	return nil
}

// GameInfo is the slim single-game read (the game's arena data lives under
// the arena endpoints since ADR-24).
type GameInfo struct {
	ID            id.ID
	Name          string
	NameEn        string
	NameRu        string
	Alias         string
	BggRef        int64
	TeseraRef     int64
	ImageURL      string
	ImageThumbURL string
	GameMode      string
	TotalMatches  int
}

// GameMetaPatch is the desired metadata state of a game. For updates it is
// the complete new state (nil pointer = cleared field); for creation the
// canonical names/refs are optional suggestions accepted from the picker.
type GameMetaPatch struct {
	Alias     *string
	NameEn    *string
	NameRu    *string
	BggRef    *int64
	TeseraRef *int64
	GameMode  *string
}

// GameSuggestion is one catalogue match candidate for a name being typed.
// BGG-sourced candidates carry no TeseraRef; Tesera-only candidates may lack
// BggRef.
type GameSuggestion struct {
	TeseraRef  int64
	BggRef     int64
	NameRu     string
	NameEn     string
	Title      string
	Year       int32
	PhotoURL   string
	IsAddition bool
}

// SuggestResult carries the merged candidates plus per-source degradation
// flags: a configured source that errors narrows the result set instead of
// failing the request — the picker must keep working while one catalogue
// (typically Tesera behind its bot guard) is down.
type SuggestResult struct {
	Games             []GameSuggestion
	TeseraUnavailable bool
	BggUnavailable    bool
}

// AutoMatchResult reports the auto-match outcome for one previously
// unmatched game.
type AutoMatchResult struct {
	GameID  id.ID
	Name    string
	Matched bool
	Reason  string
}

// ArtRefreshResult reports the outcome of one game's on-demand box-art
// refresh: either new URLs were stored, or Reason says why not.
type ArtRefreshResult struct {
	GameID        id.ID
	Name          string
	Refreshed     bool
	ImageURL      string
	ImageThumbURL string
	Reason        string
}

var (
	// ErrGameNameRequired: an update would leave the game without any name
	// (alias, localized, and English all empty).
	ErrGameNameRequired = errors.New("at least one game name is required")
	// ErrGameBggRefMissing: an art refresh was requested for a game without
	// a BGG reference.
	ErrGameBggRefMissing = errors.New("game has no bgg reference")
	// ErrTeseraUnavailable: the Tesera client is not configured.
	ErrTeseraUnavailable = errors.New("tesera integration is unavailable")
	// ErrBggUnavailable: the BGG client is not configured (no API token).
	ErrBggUnavailable = errors.New("bgg integration is unavailable: ELO_WEB_SERVICE_BGG_API_ACCESS_TOKEN is not set on the server")
	// ErrCataloguesUnavailable: neither suggestion source is configured.
	ErrCataloguesUnavailable = errors.New("no catalogue integration is configured on the server")
)

type IGameService interface {
	GetGameTitlesOrderedByLastPlayed(ctx context.Context) ([]GameTitles, error)
	GetGameInfo(ctx context.Context, gameID id.ID) (*GameInfo, error)
	// ListFavoriteGames computes the game picker's «Избранные» tab for the
	// user: recently played games (their player or a club member) and the
	// most played games among their clubs.
	ListFavoriteGames(ctx context.Context, userID id.ID, limit int) (FavoriteGames, error)
	// DeleteGame/UpdateGame/AddGame record audit events for the actor
	// (ADR-14); a zero actor skips the audit row.
	DeleteGame(ctx context.Context, gameID id.ID, actor id.ID) (*db.Game, error)
	UpdateGame(ctx context.Context, gameID id.ID, meta GameMetaPatch, actor id.ID) (*db.Game, error)
	// AddGame takes the metadata of an accepted catalogue suggestion as an
	// optional trailing argument; without it the typed name is the only
	// canonical name.
	AddGame(ctx context.Context, gameID id.ID, name string, actor id.ID, meta ...GameMetaPatch) (*db.Game, error)
	SuggestGames(ctx context.Context, query string) (SuggestResult, error)
	AutoMatchGames(ctx context.Context, actor id.ID) ([]AutoMatchResult, error)
	// RefreshGameArt re-fetches and stores one game's box art from the BGG
	// XML API, overwriting whatever URLs are stored — the manual remedy for
	// wrong or stale art (the automatic paths only fill empty images).
	RefreshGameArt(ctx context.Context, gameID id.ID, actor id.ID) (ArtRefreshResult, error)
}

type GameService struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
	Arenas  *ArenaService
	Tesera  *tesera.Client
	Bgg     *bgg.Client
}

func NewGameService(pool *pgxpool.Pool, arenas *ArenaService, teseraClient *tesera.Client, bggClient *bgg.Client) IGameService {
	return &GameService{
		Queries: db.New(pool),
		Pool:    pool,
		Arenas:  arenas,
		Tesera:  teseraClient,
		Bgg:     bggClient,
	}
}

// Suggestion search/enrichment bounds: how many BGG search rows get their
// thing fetched per query (exactly one ≤20-id batch), how many Tesera search
// rows get their detail fetched per query (bggId/isAddition live only on the
// detail object), how many candidates are returned, and the overall deadline
// for one suggest request (both sources run in parallel under it; a source
// that misses the deadline reports its *_unavailable flag instead of hanging
// the picker — Tesera's guard retries alone can stretch into minutes).
const (
	suggestBggSearchLimit   = 20
	suggestDetailFetchLimit = 8
	suggestResultLimit      = 6
	suggestTimeout          = 12 * time.Second
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
			Id:            r.ID,
			Name:          r.Name,
			NameEn:        textOf(r.NameEn),
			NameRu:        textOf(r.NameRu),
			Alias:         textOf(r.Alias),
			BggRef:        int64Of(r.BggID),
			TeseraRef:     int64Of(r.TeseraID),
			ImageURL:      textOf(r.ImageUrl),
			ImageThumbURL: textOf(r.ImageThumbUrl),
			GameMode:      r.GameMode,
			TotalMatches:  int(r.TotalMatches),
			Tags:          tags,
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
		ID:            game.ID,
		Name:          game.Name,
		NameEn:        textOf(game.NameEn),
		NameRu:        textOf(game.NameRu),
		Alias:         textOf(game.Alias),
		BggRef:        int64Of(game.BggID),
		TeseraRef:     int64Of(game.TeseraID),
		ImageURL:      textOf(game.ImageUrl),
		ImageThumbURL: textOf(game.ImageThumbUrl),
		GameMode:      game.GameMode,
		TotalMatches:  int(total),
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
// alias → name_ru → name_en and must not end up empty; a collision with
// another game's display name surfaces the usual unique-constraint conflict.
func (s *GameService) UpdateGame(ctx context.Context, gameID id.ID, meta GameMetaPatch, actor id.ID) (*db.Game, error) {
	var updated *db.Game
	bggChanged := false
	err := runInTx(ctx, s.Pool, func(q *db.Queries) error {
		old, err := q.GetGameByID(ctx, gameID)
		if err != nil {
			return err
		}
		alias, nameEn, nameRu := trimmed(meta.Alias), trimmed(meta.NameEn), trimmed(meta.NameRu)
		name := displayName(alias, nameRu, nameEn)
		if name == "" {
			return ErrGameNameRequired
		}
		gameMode, err := NormalizeGameMode(meta.GameMode)
		if err != nil {
			return err
		}
		// games.name is a generated column (migration 063) — it follows the
		// three source names written here.
		g, err := q.UpdateGame(ctx, db.UpdateGameParams{
			ID:       gameID,
			NameEn:   pgText(nameEn),
			NameRu:   pgText(nameRu),
			Alias:    pgText(alias),
			BggID:    pgInt4(meta.BggRef),
			TeseraID: pgInt4(meta.TeseraRef),
			GameMode: gameMode,
		})
		if err != nil {
			return err
		}
		// A changed BGG reference invalidates the stored box art (it belongs
		// to the old thing); drop both URLs so the row reads as imageless
		// until the post-commit re-fetch lands. The returned row feeds the
		// audit diff, so the image columns appear in it as cleared.
		if int64Of(old.BggID) != int64Of(g.BggID) {
			bggChanged = true
			cleared, err := q.UpdateGameBggImages(ctx, db.UpdateGameBggImagesParams{
				ID:            gameID,
				ImageUrl:      pgText(""),
				ImageThumbUrl: pgText(""),
			})
			if err != nil {
				return err
			}
			g = cleared
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
		d := buildGameUpdateDetails(old, g)
		if !d.IsEmpty() {
			return recordAuditEvent(ctx, q, actor, audit.EntityGame, audit.ActionUpdated, gameID, audit.KindGameUpdate, d)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// A newly written BGG reference enriches box art in the background, same
	// as the create path — the images were just cleared above.
	if bggChanged && updated.BggID.Valid {
		s.scheduleBggEnrich(updated.ID)
	}
	return updated, nil
}

func (s *GameService) AddGame(ctx context.Context, gameID id.ID, name string, actor id.ID, meta ...GameMetaPatch) (*db.Game, error) {
	// Without an accepted suggestion the typed name is the only canonical
	// name; with one, a typed name equal to a canonical name (normalized)
	// is not an alias — only genuinely custom names become aliases.
	nameRu, nameEn := "", ""
	alias := ""
	var bgg, teseraRef *int64
	gameMode := GameModeCompetitive
	if len(meta) > 0 {
		m := meta[0]
		nameEn = trimmed(m.NameEn)
		nameRu = trimmed(m.NameRu)
		bgg, teseraRef = m.BggRef, m.TeseraRef
		var gerr error
		if gameMode, gerr = NormalizeGameMode(m.GameMode); gerr != nil {
			return nil, gerr
		}
		if nameEn == "" && nameRu == "" {
			nameEn = strings.TrimSpace(name)
		} else {
			display, derivedAlias := canonicalizeNames(name, nameRu, nameEn)
			alias = derivedAlias
			name = display
		}
	} else {
		nameEn = strings.TrimSpace(name)
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
			ID:       gameID,
			NameEn:   pgText(nameEn),
			NameRu:   pgText(nameRu),
			Alias:    pgText(alias),
			BggID:    pgInt4(bgg),
			TeseraID: pgInt4(teseraRef),
			GameMode: gameMode,
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
	// The accepted suggestion carries the BGG id — enrich box art in the
	// background so the create path stays latency- and failure-free; the
	// admin enrichment action is the catch-up for anything that slips.
	if len(meta) > 0 && meta[0].BggRef != nil && *meta[0].BggRef != 0 {
		s.scheduleBggEnrich(added.ID)
	}
	return added, nil
}

// SuggestGames merges the two catalogues for a name being typed. BoardGameGeek
// is the primary source: /xmlapi2/search finds the candidates, their things
// carry the canonical English title and the localized Russian title as
// alternate names, picked by script heuristics (pkg/bgg). Tesera enriches the
// BGG matches with its ids and adds its own rows for anything BGG lacks; its
// localized titles fill the Russian name where BGG's alternates stay
// ambiguous. Both sources are queried in parallel under one deadline —
// Tesera's DDoS-Guard retries alone can stretch a sequential run into
// minutes while the picker waits. A source failing alone degrades the result
// (reported in the flags) — typically Tesera behind its bot guard — and only
// a request with both catalogues unconfigured is an error.
func (s *GameService) SuggestGames(ctx context.Context, query string) (SuggestResult, error) {
	if s.Bgg == nil && s.Tesera == nil {
		return SuggestResult{}, ErrCataloguesUnavailable
	}
	res := SuggestResult{}
	sctx, cancel := context.WithTimeout(ctx, suggestTimeout)
	defer cancel()
	var candidates []*tesera.Candidate
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		res.Games, res.BggUnavailable = s.suggestFromBgg(sctx, query)
	}()
	go func() {
		defer wg.Done()
		candidates, res.TeseraUnavailable = s.teseraCandidates(sctx, query)
	}()
	wg.Wait()
	res.Games = mergeSuggestions(res.Games, candidates, query)
	return res, nil
}

// suggestFromBgg builds the BGG-sourced suggestions: search rows (one row per
// matched game — deduplicated), enriched with their things. A failed search
// or a fully failed thing fetch reports an outage; partial thing results ride
// along — a row without its thing still suggests from the search data.
func (s *GameService) suggestFromBgg(ctx context.Context, query string) ([]GameSuggestion, bool) {
	if s.Bgg == nil {
		return nil, false
	}
	results, err := s.Bgg.Search(ctx, query)
	if err != nil {
		return nil, true
	}
	// Search rows repeat a game when several of its names match; keep the
	// first (highest-ranked) row per game, then take the top slice.
	unique := make([]bgg.SearchResult, 0, len(results))
	seen := make(map[int64]bool, len(results))
	for _, r := range results {
		if !seen[r.BggID] {
			seen[r.BggID] = true
			unique = append(unique, r)
		}
	}
	if len(unique) > suggestBggSearchLimit {
		unique = unique[:suggestBggSearchLimit]
	}
	ids := make([]int64, 0, len(unique))
	for _, r := range unique {
		ids = append(ids, r.BggID)
	}
	if len(ids) == 0 {
		return nil, false
	}
	things, err := s.Bgg.GetThings(ctx, ids)
	if err != nil && len(things) == 0 {
		return nil, true
	}
	byID := make(map[int64]bgg.Thing, len(things))
	for _, t := range things {
		byID[t.BggID] = t
	}

	out := make([]GameSuggestion, 0, len(unique))
	for _, r := range unique {
		sugg := GameSuggestion{BggRef: r.BggID, Title: r.Name, Year: r.Year}
		if r.NameType == "primary" {
			sugg.NameEn = r.Name
		}
		if t, ok := byID[r.BggID]; ok {
			if t.PrimaryName != "" {
				sugg.Title = t.PrimaryName
				sugg.NameEn = t.PrimaryName
			}
			sugg.NameRu = bgg.PickRussianName(t.AlternateNames)
			sugg.Year = t.Year
			sugg.PhotoURL = t.ThumbURL
			sugg.IsAddition = t.IsExpansion
		}
		out = append(out, sugg)
	}
	return out, false
}

// teseraCandidates fetches the Tesera rows for the query with their detail
// objects. Tesera failing — its bot guard rejects bursts — never fails the
// query; only the search request failing counts as an outage, broken rows and
// failed details simply drop out.
func (s *GameService) teseraCandidates(ctx context.Context, query string) ([]*tesera.Candidate, bool) {
	if s.Tesera == nil {
		return nil, false
	}
	items, err := s.Tesera.SearchGames(ctx, query)
	if err != nil {
		return nil, true
	}
	var out []*tesera.Candidate
	seen := make(map[int64]bool, len(items))
	for i, item := range items {
		if i >= suggestDetailFetchLimit {
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
		out = append(out, cand)
	}
	return out, false
}

// mergeSuggestions attaches Tesera rows to their BGG matches (by the BGG id
// when Tesera knows it, otherwise by the normalized titles), appends the rest
// as Tesera-only rows, and sorts by query relevance: exact normalized match,
// then word-prefix match, then contains; base games before additions within a
// tier, shorter titles first (BGG's own rank survives as the stable
// tiebreak), capped at suggestResultLimit.
func mergeSuggestions(bggSuggestions []GameSuggestion, candidates []*tesera.Candidate, query string) []GameSuggestion {
	games := make([]GameSuggestion, 0, len(bggSuggestions)+len(candidates))
	used := make(map[int64]bool, len(candidates))
	for _, sugg := range bggSuggestions {
		for _, cand := range candidates {
			if used[cand.TeseraRef] || !candidateMatches(cand, sugg) {
				continue
			}
			used[cand.TeseraRef] = true
			sugg.TeseraRef = cand.TeseraRef
			// BGG's expansion flag is precise; Tesera's addition flag is not.
			if sugg.NameRu == "" {
				sugg.NameRu = cand.NameRu
			}
			break
		}
		games = append(games, sugg)
	}
	for _, cand := range candidates {
		if used[cand.TeseraRef] {
			continue
		}
		games = append(games, GameSuggestion{
			TeseraRef:  cand.TeseraRef,
			BggRef:     cand.BggRef,
			NameRu:     cand.NameRu,
			NameEn:     cand.NameEn,
			Title:      cand.Title,
			Year:       cand.Year,
			PhotoURL:   cand.PhotoURL,
			IsAddition: cand.IsAddition,
		})
	}

	type scored struct {
		suggestion GameSuggestion
		tier       int
		addition   bool
		titleLen   int
	}
	norm := tesera.NormalizeName(query)
	out := make([]scored, 0, len(games))
	for _, g := range games {
		out = append(out, scored{
			suggestion: g,
			tier:       suggestionTier(norm, g),
			addition:   g.IsAddition,
			titleLen:   len(tesera.NormalizeName(g.Title)),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].tier != out[j].tier {
			return out[i].tier < out[j].tier
		}
		if out[i].addition != out[j].addition {
			return !out[i].addition
		}
		return out[i].titleLen < out[j].titleLen
	})
	if len(out) > suggestResultLimit {
		out = out[:suggestResultLimit]
	}
	games = games[:0]
	for _, o := range out {
		games = append(games, o.suggestion)
	}
	return games
}

// suggestionTier ranks a candidate against the normalized query by its best
// matching name (title, English, Russian): 0 exact equality, 1 word-boundary
// prefix, 2 substring, 3 no match on any of them (the candidate matched via
// some other name the row does not carry). The prefix tier is what keeps a
// base game named "Eclipse: Second Dawn for the Galaxy" ahead of the flood
// of same-prefix expansions when the user types "eclipse".
func suggestionTier(norm string, g GameSuggestion) int {
	best := 3
	for _, name := range []string{g.Title, g.NameEn, g.NameRu} {
		nn := tesera.NormalizeName(name)
		var tier int
		switch {
		case norm == "" || nn == "":
			tier = 3
		case nn == norm:
			tier = 0
		case strings.HasPrefix(nn, norm+" "):
			tier = 1
		case strings.Contains(nn, norm):
			tier = 2
		default:
			tier = 3
		}
		if tier < best {
			best = tier
		}
	}
	return best
}

// candidateMatches ties a Tesera row to a BGG suggestion. The BGG id wins
// when Tesera knows it — that also pairs the rows whose titles differ
// (Каркассон ↔ Carcassonne with no Russian alternate on BGG); name equality
// over the normalized titles covers rows without a BGG link.
func candidateMatches(cand *tesera.Candidate, sugg GameSuggestion) bool {
	if cand.BggRef != 0 {
		return cand.BggRef == sugg.BggRef
	}
	return sameName(cand.NameEn, sugg.NameEn) ||
		sameName(cand.NameRu, sugg.NameRu) ||
		sameName(cand.Title, sugg.NameRu) ||
		sameName(cand.NameEn, sugg.Title)
}

func sameName(a, b string) bool {
	na, nb := tesera.NormalizeName(a), tesera.NormalizeName(b)
	return na != "" && na == nb
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
			_, alias := canonicalizeNames(g.Name, cand.NameRu, cand.NameEn)
			nameRu, nameEn := cand.NameRu, cand.NameEn
			// The patch is full-state: carry the game's own mode through so
			// an auto-match never resets it (ADR-33), and its BGG reference
			// when the Tesera match knows no BGG link — a NULL would erase a
			// good reference along with its box art.
			mode := g.GameMode
			bgg := int64Of(g.BggID)
			if cand.BggRef != 0 {
				bgg = cand.BggRef
			}
			teseraRef := cand.TeseraRef
			patch := GameMetaPatch{
				Alias:     strPtr(alias),
				NameEn:    strPtr(nameEn),
				NameRu:    strPtr(nameRu),
				BggRef:    &bgg,
				TeseraRef: &teseraRef,
				GameMode:  &mode,
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

// findExactMatch returns the candidate whose localized or English title
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

// RefreshGameArt re-fetches and stores one game's box art by its stored BGG
// reference, overwriting whatever URLs are already there — the manual remedy
// for wrong or stale art (the automatic paths only fill empty images). BGG
// knowing no such thing, or the thing carrying no art, reports a reason
// instead of touching the stored URLs; a failed request surfaces as
// ErrBggUnavailable.
func (s *GameService) RefreshGameArt(ctx context.Context, gameID id.ID, actor id.ID) (ArtRefreshResult, error) {
	if s.Bgg == nil {
		return ArtRefreshResult{}, ErrBggUnavailable
	}
	game, err := s.Queries.GetGameByID(ctx, gameID)
	if err != nil {
		return ArtRefreshResult{}, fmt.Errorf("get game: %w", err)
	}
	if !game.BggID.Valid {
		return ArtRefreshResult{}, ErrGameBggRefMissing
	}
	res := ArtRefreshResult{GameID: game.ID, Name: game.Name}
	things, err := s.Bgg.GetThings(ctx, []int64{int64(game.BggID.Int32)})
	if err != nil {
		return ArtRefreshResult{}, fmt.Errorf("%w: %w", ErrBggUnavailable, err)
	}
	if len(things) == 0 {
		res.Reason = "not found on BGG"
		return res, nil
	}
	thing := things[0]
	if thing.ImageURL == "" && thing.ThumbURL == "" {
		res.Reason = "no image on BGG"
		return res, nil
	}
	if err := s.applyBggImages(ctx, gameID, thing, actor); err != nil {
		return ArtRefreshResult{}, fmt.Errorf("store images: %w", err)
	}
	res.Refreshed = true
	res.ImageURL = thing.ImageURL
	res.ImageThumbURL = thing.ThumbURL
	return res, nil
}

// applyBggImages persists one game's box-art URLs in its own transaction,
// auditing whenever a stored URL actually changes (a first fill records the
// To side only; an overwrite by a manual refresh records From→To). A
// concurrent apply cannot double-audit: the row is re-read inside the
// transaction and unchanged URLs record nothing.
func (s *GameService) applyBggImages(ctx context.Context, gameID id.ID, thing bgg.Thing, actor id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		current, err := q.GetGameByID(ctx, gameID)
		if err != nil {
			return err
		}
		imageURL, imageThumbURL := pgText(thing.ImageURL), pgText(thing.ThumbURL)
		if _, err := q.UpdateGameBggImages(ctx, db.UpdateGameBggImagesParams{
			ID:            gameID,
			ImageUrl:      imageURL,
			ImageThumbUrl: imageThumbURL,
		}); err != nil {
			return err
		}
		d := audit.NewGameUpdateDetails()
		if textOf(current.ImageUrl) != textOf(imageURL) {
			d.ImageURL = textChange(current.ImageUrl, imageURL)
		}
		if textOf(current.ImageThumbUrl) != textOf(imageThumbURL) {
			d.ImageThumbURL = textChange(current.ImageThumbUrl, imageThumbURL)
		}
		if !d.IsEmpty() {
			return recordAuditEvent(ctx, q, actor, audit.EntityGame, audit.ActionUpdated, gameID, audit.KindGameUpdate, d)
		}
		return nil
	})
}

// scheduleBggEnrich enriches one freshly accepted game in the background.
// Errors are only logged — the admin enrichment action is the catch-up.
func (s *GameService) scheduleBggEnrich(gameID id.ID) {
	if s.Bgg == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := s.enrichGameByID(ctx, gameID); err != nil {
			log.Printf("bgg enrich for game %s: %v", gameID, err)
		}
	}()
}

func (s *GameService) enrichGameByID(ctx context.Context, gameID id.ID) error {
	game, err := s.Queries.GetGameByID(ctx, gameID)
	if err != nil {
		return fmt.Errorf("get game: %w", err)
	}
	if !game.BggID.Valid || game.ImageUrl.Valid || game.ImageThumbUrl.Valid {
		return nil
	}
	things, err := s.Bgg.GetThings(ctx, []int64{int64(game.BggID.Int32)})
	if err != nil {
		return fmt.Errorf("bgg thing: %w", err)
	}
	if len(things) == 0 {
		return nil
	}
	// An empty actor records the audit event as a system event.
	return s.applyBggImages(ctx, gameID, things[0], id.ID(""))
}

// displayName is the stored games.name: alias if set, else the localized,
// else the English name. Never empty for a valid row.
func displayName(alias, nameRu, nameEn string) string {
	for _, n := range []string{alias, nameRu, nameEn} {
		if n != "" {
			return n
		}
	}
	return ""
}

// canonicalizeNames derives the alias and stored display name from the typed
// name and the canonical names: a typed name equal to a canonical name
// (normalized) replaces it as the display name instead of becoming an alias.
func canonicalizeNames(typed, nameRu, nameEn string) (display, alias string) {
	for _, canonical := range []string{nameRu, nameEn} {
		if canonical != "" && tesera.NormalizeName(typed) == tesera.NormalizeName(canonical) {
			return canonical, ""
		}
	}
	return typed, typed
}

// buildGameUpdateDetails diffs a game meta edit field by field — the old row
// before the rewrite against the row after it, rename included (the display
// name follows alias/name_ru/name_en).
func buildGameUpdateDetails(old, new db.Game) audit.GameUpdateDetails {
	d := audit.NewGameUpdateDetails()
	if old.Name != new.Name {
		d.Name = strChange(old.Name, new.Name)
	}
	if textOf(old.Alias) != textOf(new.Alias) {
		d.Alias = textChange(old.Alias, new.Alias)
	}
	if textOf(old.NameRu) != textOf(new.NameRu) {
		d.NameRu = textChange(old.NameRu, new.NameRu)
	}
	if textOf(old.NameEn) != textOf(new.NameEn) {
		d.NameEn = textChange(old.NameEn, new.NameEn)
	}
	if int64Of(old.BggID) != int64Of(new.BggID) {
		d.BggRef = &audit.RefChange{From: int4Ref(old.BggID), To: int4Ref(new.BggID)}
	}
	if int64Of(old.TeseraID) != int64Of(new.TeseraID) {
		d.TeseraRef = &audit.RefChange{From: int4Ref(old.TeseraID), To: int4Ref(new.TeseraID)}
	}
	if textOf(old.ImageUrl) != textOf(new.ImageUrl) {
		d.ImageURL = textChange(old.ImageUrl, new.ImageUrl)
	}
	if textOf(old.ImageThumbUrl) != textOf(new.ImageThumbUrl) {
		d.ImageThumbURL = textChange(old.ImageThumbUrl, new.ImageThumbUrl)
	}
	if old.GameMode != new.GameMode {
		d.GameMode = &audit.StringChange{From: old.GameMode, To: new.GameMode}
	}
	return d
}

func strChange(from, to string) *audit.ValueChange {
	return &audit.ValueChange{From: &from, To: &to}
}

func textChange(from, to pgtype.Text) *audit.ValueChange {
	return &audit.ValueChange{From: textPtr(from), To: textPtr(to)}
}

// int4Ref reports a nullable int reference for a diff side: an invalid
// (NULL) column reads as null, not zero.
func int4Ref(i pgtype.Int4) *int64 {
	if !i.Valid {
		return nil
	}
	v := int64(i.Int32)
	return &v
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
