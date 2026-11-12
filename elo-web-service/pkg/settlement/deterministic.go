package settlement

import "math"

// expDeterministic is the portable (pure-Go) implementation of math.Exp,
// vendored from the Go standard library (src/math/exp.go, BSD license) so
// every build target — the amd64 server and the js/wasm client (ADR-38) —
// computes the identical double.
//
// Why a copy: math.Exp has an assembly implementation on some platforms
// (exp_amd64.s) whose results differ from the portable fallback by one ULP
// for some inputs, and the catch-up scaling below is exponential in the
// elo−rating gap. A 1-ULP divergence between server and client would break
// the bit-exact parity the golden fixtures pin (nextjs/__tests__/fixtures/
// settlement-golden.json), so the settlement core must not call math.Exp.
// math.Pow is portable everywhere and stays direct.

func expDeterministic(x float64) float64 {
	const (
		Ln2Hi = 6.93147180369123816490e-01
		Ln2Lo = 1.90821492927058770002e-10
		Log2e = 1.44269504088896338700e+00

		Overflow  = 7.09782712893383973096e+02
		Underflow = -7.45133219101941108420e+02
		NearZero  = 1.0 / (1 << 28) // 2**-28
	)

	// special cases
	switch {
	case math.IsNaN(x):
		return x
	case x > Overflow: // handles case where x is +∞
		return math.Inf(1)
	case x < Underflow: // handles case where x is -∞
		return 0
	case -NearZero < x && x < NearZero:
		return 1 + x
	}

	// reduce; computed as r = hi - lo for extra precision.
	var k int
	switch {
	case x < 0:
		k = int(Log2e*x - 0.5)
	case x > 0:
		k = int(Log2e*x + 0.5)
	}
	hi := x - float64(k)*Ln2Hi
	lo := float64(k) * Ln2Lo

	return expmultiDeterministic(hi, lo, k)
}

func expmultiDeterministic(hi, lo float64, k int) float64 {
	const (
		P1 = 1.66666666666666657415e-01  /* 0x3FC55555; 0x55555555 */
		P2 = -2.77777777770155933842e-03 /* 0xBF66C16C; 0x16BEBD93 */
		P3 = 6.61375632143793436117e-05  /* 0x3F11566A; 0xAF25DE2C */
		P4 = -1.65339022054652515390e-06 /* 0xBEBBBD41; 0xC5D26BF1 */
		P5 = 4.13813679705723846039e-08  /* 0x3E663769; 0x72BEA4D0 */
	)

	r := hi - lo
	t := r * r
	c := r - t*(P1+t*(P2+t*(P3+t*(P4+t*P5))))
	y := 1 - ((lo - (r*c)/(2-c)) - hi)
	return math.Ldexp(y, k)
}
