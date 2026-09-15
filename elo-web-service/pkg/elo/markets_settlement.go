package elo

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// TriggerResolutionForMatch checks all open markets and resolves them if the given match satisfies their conditions.
// Must be called within an active transaction (q is transactional Queries).
func (s *MarketService) TriggerResolutionForMatch(ctx context.Context, q *db.Queries, matchID id.ID) error {
	match, err := q.GetMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get match %s: %w", matchID, err)
	}

	scores, err := q.GetMatchScoresForMatch(ctx, matchID)
	if err != nil {
		return fmt.Errorf("get scores for match %s: %w", matchID, err)
	}

	participantSet := make(map[id.ID]bool)
	playerScoreMap := make(map[id.ID]float64)
	maxScore := -1e18
	for _, row := range scores {
		participantSet[row.PlayerID] = true
		playerScoreMap[row.PlayerID] = row.Score
		if row.Score > maxScore {
			maxScore = row.Score
		}
	}

	matchInfo := MatchInfo{
		Match:          match,
		ParticipantSet: participantSet,
		PlayerScoreMap: playerScoreMap,
		MaxScore:       maxScore,
	}

	settle := s.SettleMarket

	for marketType, handler := range marketTypeHandlers {
		if err := handler.ResolutionTrigger().OnMatch(ctx, q, matchInfo, settle); err != nil {
			return fmt.Errorf("resolve %s markets: %w", marketType, err)
		}
	}

	return nil
}

// UnsettleMarketsFromDate resets markets resolved by matches on/after fromDate.
// Must be called within an active transaction.
func (s *MarketService) UnsettleMarketsFromDate(ctx context.Context, q *db.Queries, fromDate time.Time) error {
	marketIDs, err := q.GetMarketsForUnsettle(ctx, pgtype.Timestamptz{Time: fromDate, Valid: true})
	if err != nil {
		return fmt.Errorf("get markets for unsettle: %w", err)
	}
	for _, marketID := range marketIDs {
		if err := q.DeleteGlobalArenaSettlementByMarket(ctx, &marketID); err != nil {
			return fmt.Errorf("delete global arena settlement for market %s: %w", marketID, err)
		}
		if err := q.UnsettleMarket(ctx, marketID); err != nil {
			return fmt.Errorf("unsettle market %s: %w", marketID, err)
		}
	}
	return nil
}

