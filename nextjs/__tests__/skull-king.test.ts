import { describe, it, expect } from 'vitest';
import { Fraction } from 'mathjs';
import * as mathjs from 'mathjs';
import { calculateProbabilities1 } from '../app/game/skull-king';

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
        expect(mathjs.number(entry!.probability)).equals(mathjs.number(new Fraction(39, 782)));
    });
});
