package api

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// TestBuildTypedMarketParams_regression guards against a nil-pointer panic
// introduced when buildTypedParams was made generic: a pointer type parameter
// `var p T` yields a nil pointer, and the generated FromMatchWinnerParams /
// FromWinStreakParams dereference the receiver (`t.union = b`). GET /markets
// hit this path for every market row and crashed with a 200+empty-body (the
// panic was swallowed by gin's recovery AFTER the buffered writer had captured
// the 200 status). Both variants must allocate and return a non-nil params.
func TestBuildTypedMarketParams_regression(t *testing.T) {
	cases := []struct {
		name       string
		marketType string
	}{
		{"match_winner", "match_winner"},
		{"win_streak", "win_streak"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// Must not panic. win_streak needs a valid winsRequired for the int cast.
			params := buildTypedMarketParams(c.marketType, []string{"p1", "p2"}, pgtype.Bool{Bool: true, Valid: true},
				[]string{"g1"}, nil, nil, pgtype.Int4{Int32: 3, Valid: true}, pgtype.Int4{Int32: 1, Valid: true})
			if params == nil {
				t.Fatalf("expected non-nil params for %s, got nil", c.marketType)
			}
		})
	}
}

func TestBuildTypedMarketDetailParams_regression(t *testing.T) {
	for _, marketType := range []string{"match_winner", "win_streak"} {
		params := buildTypedMarketDetailParams(marketType, []string{"p1", "p2"}, pgtype.Bool{Bool: true, Valid: true},
			[]string{"g1"}, nil, nil, pgtype.Int4{Int32: 3, Valid: true}, pgtype.Int4{Int32: 1, Valid: true})
		if params == nil {
			t.Errorf("expected non-nil detail params for %s, got nil", marketType)
		}
	}
}

func TestBuildTypedParamsFillsUnions(t *testing.T) {
	t.Run("match_winner", func(t *testing.T) {
		params := buildTypedMarketParams("match_winner", []string{"p1", "p2"}, pgtype.Bool{Bool: false, Valid: true},
			[]string{"g1", "g2"}, nil, nil, pgtype.Int4{}, pgtype.Int4{})
		mw, err := params.AsMatchWinnerParams()
		if err != nil {
			t.Fatalf("AsMatchWinnerParams: %v", err)
		}
		if len(mw.TargetPlayerIds) != 2 || mw.AllowOtherPlayers {
			t.Errorf("unexpected match_winner params: %+v", mw)
		}
	})
	t.Run("win_streak", func(t *testing.T) {
		wsTarget := "p9"
		params := buildTypedMarketParams("win_streak", nil, pgtype.Bool{}, nil, &wsTarget, []string{"g1"},
			pgtype.Int4{Int32: 3, Valid: true}, pgtype.Int4{Int32: 1, Valid: true})
		ws, err := params.AsWinStreakParams()
		if err != nil {
			t.Fatalf("AsWinStreakParams: %v", err)
		}
		if ws.TargetPlayerId != wsTarget || ws.WinsRequired != 3 || ws.MaxLosses == nil || *ws.MaxLosses != 1 {
			t.Errorf("unexpected win_streak params: %+v", ws)
		}
	})
}