// SettleMarket pays the winning side (each winning share pays 1) and redistributes
// the settlement residual across the market's guarantors, keeping elo strictly
// conserved (zero-sum across buyers + guarantors).
// OutcomeCancelled refunds all spent elo. Must be called within an active transaction.
func (s *MarketService) SettleMarket(ctx context.Context, q *db.Queries, marketID id.ID, outcome MarketOutcome, resolvedAt time.Time, resolutionMatchID *id.ID) error {
	bets, err := q.GetBetsForSettlement(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get bets for market %s: %w", marketID, err)
	}
	wagerRows, err := q.ListMarketGuaranteeWagers(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get guarantee wagers for market %s: %w", marketID, err)
	}
	wagers := guaranteeWagersFromDB(wagerRows)

	isCancelled := outcome == OutcomeCancelled
	winningSide := id.ID(outcome) // the winning outcome row id, or the "cancelled" pseudo-value

	// Per-player buy P&L. staked is the elo spent (cost + maker fee, positive
	// magnitude); earned is the payout (shares × 1 for the winning side, or the
	// full spend refunded on cancel). Losers earn 0.
	type playerData struct {
		staked float64
		earned float64
	}
	players := make(map[id.ID]*playerData)
	totalCollected := 0.0 // LMSR costs only — the maker fee goes to the guarantors' fee pool
	totalPaid := 0.0
	betRecs := make([]betRecord, len(bets))
	for i, b := range bets {
		pd := players[b.PlayerID]
		if pd == nil {
			pd = &playerData{}
			players[b.PlayerID] = pd
		}
		pd.staked += b.Cost + b.Fee
		totalCollected += b.Cost
		betRecs[i] = betRecord{
			PlayerID: b.PlayerID,
			Outcome:  b.Outcome,
			Cost:     b.Cost,
			Fee:      b.Fee,
			Shares:   b.Shares,
			PlacedAt: b.PlacedAt.Time,
		}
		if isCancelled {
			pd.earned += b.Cost + b.Fee // refund of elo spent incl. the maker fee
		} else if b.Outcome == winningSide {
			pd.earned += b.Shares // each winning share pays 1
			totalPaid += b.Shares
		}
	}

	// Guarantor result (ADR-20, surplus split per ADR-23): the fee pool
	// (time-windowed, weighted fee·risk) plus the equity residual (collected −
	// paid) — exposure-accrual split on surplus, first-loss waterfall on
	// deficit. Cancellation refunds everything, so guarantors have nothing to
	// settle. A bet-less market leaves the wagers' surplus at 0 — no rows.
	// Shares sum to residual + feePool exactly (barring the insolvency
	// remainder), keeping elo strictly conserved (zero-sum across buyers +
	// guarantors).
	var shares map[id.ID]float64
	if !isCancelled && len(wagers) > 0 {
		market, err := q.GetMarket(ctx, marketID)
		if err != nil {
			return fmt.Errorf("get market %s for settlement: %w", marketID, err)
		}
		residual := totalCollected - totalPaid // +surplus / −deficit
		shares = settleGuarantors(betRecs, wagers, market.MaxGuarantorLoss, residual)
	}

	// A player may be both buyer and guarantor (guarantors may buy). They get
	// one settlement row per role (UNIQUE (market_id, player_id, discriminator),
	// ADR-10): the 'market' row carries the buy P&L, the 'market_guarantor' row
	// carries their aggregate guarantor result (a player may hold several
	// wagers). Pure guarantors keep the 'market_guarantor' discriminator for the
	// guarantor-payout rollup.
	guarantorSet := make(map[id.ID]bool, len(wagers))
	for _, w := range wagers {
		guarantorSet[w.PlayerID] = true
	}
	allPlayerIDSet := make(map[id.ID]bool, len(players)+len(guarantorSet))
	for pid := range players {
		allPlayerIDSet[pid] = true
	}
	for pid := range guarantorSet {
		allPlayerIDSet[pid] = true
	}
	allPlayerIDs := make([]id.ID, 0, len(allPlayerIDSet))
	for pid := range allPlayerIDSet {
		allPlayerIDs = append(allPlayerIDs, pid)
	}
	sortPlayerIDs(allPlayerIDs)

	resolvedAtTz := pgtype.Timestamptz{Time: resolvedAt, Valid: true}

	settingsRow, err := q.GetEloSettingsForDate(ctx, resolvedAtTz)
	if err != nil {
		return fmt.Errorf("get elo settings: %w", err)
	}
	settings := EloSettingsFromDB(settingsRow)

	date6MAgo := pgtype.Timestamptz{Time: resolvedAt.Add(-6 * 30 * 24 * time.Hour), Valid: true}
	date2MAgo := pgtype.Timestamptz{Time: resolvedAt.Add(-2 * 30 * 24 * time.Hour), Valid: true}

	// One settlement row per role per player over buyers ∪ guarantors: elo spent
	// as negative staked, payout (winning shares × 1, or refund on cancel) as
	// earned for the 'market' row; the guarantor residual share (deficit as
	// staked, surplus as earned) for the 'market_guarantor' row. The balances
	// are read once, before either row is written — a later read would observe
	// the 'market' row just written — and the rows carry per-row checkpoints
	// (ADR-21): each row's *_after applies its own deltas, so the guarantor
	// row, written second with the higher id, lands on the event-final balance
	// that latest-at-date reads pick up.
	for _, pid := range allPlayerIDs {
		var buyerStaked, buyerEarned float64
		if pd := players[pid]; pd != nil {
			buyerStaked = -pd.staked
			buyerEarned = pd.earned
		}
		var guarantorStaked, guarantorEarned float64
		if share := shares[pid]; share != 0 {
			guarantorStaked = math.Min(share, 0)
			guarantorEarned = math.Max(share, 0)
		}
		totalStaked := buyerStaked + guarantorStaked
		totalEarned := buyerEarned + guarantorEarned

		if buyerStaked == 0 && buyerEarned == 0 && guarantorStaked == 0 && guarantorEarned == 0 {
			continue
		}

		balances, err := s.readMarketSettlementBalances(ctx, q, pid, resolvedAtTz, settings, date6MAgo, date2MAgo)
		if err != nil {
			return fmt.Errorf("read balances for %s: %w", pid, err)
		}
		newElo := balances.currentElo + totalStaked + totalEarned
		newRating := balances.currentRating + totalStaked + totalEarned
		newLeague := determineGlobalLeague(balances.prevLeague, newRating, newElo, balances.count6M, balances.count2M, settings)

		afterElo := balances.currentElo
		afterRating := balances.currentRating
		if buyerStaked != 0 || buyerEarned != 0 {
			afterElo += buyerStaked + buyerEarned
			afterRating += buyerStaked + buyerEarned
			if err := s.upsertMarketSettlement(ctx, q, pid, marketID, "market",
				buyerStaked, buyerEarned, afterElo, afterRating, newLeague, resolvedAtTz); err != nil {
				return fmt.Errorf("upsert settlement for %s: %w", pid, err)
			}
		}
		if guarantorStaked != 0 || guarantorEarned != 0 {
			afterElo += guarantorStaked + guarantorEarned
			afterRating += guarantorStaked + guarantorEarned
			if err := s.upsertMarketSettlement(ctx, q, pid, marketID, "market_guarantor",
				guarantorStaked, guarantorEarned, afterElo, afterRating, newLeague, resolvedAtTz); err != nil {
				return fmt.Errorf("upsert guarantor settlement for %s: %w", pid, err)
			}
		}
	}

	// Cancelled markets carry no winning outcome: cancellation is encoded by
	// the status column and resolution_outcome stays NULL.
	var resolutionOutcome *id.ID
	if !isCancelled {
		resolutionOutcome = &winningSide
	}
	if err := q.ResolveMarket(ctx, db.ResolveMarketParams{
		ID:                marketID,
		Status:            statusForOutcome(outcome),
		ResolvedAt:        resolvedAtTz,
		ResolutionMatchID: resolutionMatchID,
		ResolutionOutcome: resolutionOutcome,
	}); err != nil {
		return fmt.Errorf("resolve market %s: %w", marketID, err)
	}

	if err := RecalculateBetLimits(ctx, q, allPlayerIDs); err != nil {
		return fmt.Errorf("recalculate bet limits: %w", err)
	}

	return nil
}

