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

/**
 * Returns the reason a tournament_winner form is degenerate, or null when it
 * is submittable. A market among fewer than two participants (possible only
 * if the roster shrank after the tournament started) can never resolve
 * meaningfully. No tournament selected stays silent — the disabled submit
 * button does the talking.
 */
export function tournamentWinnerFormIssue(participantCount: number): string | null {
    if (participantCount === 1) {
        return "У турнира должен быть минимум два участника";
    }
    return null;
}
