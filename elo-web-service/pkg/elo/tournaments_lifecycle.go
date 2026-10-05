package elo

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/rand"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/arenasettings"
	"github.com/tolyandre/elo-web-service/pkg/audit"
	"github.com/tolyandre/elo-web-service/pkg/bracket"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// ---------------------------------------------------------------------------
// Start, cancel, bracket (ADR-26 §Start / §Lifecycle)
// ---------------------------------------------------------------------------

// Slot statuses (tournament_slots.status).
const (
	TournamentSlotWaiting   = "waiting"
	TournamentSlotPlaying   = "playing"
	TournamentSlotCompleted = "completed"
)

// StartTournament validates the submitted plan against a fresh enumeration,
// stores it verbatim, generates all rounds/slots/seats with a seeded draw,
// creates the tournament arena, and flips the lifecycle to running — one
// transaction.
func (s *TournamentService) StartTournament(ctx context.Context, tid id.ID, planRaw json.RawMessage, actorUserID id.ID) error {
	plan, err := bracket.ParsePlan(planRaw)
	if err != nil {
		return err
	}
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		if err := s.enforceDeadlineTx(ctx, q); err != nil {
			return err
		}
		t, err := q.GetTournamentForUpdate(ctx, tid)
		if err != nil {
			return fmt.Errorf("get tournament: %w", err)
		}
		if t.Status != TournamentRegistration {
			return ErrTournamentAlreadyStarted
		}
		if t.GrandFinalDeadline.Valid && !t.GrandFinalDeadline.Time.After(time.Now()) {
			return ErrTournamentDeadlineInvalid
		}
		participants, err := tournamentParticipantIDs(ctx, q, tid)
		if err != nil {
			return err
		}
		if len(participants) < 2 {
			return ErrTournamentTooFewParticipants
		}
		pool, err := q.ListTournamentGames(ctx, tid)
		if err != nil {
			return fmt.Errorf("list pool: %w", err)
		}
		if len(pool) == 0 {
			return ErrTournamentPoolEmpty
		}

		// The submitted plan must be one the server would have offered — no
		// hand-forged structures (ADR-26). The shape-picker list applies its
		// cap after the display filters, so an offered plan can rank beyond
		// the unfiltered head; OffersPlan searches the whole enumeration
		// instead of a capped prefix.
		if !bracket.OffersPlan(len(participants), poolCaps(pool), plan.Elimination, plan) {
			return ErrTournamentPlanInvalid
		}
		canonical := plan.CanonicalJSON()

		// Seeded draw: participants sorted by id, Fisher–Yates from the stored
		// seed — the same inputs always reproduce the same bracket.
		seed := randomSeed()
		rng := rand.New(rand.NewSource(seed))
		draw := slices.Clone(participants)
		slices.Sort(draw)
		rng.Shuffle(len(draw), func(i, j int) { draw[i], draw[j] = draw[j], draw[i] })
		cursor := 0
		takeDrawn := func() (id.ID, error) {
			if cursor >= len(draw) {
				// Unreachable for an offered plan: draw + bye seats number
				// exactly the participant count (bye seats are the
				// not-yet-played remainder; a played player never waits).
				// Kept as a guard so a future invariant slip fails the start
				// instead of panicking.
				return id.ID(""), ErrTournamentPlanInvalid
			}
			p := draw[cursor]
			cursor++
			return p, nil
		}

		// Materialize: rounds/slots/seats in canonical plan order. Draw and
		// bye seats take the next drawn players directly (round-1 tables
		// first, then the bye seats — byes are the round-1 remainder, emitted
		// at the tail); source seats stay unresolved until their source slot
		// completes.
		fitting := fittingGames(pool)
		slotIDs := make(map[int]id.ID) // flat plan slot index → slot row id
		flat := 0
		for roundPos, pr := range plan.Rounds {
			roundID := id.New()
			if _, err := q.CreateTournamentRound(ctx, db.CreateTournamentRoundParams{
				ID: roundID, TournamentID: tid, Track: pr.Track, Index: int32(pr.Index),
			}); err != nil {
				return fmt.Errorf("create round: %w", err)
			}
			for slotPos, ps := range pr.Slots {
				game := pickGame(rng, fitting[ps.SeatCount])
				slotID := id.New()
				status := TournamentSlotWaiting
				if roundPos == 0 {
					status = TournamentSlotPlaying
				}
				if _, err := q.CreateTournamentSlot(ctx, db.CreateTournamentSlotParams{
					ID: slotID, RoundID: roundID, Position: int32(slotPos + 1),
					GameID: game, Advance: int32(pr.Advance), Status: status,
				}); err != nil {
					return fmt.Errorf("create slot: %w", err)
				}
				slotIDs[flat] = slotID
				flat++
				for seatPos, seat := range ps.Seats {
					var playerID *id.ID
					if seat.Kind == bracket.SeatDraw || seat.Kind == bracket.SeatBye {
						p, err := takeDrawn()
						if err != nil {
							return err
						}
						playerID = &p
					}
					var sourceSlotID *id.ID
					if seat.Kind == bracket.SeatSource {
						slot := 0
						if seat.SourceSlot != nil {
							slot = *seat.SourceSlot
						}
						sid := slotIDs[slot]
						sourceSlotID = &sid
					}
					var sourcePlace pgtype.Int4
					if seat.Kind == bracket.SeatSource {
						sourcePlace = pgtype.Int4{Int32: int32(seat.SourcePlace), Valid: true}
					}
					if err := q.CreateTournamentSeat(ctx, db.CreateTournamentSeatParams{
						ID: id.New(), SlotID: slotID, Position: int32(seatPos + 1),
						PlayerID: playerID, SourceSlotID: sourceSlotID, SourcePlace: sourcePlace,
					}); err != nil {
						return fmt.Errorf("create seat: %w", err)
					}
				}
			}
		}

		// The tournament arena (ADR-24 anchor, no filter, no leagues) —
		// rating, medals and the standings table come for free through the
		// arena pipeline.
		if err := s.ensureTournamentArena(ctx, q, tid, t.Name); err != nil {
			return err
		}

		if err := q.SetTournamentRunning(ctx, db.SetTournamentRunningParams{
			ID: tid, Seed: pgtype.Int8{Int64: seed, Valid: true}, Plan: []byte(canonical), PlanSchemaVersion: db.PlanSchemaVersion,
			Elimination: pgtype.Text{String: plan.Elimination, Valid: true},
		}); err != nil {
			return fmt.Errorf("set running: %w", err)
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindTournamentStart, audit.NewTournamentStartDetails([]byte(canonical), seed, idStrings(participants)))
	})
}

