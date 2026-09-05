// Formatting of share counts and elo amounts on the market page: whole
// numbers render without decimals, fractional ones with exactly two digits.

/** Renders `v` as an integer when it is whole (within float noise), otherwise with two digits after the decimal point. */
export function formatAmount(v: number): string {
    return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2);
}
