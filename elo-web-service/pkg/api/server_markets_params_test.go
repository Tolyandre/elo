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
		{"unknown returns nil params", "bogus"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// Must not panic. win_streak needs a valid winsRequired for the int cast.
			got, params := buildTypedMarketParams(c.marketType, "p1", []string{"p1"}, []string{"g1"}, nil, pgtype.Int4{Int32: 3, Valid: true}, pgtype.Int4{Int32: 1, Valid: true})
			_ = got
			if c.marketType == "bogus" {
				if params != nil {
					t.Errorf("unknown market type: want nil params, got %#v", params)
				}
				return
			}
			if params == nil {
				t.Fatalf("expected non-nil params for %s, got nil", c.marketType)
			}
		})
	}
}

func TestBuildTypedMarketDetailParams_regression(t *testing.T) {
	for _, marketType := range []string{"match_winner", "win_streak"} {
		_, params := buildTypedMarketDetailParams(marketType, "p1", []string{"p1"}, []string{"g1"}, nil, pgtype.Int4{Int32: 3, Valid: true}, pgtype.Int4{Int32: 1, Valid: true})
		if params == nil {
			t.Errorf("expected non-nil detail params for %s, got nil", marketType)
		}
	}
}
