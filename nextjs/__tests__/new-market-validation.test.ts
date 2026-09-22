import { describe, expect, it } from 'vitest'
import { matchWinnerFormIssue, tournamentWinnerFormIssue } from '../app/markets/new/validation'

describe('matchWinnerFormIssue', () => {
    it('stays silent on an untouched empty form (submit button is disabled instead)', () => {
        expect(matchWinnerFormIssue(0, true)).toBeNull()
        expect(matchWinnerFormIssue(0, false)).toBeNull()
    })

    it('rejects a single named player without the "other players" outcome', () => {
        // Any other player winning the match would resolve nothing.
        expect(matchWinnerFormIssue(1, false)).toBe('Добавьте ещё игроков или разрешите победы других игроков')
    })

    it('accepts a single player when other players can win', () => {
        expect(matchWinnerFormIssue(1, true)).toBeNull()
    })

    it('accepts multiple players either way', () => {
        expect(matchWinnerFormIssue(2, true)).toBeNull()
        expect(matchWinnerFormIssue(2, false)).toBeNull()
    })
})

describe('tournamentWinnerFormIssue', () => {
    it('stays silent when no tournament is selected yet (submit is disabled instead)', () => {
        expect(tournamentWinnerFormIssue(0)).toBeNull()
    })

    it('rejects a single-participant tournament — the market could never resolve meaningfully', () => {
        expect(tournamentWinnerFormIssue(1)).toBe('У турнира должен быть минимум два участника')
    })

    it('accepts a tournament with two or more participants', () => {
        expect(tournamentWinnerFormIssue(2)).toBeNull()
        expect(tournamentWinnerFormIssue(8)).toBeNull()
    })
})