// marketSettlementBalances is the pre-event state a player's role rows
// accumulate from.
type marketSettlementBalances struct {
	currentElo    float64
	currentRating float64
	prevLeague    string
	count6M       int
	count2M       int
}

// readMarketSettlementBalances reads the player's pre-market elo/rating/league
// state. Called once per player before any of their rows are written, so the
// second role row cannot observe the first one (they share the settlement date).
func (s *MarketService) readMarketSettlementBalances(
	ctx context.Context, q *db.Queries, playerID id.ID,
	resolvedAtTz pgtype.Timestamptz, settings EloSettings, date6MAgo, date2MAgo pgtype.Timestamptz,
) (marketSettlementBalances, error) {
	var b marketSettlementBalances
	latestElo, err := q.GetPlayerLatestGlobalEloAtDate(ctx, db.GetPlayerLatestGlobalEloAtDateParams{
		PlayerID: playerID,
		Date:     resolvedAtTz,
	})
	if err != nil {
		b.currentElo = settings.StartingElo
	} else {
		b.currentElo = latestElo
	}

	var storedLeague string
	latestRating, err := q.GetPlayerLatestGlobalRatingAtDate(ctx, db.GetPlayerLatestGlobalRatingAtDateParams{
		PlayerID: playerID,
		Date:     resolvedAtTz,
	})
	if err != nil {
		b.currentRating = settings.StartingRatingGlobal
		storedLeague = initialLeagueForStarting(settings.StartingRatingGlobal, settings.StartingElo, settings)
	} else {
		b.currentRating = latestRating.Rating
		storedLeague = latestRating.League
	}

	count6M, _ := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
		PlayerID: playerID,
		Date:     date6MAgo,
		Date_2:   resolvedAtTz,
	})
	count2M, _ := q.GetPlayerGlobalMatchCountInPeriod(ctx, db.GetPlayerGlobalMatchCountInPeriodParams{
		PlayerID: playerID,
		Date:     date2MAgo,
		Date_2:   resolvedAtTz,
	})
	b.count6M = int(count6M)
	b.count2M = int(count2M)
	b.prevLeague = effectiveLeague(storedLeague, b.count2M, b.count6M, settings)
	return b, nil
}

// upsertMarketSettlement persists one role's settlement row. eloStaked (≤ 0) and
// eloEarned (≥ 0) are that role's delta (buyer P&L or guarantor residual share)
// and feed the display + zero-sum invariant; eloAfter/ratingAfter are the
// per-row checkpoint balances after this row's deltas — the caller accumulates
// them across the role rows, so the last-written row carries the post-market
// balance — and league is the post-event league (identical on both rows of a
// buyer∩guarantor player). The rating track mirrors the elo track (markets
// apply no newbie scaling).
func (s *MarketService) upsertMarketSettlement(
	ctx context.Context, q *db.Queries, playerID, marketID id.ID, discriminator string,
	eloStaked, eloEarned, eloAfter, ratingAfter float64, league string,
	resolvedAtTz pgtype.Timestamptz,
) error {
	return q.UpsertGlobalArenaSettlementByMarket(ctx, db.UpsertGlobalArenaSettlementByMarketParams{
		ID:            newSettlementID(),
		PlayerID:      playerID,
		Date:          resolvedAtTz,
		RatingAfter:   ratingAfter,
		EloAfter:      eloAfter,
		MarketID:      &marketID,
		Discriminator: discriminator,
		EloStaked:     eloStaked,
		EloEarned:     eloEarned,
		RatingStaked:  eloStaked,
		RatingEarned:  eloEarned,
		League:        league,
	})
}

// LockMarketBetting stops accepting new bets on an open market (user event).
// betting_closed_at is stored permanently and never cleared during recalculation.
func (s *MarketService) LockMarketBetting(ctx context.Context, marketID id.ID) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	q := s.Queries.WithTx(tx)

	market, err := q.GetMarket(ctx, marketID)
	if err != nil {
		return fmt.Errorf("get market: %w", err)
	}
	if market.Status != "open" {
		return ErrMarketNotOpen
	}

	if err := q.LockMarketBetting(ctx, marketID); err != nil {
		return fmt.Errorf("lock market betting: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	// The markets list shows betting status, so lobby subscribers must hear
	// about the close too.
	if s.Hub != nil {
		s.Hub.PublishSignal(TopicLobbyMarkets, "markets-changed")
	}
	return nil
}