// CancelTournament aborts the tournament from registration or running (the
// organizer action; the grand-final deadline auto-cancel in slotplay.go
// shares the state write with reason "deadline").
func (s *TournamentService) CancelTournament(ctx context.Context, tid, actorUserID id.ID) error {
	return runInTx(ctx, s.Pool, func(q *db.Queries) error {
		t, err := q.GetTournamentForUpdate(ctx, tid)
		if err != nil {
			return fmt.Errorf("get tournament: %w", err)
		}
		if t.Status != TournamentRegistration && t.Status != TournamentRunning {
			return ErrTournamentLifecycleInvalid
		}
		if err := q.SetTournamentStatus(ctx, db.SetTournamentStatusParams{ID: tid, Status: TournamentCancelled}); err != nil {
			return fmt.Errorf("cancel: %w", err)
		}
		// A cancelled tournament refunds its tournament-winner markets: a
		// tournament always ends in a champion or in cancelled, never in an
		// eternally open market.
		if s.Markets != nil {
			if err := s.Markets.CancelTournamentWinnerMarkets(ctx, q, tid); err != nil {
				return fmt.Errorf("cancel tournament winner markets: %w", err)
			}
		}
		return recordAuditEvent(ctx, q, actorUserID, audit.EntityTournament, audit.ActionUpdated, tid,
			audit.KindTournamentState, audit.NewTournamentStateDetails(t.Status, TournamentCancelled, audit.StateReasonOrganizer))
	})
}

// ValidateTournamentWinnerTarget checks that a tournament can back a
// tournament_winner market: it must exist, be running (its roster is frozen),
// and have at least two participants.
func (s *TournamentService) ValidateTournamentWinnerTarget(ctx context.Context, tid id.ID) error {
	t, err := s.Queries.GetTournament(ctx, tid)
	if err != nil {
		return fmt.Errorf("get tournament: %w", err)
	}
	if t.Status != TournamentRunning {
		return ErrTournamentNotRunning
	}
	count, err := s.Queries.CountTournamentParticipants(ctx, tid)
	if err != nil {
		return fmt.Errorf("count participants: %w", err)
	}
	if count < 2 {
		return ErrTournamentTooFewParticipants
	}
	return nil
}

