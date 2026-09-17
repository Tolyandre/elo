package bracket

import (
	"testing"
	"time"
)

// TestRealisticScaleTiming keeps the enumerator honest on realistic inputs:
// single-elimination enumerations must complete (truncation only via the
// cap), and every case must stay fast enough for the bracket-plans endpoint.
// If this test gets slow, the depth-tier search regressed.
func TestRealisticScaleTiming(t *testing.T) {
	pools := [][]GameCapacity{
		{{2, 2}, {3, 3}},
		{{2, 2}, {3, 3}, {4, 4}},
		{{3, 3}, {4, 4}},
	}
	for _, n := range []int{12, 16, 20, 24} {
		for pi, pool := range pools {
			for _, elim := range []string{EliminationSingle, EliminationDouble} {
				start := time.Now()
				res := Enumerate(n, pool, elim, DefaultPlanCap)
				d := time.Since(start)
				t.Logf("n=%d pool=%d %s: plans=%d truncated=%v in %v", n, pi+2, elim, len(res.Plans), res.Truncated, d)
				if d > 5*time.Second {
					t.Fatalf("n=%d pool=%d %s too slow: %v", n, pi+2, elim, d)
				}
				if len(res.Plans) == 0 {
					t.Fatalf("n=%d pool=%d %s returned no plans (budget exhausted too early?)", n, pi+2, elim)
				}
				if elim == EliminationSingle && res.Truncated && len(res.Plans) < DefaultPlanCap {
					t.Fatalf("single elimination must exhaust its tiers before truncating")
				}
			}
		}
	}
}

// TestPathologicalWidePoolTerminates checks the budget/cap guard rails on an
// adversarial input (28 participants, five table sizes): the response stays
// capped and the call stays fast.
func TestPathologicalWidePoolTerminates(t *testing.T) {
	pool := []GameCapacity{{2, 2}, {3, 3}, {4, 4}, {5, 5}, {6, 6}}
	start := time.Now()
	for _, elim := range []string{EliminationSingle, EliminationDouble} {
		res := Enumerate(28, pool, elim, DefaultPlanCap)
		t.Logf("%s: plans=%d truncated=%v", elim, len(res.Plans), res.Truncated)
		if !res.Truncated {
			t.Fatalf("%s: 28 players / 5 sizes must truncate", elim)
		}
		if len(res.Plans) != DefaultPlanCap {
			t.Fatalf("%s: expected a full capped page, got %d", elim, len(res.Plans))
		}
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Fatalf("pathological enumeration too slow: %v", d)
	}
}
