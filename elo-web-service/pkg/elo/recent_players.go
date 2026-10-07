package elo

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/tolyandre/elo-web-service/pkg/db"
	"github.com/tolyandre/elo-web-service/pkg/id"
)

// The player picker's "Недавние" tab (GET /players/recent).

// RecentPlayersLimit caps the recent list shown in the picker.
const RecentPlayersLimit = 15

// RecentPlayer is one entry of the recent list: a player plus the recency key
// it was ranked by — the later of the most recent relevant match date (a match
// alongside the current user's player or a club member) and the player's
// creation date (from the audit log). Zero when the player has neither, e.g.
// the pinned current player with no activity.
type RecentPlayer struct {
	Player   db.Player
	RecentAt time.Time
}

// ListRecentPlayers assembles the recent candidates for the current user:
//   - players who recently played alongside the user's player or a member of
//     any of their clubs (most recent shared-match date),
//   - players recently created by the user or by the users of their clubs —
//     the creator is read from the audit log (ADR-14), the only place it lives,
//   - the current user's player, always pinned first.
//
// Most recent first, ties broken by name, at most `limit` entries.
func (s *PlayerService) ListRecentPlayers(ctx context.Context, userID id.ID, limit int) ([]RecentPlayer, error) {
	me, err := s.Queries.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	var clubIDs []id.ID
	if me.PlayerID != nil {
		clubIDs, err = s.Queries.ListClubIDsByPlayerID(ctx, *me.PlayerID)
		if err != nil {
			return nil, err
		}
	}

	var myPlayerID *id.ID
	if me.PlayerID != nil {
		pid := *me.PlayerID
		myPlayerID = &pid
	}

	// Co-players need at least one seed (my player or a club); without any the
	// query would return the whole player table.
	var coPlayers []db.ListRecentCoPlayersRow
	if myPlayerID != nil || len(clubIDs) > 0 {
		coPlayers, err = s.Queries.ListRecentCoPlayers(ctx, db.ListRecentCoPlayersParams{
			MyPlayerID: myPlayerID,
			ClubIds:    clubIDs,
			Limit:      int32(limit),
		})
		if err != nil {
			return nil, err
		}
	}

	actorIDs := make([]id.ID, 0, len(clubIDs)+1)
	actorIDs = append(actorIDs, userID)
	if len(clubIDs) > 0 {
		clubUserIDs, err := s.Queries.ListClubMemberUserIDs(ctx, clubIDs)
		if err != nil {
			return nil, err
		}
		actorIDs = append(actorIDs, clubUserIDs...)
	}
	createdBy, err := s.Queries.ListPlayersCreatedByUsers(ctx, db.ListPlayersCreatedByUsersParams{
		ActorIds: actorIDs,
		Limit:    int32(limit),
	})
	if err != nil {
		return nil, err
	}

	// A dangling user.player_id must not fail the request; the pin is skipped.
	var myPlayer *db.Player
	if myPlayerID != nil {
		if p, perr := s.Queries.GetPlayer(ctx, *myPlayerID); perr == nil {
			myPlayer = &p
		}
	}

	return mergeRecentPlayers(myPlayer, coPlayers, createdBy, limit), nil
}

// mergeRecentPlayers combines the co-player and created-by buckets — a player
// present in both keeps the later of the two dates — pins myPlayer first and
// trims to limit. Pure, so the ordering rules are unit-tested directly.
func mergeRecentPlayers(
	myPlayer *db.Player,
	coPlayers []db.ListRecentCoPlayersRow,
	createdBy []db.ListPlayersCreatedByUsersRow,
	limit int,
) []RecentPlayer {
	type entry struct {
		player db.Player
		at     time.Time
	}
	byID := make(map[id.ID]*entry, len(coPlayers)+len(createdBy))
	add := func(playerID id.ID, name string, at time.Time) {
		if e, ok := byID[playerID]; ok {
			if at.After(e.at) {
				e.at = at
			}
			return
		}
		byID[playerID] = &entry{player: db.Player{ID: playerID, Name: name}, at: at}
	}
	for _, r := range coPlayers {
		add(r.PlayerID, r.PlayerName, r.LastMatchAt)
	}
	for _, r := range createdBy {
		add(r.PlayerID, r.PlayerName, r.CreatedAt)
	}

	var mine *entry
	if myPlayer != nil {
		if e, ok := byID[myPlayer.ID]; ok {
			mine = e
		} else {
			mine = &entry{player: *myPlayer}
		}
		delete(byID, myPlayer.ID)
	}

	others := make([]entry, 0, len(byID))
	for _, e := range byID {
		others = append(others, *e)
	}
	// Most recent first, no-activity entries last, ties by name.
	slices.SortFunc(others, func(a, b entry) int {
		if !a.at.Equal(b.at) {
			if a.at.After(b.at) {
				return -1
			}
			return 1
		}
		return strings.Compare(a.player.Name, b.player.Name)
	})

	recent := make([]RecentPlayer, 0, min(limit, len(others)+1))
	if mine != nil {
		recent = append(recent, RecentPlayer{Player: mine.player, RecentAt: mine.at})
	}
	for _, e := range others {
		if len(recent) >= limit {
			break
		}
		recent = append(recent, RecentPlayer{Player: e.player, RecentAt: e.at})
	}
	return recent
}
