import { describe, expect, it } from 'vitest'
import { matchWinnerFormIssue } from '../app/markets/new/validation'

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