// BracketSeat is one seat of the bracket DTO.
type BracketSeat struct {
	Position     int
	PlayerID     *id.ID
	SourceSlotID *id.ID
	SourcePlace  *int
}

// BracketMatchScore is one player's earned slot points (ADR-30) in one match
// of the slot's series — the per-match earn share rounded to one decimal.
type BracketMatchScore struct {
	PlayerID id.ID
	Points   float64
}

// BracketMatch is one linked match of the slot's series (event order) with
// every participant's earned points.
type BracketMatch struct {
	MatchID id.ID
	Scores  []BracketMatchScore
}

// BracketSlot is one rendered table of the bracket DTO.
type BracketSlot struct {
	ID       id.ID
	Position int
	GameID   id.ID
	Advance  int
	// MinScore is the organizer-set minimal score (ADR-30): the leader must
	// hold at least this many slot points before the slot may complete.
	MinScore float64
	Status   string
	Seats    []BracketSeat
	Matches  []BracketMatch
	// Standings carry cumulative slot points in tenths (Standing.Points,
	// ADR-30); the API layer divides by 10 for display.
	Standings []bracket.Standing
	// Ruling is the organizer ruling in force, ordered by place; nil when the
	// outcome comes from the standings.
	Ruling []id.ID
}

// BracketRound is one round of the bracket DTO.
type BracketRound struct {
	Track string
	Index int
	Slots []BracketSlot
}

// GetBracket assembles the full bracket DTO: the stored structure plus live
// standings derived from the linked matches' scores — standings are never
// stored (ADR-26). The lazy deadline check corrects a stale running status;
// the read never fails on it.
func (s *TournamentService) GetBracket(ctx context.Context, tid id.ID) (db.Tournament, []BracketRound, error) {
	_ = s.EnforceGrandFinalDeadline(ctx)
	t, err := s.Queries.GetTournament(ctx, tid)
	if err != nil {
		return db.Tournament{}, nil, fmt.Errorf("get tournament: %w", err)
	}
	slots, err := s.Queries.ListTournamentSlots(ctx, tid)
	if err != nil {
		return db.Tournament{}, nil, fmt.Errorf("list slots: %w", err)
	}
	if len(slots) == 0 {
		return t, nil, nil
	}

	slotIDs := make([]id.ID, 0, len(slots))
	for _, sl := range slots {
		slotIDs = append(slotIDs, sl.ID)
	}
	seats, err := s.Queries.ListSeatsBySlots(ctx, slotIDs)
	if err != nil {
		return db.Tournament{}, nil, fmt.Errorf("list seats: %w", err)
	}
	seatsBySlot := make(map[id.ID][]db.TournamentSeat, len(slots))
	for _, se := range seats {
		seatsBySlot[se.SlotID] = append(seatsBySlot[se.SlotID], se)
	}

	byRound := make(map[[2]int][]*BracketSlot)
	roundOrder := make([][2]int, 0, len(slots))
	bracketSlots := make(map[id.ID]*BracketSlot, len(slots))
	for i := range slots {
		sl := slots[i]
		bs := &BracketSlot{
			ID:       sl.ID,
			Position: int(sl.Position),
			GameID:   sl.GameID,
			Advance:  int(sl.Advance),
			MinScore: sl.MinScore,
			Status:   sl.Status,
		}
		if len(sl.Ruling) > 0 {
			var ruling []id.ID
			if err := json.Unmarshal(sl.Ruling, &ruling); err != nil {
				return db.Tournament{}, nil, fmt.Errorf("parse slot ruling: %w", err)
			}
			bs.Ruling = ruling
		}
		for _, se := range seatsBySlot[sl.ID] {
			seat := BracketSeat{Position: int(se.Position), PlayerID: se.PlayerID, SourceSlotID: se.SourceSlotID}
			if se.SourcePlace.Valid {
				p := int(se.SourcePlace.Int32)
				seat.SourcePlace = &p
			}
			bs.Seats = append(bs.Seats, seat)
		}
		key := [2]int{tournamentTrackRank[sl.Track], int(sl.RoundIndex)}
		if _, seen := byRound[key]; !seen {
			roundOrder = append(roundOrder, key)
		}
		byRound[key] = append(byRound[key], bs)
		bracketSlots[sl.ID] = bs
	}

	// Matches, advancements and the live standings per slot.
	for i := range slots {
		sl := slots[i]
		bs := bracketSlots[sl.ID]
		results, err := s.Queries.ListSlotMatchResults(ctx, sl.ID)
		if err != nil {
			return db.Tournament{}, nil, fmt.Errorf("list slot matches: %w", err)
		}
		matchResults, err := slotMatchResults(ctx, s.Queries, results)
		if err != nil {
			return db.Tournament{}, nil, err
		}
		// Per-match earned points (ADR-30) in event order, participants in
		// the query's player-id order.
		for _, mr := range matchResults {
			pts := bracket.MatchPoints(mr.Scores, mr.WinReward)
			bm := BracketMatch{MatchID: mr.MatchID, Scores: make([]BracketMatchScore, 0, len(mr.Scores))}
			for _, r := range results {
				if r.MatchID == mr.MatchID {
					bm.Scores = append(bm.Scores, BracketMatchScore{
						PlayerID: r.PlayerID,
						Points:   float64(pts[r.PlayerID]) / bracket.PointsTenths,
					})
				}
			}
			bs.Matches = append(bs.Matches, bm)
		}
		if len(matchResults) > 0 && len(bs.Seats) >= 2 {
			sts := bracket.Standings(matchResults, len(bs.Seats))
			advances, err := s.Queries.ListSlotAdvances(ctx, sl.ID)
			if err != nil {
				return db.Tournament{}, nil, fmt.Errorf("list advances: %w", err)
			}
			advanced := make(map[id.ID]bool, len(advances))
			for _, a := range advances {
				advanced[a.PlayerID] = true
			}
			for si := range sts {
				sts[si].Advanced = advanced[sts[si].PlayerID]
			}
			bs.Standings = sts
		}
	}

	rounds := make([]BracketRound, 0, len(roundOrder))
	for _, key := range roundOrder {
		br := BracketRound{Track: tournamentTrackNames[key[0]], Index: key[1]}
		for _, bs := range byRound[key] {
			br.Slots = append(br.Slots, *bs)
		}
		rounds = append(rounds, br)
	}
	return t, rounds, nil
}

