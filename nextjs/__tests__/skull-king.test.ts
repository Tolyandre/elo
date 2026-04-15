import { describe, it, expect } from 'vitest';
import { Fraction } from 'mathjs';
import * as mathjs from 'mathjs';
import { calculateProbabilities0, calculateProbabilities1 } from '../app/game/skull-king';

describe('calculateProbabilities1', () => {
    it('sums probabilities to 1 for a suit card', () => {
        const result = calculateProbabilities1(4, 1, { type: 'chest', value: 7 }, false, false);

        const sum = result.reduce((acc: Fraction, p) => acc.add(p.probability), new Fraction(0));

        expect(mathjs.number(sum)).equals(1);
    });

    it('sums probabilities to 1 for a pirate card', () => {
        const result = calculateProbabilities1(4, 3, { type: 'pirate' }, false, false);

        const sum = result.reduce((acc: Fraction, p) => acc.add(p.probability), new Fraction(0));

        expect(mathjs.number(sum)).equals(1);
    });

    it('returns probability 1 and miss points for kraken', () => {
        const result = calculateProbabilities1(4, 1, { type: 'kraken' }, true, false);

        const krakenEntry = result.find(r => r.points === -10);

        expect(krakenEntry).toBeDefined();
        expect(krakenEntry!.probability.equals(1)).toBeTruthy();
    });


    it('returns probability and points for mermaid', () => {
        const result = calculateProbabilities1(5, 2, { type: 'mermaid' }, true, false);

        const entry = result.find(r => r.points === 30);

        expect(entry).toBeDefined();
        expect(mathjs.number(entry!.probability)).equals(mathjs.number(new Fraction(13053, 130985)));
    });

    it('returns probability and points for escape', () => {
        const result = calculateProbabilities1(4, 2, { type: 'escape' }, true, false);

        expect(result.length).equals(1);

        expect(mathjs.number(result[0].probability)).equals(1);
        expect(result[0].points).equals(-10);
    });

    it('returns probability and points for chest, turn order 1', () => {
        const result = calculateProbabilities1(4, 1, { type: 'chest', value: 7 }, true, false);

        const entry = result.find(r => r.points === 20);

        expect(entry).toBeDefined();
        expect(mathjs.number(entry!.probability)).equals(mathjs.number(new Fraction(111, 782)));
    });

    it('returns probability and points for chest, turn order 2', () => {
        const result = calculateProbabilities1(4, 2, { type: 'chest', value: 7 }, true, false);

        const entry = result.find(r => r.points === 20);

        expect(entry).toBeDefined();
        expect(mathjs.number(entry!.probability)).equals(mathjs.number(new Fraction(1131, 28934)));
    });

    it('returns probability 1 and miss points for white-whale', () => {
        const result = calculateProbabilities1(4, 1, { type: 'white-whale' }, false, true);

        expect(result.length).equals(1);
        expect(result[0].points).equals(-10);
        expect(mathjs.number(result[0].probability)).equals(1);
    });

    it('non-trump value 1 as last player (turn 8 of 8) can never win trick', () => {
        // При номинале 1 некозырной масти нет ни одной карты той же масти в safe-зоне.
        // Также 8-й игрок не может получить масть через escapes (их только 5).
        // P(взять взятку) должна быть ровно 0.
        const result = calculateProbabilities1(8, 8, { type: 'chest', value: 1 }, false, false);

        const winEntry = result.find(r => r.points > -10);
        expect(winEntry).toBeUndefined();

        const lossEntry = result.find(r => r.points === -10);
        expect(lossEntry).toBeDefined();
        expect(mathjs.number(lossEntry!.probability)).equals(1);
    });

    it('sums probabilities to 1 for loot card', () => {
        const result = calculateProbabilities1(4, 1, { type: 'loot' }, false, false, true);

        const sum = result.reduce((acc: Fraction, p) => acc.add(p.probability), new Fraction(0));

        expect(mathjs.number(sum)).equals(1);
    });
});

describe('calculateProbabilities0', () => {
    it('returns +10 for kraken (bid=0 always succeeds)', () => {
        const result = calculateProbabilities0(4, 1, { type: 'kraken' }, true, false);

        expect(result.length).equals(1);
        expect(result[0].points).equals(10);
        expect(mathjs.number(result[0].probability)).equals(1);
    });

    it('returns +10 for white-whale (bid=0 always succeeds)', () => {
        const result = calculateProbabilities0(4, 1, { type: 'white-whale' }, false, true);

        expect(result.length).equals(1);
        expect(result[0].points).equals(10);
        expect(mathjs.number(result[0].probability)).equals(1);
    });

    it('sums probabilities to 1 for suit card', () => {
        const result = calculateProbabilities0(4, 1, { type: 'chest', value: 7 }, false, false);

        const sum = result.reduce((acc: Fraction, p) => acc.add(p.probability), new Fraction(0));

        expect(mathjs.number(sum)).equals(1);
    });

    it('loot success gives +30 points (base +10 plus contract bonus +20)', () => {
        const result = calculateProbabilities0(4, 1, { type: 'loot' }, false, false, true);

        const successEntry = result.find(r => r.points === 30);
        expect(successEntry).toBeDefined();

        // probabilities must sum to 1
        const sum = result.reduce((acc: Fraction, p) => acc.add(p.probability), new Fraction(0));
        expect(mathjs.number(sum)).equals(1);
    });

    it('escape success gives +10 points (no contract bonus)', () => {
        const result = calculateProbabilities0(4, 2, { type: 'escape' }, true, false);

        expect(result.length).equals(1);
        expect(result[0].points).equals(10);
        expect(mathjs.number(result[0].probability)).equals(1);
    });
});
