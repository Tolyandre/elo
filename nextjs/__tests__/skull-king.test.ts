import { describe, it, expect } from 'vitest';
import { Fraction } from 'mathjs';
import { calculateProbabilities1 } from '../app/game/skull-king';

describe('calculateProbabilities1', () => {
  it('sums probabilities to 1 for a suit card', () => {
    const result = calculateProbabilities1(4, 1, { type: 'chest', value: 7 } as any, false, false);

    const sum = result.reduce((acc: Fraction, p) => acc.add(p.probability), new Fraction(0));

    expect(sum.equals(1)).toBeTruthy();
  });

  it('returns probability 1 and miss points for kraken', () => {
    const result = calculateProbabilities1(4, 1, { type: 'kraken' } as any, true, false);

    const krakenEntry = result.find(r => r.points === -10);

    expect(krakenEntry).toBeDefined();
    // @ts-ignore - mathjs Fraction methods used in runtime
    expect(krakenEntry!.probability.equals(1)).toBeTruthy();
  });
});