// ensureTournamentArena creates the auto-managed tournament arena (ADR-24
// anchor, no filter row, no leagues — rating ≡ elo) with a name derived from
// the unique tournament name.
func (s *TournamentService) ensureTournamentArena(ctx context.Context, q *db.Queries, tid id.ID, name string) error {
	if _, err := q.GetArenaByTournament(ctx, &tid); !db.IsNoRows(err) {
		return err // exists (or real error)
	}
	settings, err := settingsDoc(startingRatingGameArenaDefault, nil)
	if err != nil {
		return err
	}
	arenaName := name
	if err := ensureArenaNameFree(ctx, q, arenaName, nil); err != nil {
		arenaName = name + " — турнир"
		if err := ensureArenaNameFree(ctx, q, arenaName, nil); err != nil {
			return err
		}
	}
	row, err := q.CreateArena(ctx, db.CreateArenaParams{
		ID:                    id.NewMonotonic(),
		Name:                  arenaName,
		MatchFilterID:         nil, // tournament arenas are link-only (ADR-26)
		Settings:              settings,
		SettingsSchemaVersion: arenasettings.CurrentVersion,
		TournamentID:          &tid,
	})
	if err != nil {
		return fmt.Errorf("create arena: %w", err)
	}
	return q.MarkArenasStaleFull(ctx, []id.ID{row.ID})
}

// ---------------------------------------------------------------------------
// small helpers for the bracket lifecycle
// ---------------------------------------------------------------------------

// randomSeed mints the stored PRNG seed.
func randomSeed() int64 {
	var b [8]byte
	if _, err := cryptorand.Read(b[:]); err != nil {
		// Cannot start the tournament without a seed; crypto/rand failing
		// means the system is broken anyway.
		panic(fmt.Sprintf("bracket: seed: %v", err))
	}
	return int64(binary.BigEndian.Uint64(b[:]) & 0x7fffffffffffffff)
}

// fittingGames indexes the pool's games by the seat counts they can host.
func fittingGames(pool []db.TournamentGame) map[int][]id.ID {
	out := make(map[int][]id.ID, len(pool))
	for _, g := range pool {
		for k := int(g.MinPlayers); k <= int(g.MaxPlayers); k++ {
			out[k] = append(out[k], g.GameID)
		}
	}
	return out
}

// pickGame assigns one of the fitting games to a slot, seeded (a rebuild
// from the same plan + seed reproduces the same assignment).
func pickGame(rng *rand.Rand, games []id.ID) id.ID {
	if len(games) == 0 {
		return id.ID("")
	}
	return games[rng.Intn(len(games))]
}
