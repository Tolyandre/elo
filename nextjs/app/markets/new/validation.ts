/**
 * Returns the reason a match_winner form is degenerate, or null when it is
 * submittable. Only the single-named-player-without-"other players" case is
 * reported — any other player's win would resolve nothing, so the market
 * would only ever settle on a tie. An empty selection stays silent: the
 * submit button is disabled instead, and the server rejects empty targets as
 * a backstop.
 */
export function matchWinnerFormIssue(targetCount: number, allowOtherPlayers: boolean): string | null {
    if (targetCount === 1 && !allowOtherPlayers) {
        return "Добавьте ещё игроков или разрешите победы других игроков";
    }
    return null;
}
