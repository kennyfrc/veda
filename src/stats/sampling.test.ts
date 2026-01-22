/**
 * Tests for statistical sampling utilities.
 */

import { describe, expect, it } from 'bun:test';
import { sampleBeta, wilsonLower } from './sampling';

describe('sampleBeta', () => {
  it('returns values in [0, 1]', () => {
    for (let i = 0; i < 100; i++) {
      const sample = sampleBeta(1, 1);
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it('Beta(1,1) is approximately uniform', () => {
    // Mean should be ~0.5
    const samples = Array.from({ length: 1000 }, () => sampleBeta(1, 1));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it('Beta(10,1) is concentrated near 1', () => {
    const samples = Array.from({ length: 1000 }, () => sampleBeta(10, 1));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.85);
  });

  it('Beta(1,10) is concentrated near 0', () => {
    const samples = Array.from({ length: 1000 }, () => sampleBeta(1, 10));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeLessThan(0.15);
  });

  it('handles fractional alpha/beta (shape < 1)', () => {
    // This tests the Ahrens-Dieter branch
    for (let i = 0; i < 100; i++) {
      const sample = sampleBeta(0.5, 0.5);
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });
});

describe('wilsonLower', () => {
  it('returns 0 for n=0', () => {
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it('returns 0 for 0/n', () => {
    expect(wilsonLower(0, 5)).toBeCloseTo(0, 2);
    expect(wilsonLower(0, 10)).toBeCloseTo(0, 2);
  });

  it('returns ~0.21 for 1/1', () => {
    const lb = wilsonLower(1, 1);
    expect(lb).toBeGreaterThan(0.15);
    expect(lb).toBeLessThan(0.30);
  });

  it('returns ~0.34 for 2/2', () => {
    const lb = wilsonLower(2, 2);
    expect(lb).toBeGreaterThan(0.30);
    expect(lb).toBeLessThan(0.45);
  });

  it('increases with more evidence', () => {
    // More data → narrower CI → higher lower bound (for same proportion)
    const lb10 = wilsonLower(10, 10);
    const lb100 = wilsonLower(100, 100);
    expect(lb100).toBeGreaterThan(lb10);
  });

  it('handles 50% win rate', () => {
    const lb = wilsonLower(5, 10);
    expect(lb).toBeGreaterThan(0.20);
    expect(lb).toBeLessThan(0.40);
  });

  it('never exceeds raw proportion', () => {
    // Wilson lower bound is always <= observed proportion
    for (let wins = 0; wins <= 10; wins++) {
      for (let n = wins; n <= 10; n++) {
        if (n === 0) continue;
        const lb = wilsonLower(wins, n);
        const raw = wins / n;
        expect(lb).toBeLessThanOrEqual(raw + 0.001); // Small tolerance for floating point
      }
    }
  });
});

describe('Thompson Sampling behavior', () => {
  const withSeededRandom = <T>(seed: number, fn: () => T): T => {
    const originalRandom = Math.random;
    let state = seed >>> 0;
    Math.random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };

    try {
      return fn();
    } finally {
      Math.random = originalRandom;
    }
  };

  it('high-win module tends to be selected more often', () => {
    withSeededRandom(12345, () => {
      // Simulate selection from a category with one strong and one weak module
      const selectBest = () => {
        const strongSample = sampleBeta(8 + 1, 2 + 1); // 80% win rate
        const weakSample = sampleBeta(1 + 1, 9 + 1);   // 10% win rate
        return strongSample > weakSample ? 'strong' : 'weak';
      };

      const results = Array.from({ length: 1000 }, selectBest);
      const strongCount = results.filter(r => r === 'strong').length;

      // Strong module should win most of the time
      expect(strongCount).toBeGreaterThan(800);
    });
  });

  it('unexplored module (0/0) has fair chance', () => {
    withSeededRandom(67890, () => {
      // Beta(1,1) = Uniform, should occasionally beat a moderate performer
      const selectBest = () => {
        const moderateSample = sampleBeta(3 + 1, 7 + 1); // 30% win rate
        const unexploredSample = sampleBeta(0 + 1, 0 + 1); // 0/0 → Beta(1,1)
        return unexploredSample > moderateSample ? 'unexplored' : 'moderate';
      };

      const results = Array.from({ length: 1000 }, selectBest);
      const unexploredCount = results.filter(r => r === 'unexplored').length;

      // Unexplored should win a reasonable amount (exploration)
      expect(unexploredCount).toBeGreaterThan(200);
      expect(unexploredCount).toBeLessThan(700);
    });
  });
});
