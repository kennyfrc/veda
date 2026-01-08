import { describe, test, expect } from 'bun:test';
import {
  glicko2UpdatePlayer,
  glicko2UpdatePool,
  computeExposure,
  DEFAULT_RATING,
  DEFAULT_PARAMS,
} from '../../src/stats/glicko2';
import type { RatingState, Match } from '../../src/stats/pairwise-types';

describe('Glicko-2', () => {
  describe('glicko2UpdatePlayer', () => {
    test('no matches only increases RD', () => {
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const updated = glicko2UpdatePlayer(player, []);
      
      // Rating should stay the same
      expect(updated.r).toBe(1500);
      // RD should increase (more uncertainty over time)
      expect(updated.rd).toBeGreaterThan(200);
      // RD should be capped at initial
      expect(updated.rd).toBeLessThanOrEqual(350);
      // Volatility unchanged
      expect(updated.vol).toBe(0.06);
      // Games unchanged
      expect(updated.games).toBe(0);
    });

    test('win against equal opponent increases rating', () => {
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const opponent: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      
      const updated = glicko2UpdatePlayer(player, [{ opp: opponent, score: 1 }]);
      
      // Rating should increase
      expect(updated.r).toBeGreaterThan(1500);
      // RD should decrease (more certainty after a game)
      expect(updated.rd).toBeLessThan(200);
      // Games should increment
      expect(updated.games).toBe(1);
    });

    test('loss against equal opponent decreases rating', () => {
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const opponent: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      
      const updated = glicko2UpdatePlayer(player, [{ opp: opponent, score: 0 }]);
      
      // Rating should decrease
      expect(updated.r).toBeLessThan(1500);
      // RD should decrease
      expect(updated.rd).toBeLessThan(200);
      // Games should increment
      expect(updated.games).toBe(1);
    });

    test('tie produces small rating change', () => {
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const opponent: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      
      const updated = glicko2UpdatePlayer(player, [{ opp: opponent, score: 0.5 }]);
      
      // Rating should change very little against equal opponent
      expect(Math.abs(updated.r - 1500)).toBeLessThan(5);
      // RD should decrease
      expect(updated.rd).toBeLessThan(200);
    });

    test('win against stronger opponent increases rating more', () => {
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const weakOpponent: RatingState = { r: 1400, rd: 200, vol: 0.06, games: 0 };
      const strongOpponent: RatingState = { r: 1700, rd: 200, vol: 0.06, games: 0 };
      
      const afterWeakWin = glicko2UpdatePlayer(player, [{ opp: weakOpponent, score: 1 }]);
      
      // Reset player for fair comparison
      const afterStrongWin = glicko2UpdatePlayer(player, [{ opp: strongOpponent, score: 1 }]);
      
      // Win against stronger opponent should give more rating
      expect(afterStrongWin.r).toBeGreaterThan(afterWeakWin.r);
    });

    test('multiple matches in one period', () => {
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const opp1: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      const opp2: RatingState = { r: 1600, rd: 200, vol: 0.06, games: 0 };
      
      const updated = glicko2UpdatePlayer(player, [
        { opp: opp1, score: 1 },  // win
        { opp: opp2, score: 0 },  // loss
      ]);
      
      // Games should count both
      expect(updated.games).toBe(2);
      // RD should be quite low after 2 games
      expect(updated.rd).toBeLessThan(180);
    });

    // Test from Glickman's paper example
    test('matches Glickman paper example approximately', () => {
      // Player: rating=1500, RD=200
      // Opponents: [1400/30/win, 1550/100/loss, 1700/300/loss]
      const player: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      
      const updated = glicko2UpdatePlayer(player, [
        { opp: { r: 1400, rd: 30, vol: 0.06, games: 0 }, score: 1 },
        { opp: { r: 1550, rd: 100, vol: 0.06, games: 0 }, score: 0 },
        { opp: { r: 1700, rd: 300, vol: 0.06, games: 0 }, score: 0 },
      ]);
      
      // From paper: new rating ≈ 1464, new RD ≈ 151.5
      // Our implementation may vary slightly due to convergence method
      expect(updated.r).toBeGreaterThan(1440);
      expect(updated.r).toBeLessThan(1490);
      expect(updated.rd).toBeGreaterThan(140);
      expect(updated.rd).toBeLessThan(165);
    });
  });

  describe('glicko2UpdatePool', () => {
    test('updates multiple players simultaneously', () => {
      const states = new Map<string, RatingState>([
        ['A', { r: 1500, rd: 200, vol: 0.06, games: 0 }],
        ['B', { r: 1500, rd: 200, vol: 0.06, games: 0 }],
      ]);
      
      const matches = new Map<string, Match[]>([
        ['A', [{ opponentKey: 'B', score: 1 }]],  // A beats B
        ['B', [{ opponentKey: 'A', score: 0 }]],  // B loses to A
      ]);
      
      const updated = glicko2UpdatePool(states, matches);
      
      expect(updated.get('A')!.r).toBeGreaterThan(1500);
      expect(updated.get('B')!.r).toBeLessThan(1500);
      
      // Sum of rating changes should be approximately zero (zero-sum)
      const totalChange = (updated.get('A')!.r - 1500) + (updated.get('B')!.r - 1500);
      expect(Math.abs(totalChange)).toBeLessThan(10);
    });

    test('creates default rating for new entities', () => {
      const states = new Map<string, RatingState>([
        ['A', { r: 1500, rd: 200, vol: 0.06, games: 0 }],
      ]);
      
      const matches = new Map<string, Match[]>([
        ['A', [{ opponentKey: 'NEW', score: 1 }]],
        ['NEW', [{ opponentKey: 'A', score: 0 }]],
      ]);
      
      const updated = glicko2UpdatePool(states, matches);
      
      // NEW should exist with a rating
      expect(updated.has('NEW')).toBe(true);
      expect(updated.get('NEW')!.r).toBeLessThan(1500);
      expect(updated.get('NEW')!.games).toBe(1);
    });

    test('snapshot prevents order dependency', () => {
      // When A beats B and B beats C in same period,
      // C's rating should be based on B's pre-period rating
      const states = new Map<string, RatingState>([
        ['A', { r: 1500, rd: 200, vol: 0.06, games: 0 }],
        ['B', { r: 1500, rd: 200, vol: 0.06, games: 0 }],
        ['C', { r: 1500, rd: 200, vol: 0.06, games: 0 }],
      ]);
      
      const matches = new Map<string, Match[]>([
        ['A', [{ opponentKey: 'B', score: 1 }]],
        ['B', [{ opponentKey: 'A', score: 0 }, { opponentKey: 'C', score: 1 }]],
        ['C', [{ opponentKey: 'B', score: 0 }]],
      ]);
      
      const updated = glicko2UpdatePool(states, matches);
      
      // All should be updated
      expect(updated.get('A')!.games).toBe(1);
      expect(updated.get('B')!.games).toBe(2);
      expect(updated.get('C')!.games).toBe(1);
    });
  });

  describe('computeExposure', () => {
    test('computes rating - 2*RD', () => {
      const state: RatingState = { r: 1500, rd: 200, vol: 0.06, games: 0 };
      expect(computeExposure(state)).toBe(1100);
    });

    test('low RD gives higher exposure', () => {
      const highRd: RatingState = { r: 1500, rd: 300, vol: 0.06, games: 0 };
      const lowRd: RatingState = { r: 1500, rd: 100, vol: 0.06, games: 0 };
      
      expect(computeExposure(lowRd)).toBeGreaterThan(computeExposure(highRd));
    });
  });
});
