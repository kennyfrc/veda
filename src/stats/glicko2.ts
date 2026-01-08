/**
 * Glicko-2 Rating System Implementation
 * 
 * Pure functions for computing Glicko-2 rating updates.
 * Based on Mark Glickman's paper: http://www.glicko.net/glicko/glicko2.pdf
 */

import type { RatingState, Match } from './pairwise-types';

/** Glicko-2 system parameters */
export interface Glicko2Params {
  /** System constant τ (constrains volatility change). Reasonable: 0.3-1.2 */
  tau: number;
  /** Convergence tolerance for volatility iteration */
  epsilon: number;
  /** Max iterations for volatility solve */
  maxIterations: number;
}

/** Default parameters */
export const DEFAULT_PARAMS: Glicko2Params = {
  tau: 0.5,
  epsilon: 0.000001,
  maxIterations: 50,
};

/** Default rating state for new entities */
export const DEFAULT_RATING: RatingState = {
  r: 1500,
  rd: 350,
  vol: 0.06,
  games: 0,
};

/** Glicko-2 scale conversion factor */
const SCALE = 173.7178;

/** Convert from Glicko scale to Glicko-2 scale */
function toGlicko2Scale(r: number, rd: number): { mu: number; phi: number } {
  return {
    mu: (r - 1500) / SCALE,
    phi: rd / SCALE,
  };
}

/** Convert from Glicko-2 scale back to Glicko scale */
function fromGlicko2Scale(mu: number, phi: number): { r: number; rd: number } {
  return {
    r: mu * SCALE + 1500,
    rd: phi * SCALE,
  };
}

/** g(φ) function */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

/** E(μ, μj, φj) - expected score */
function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** Compute variance v */
function computeVariance(
  mu: number,
  opponents: Array<{ mu: number; phi: number; score: number }>
): number {
  let sum = 0;
  for (const opp of opponents) {
    const gPhi = g(opp.phi);
    const e = E(mu, opp.mu, opp.phi);
    sum += gPhi * gPhi * e * (1 - e);
  }
  return sum > 0 ? 1 / sum : 0;
}

/** Compute delta (estimated improvement) */
function computeDelta(
  mu: number,
  v: number,
  opponents: Array<{ mu: number; phi: number; score: number }>
): number {
  let sum = 0;
  for (const opp of opponents) {
    const gPhi = g(opp.phi);
    const e = E(mu, opp.mu, opp.phi);
    sum += gPhi * (opp.score - e);
  }
  return v * sum;
}

/**
 * Solve for new volatility σ' using Illinois algorithm.
 * This is the iterative step 5 from Glickman's paper.
 */
function solveVolatility(
  phi: number,
  v: number,
  delta: number,
  sigma: number,
  params: Glicko2Params
): number {
  const { tau, epsilon, maxIterations } = params;
  
  const a = Math.log(sigma * sigma);
  const phiSq = phi * phi;
  const deltaSq = delta * delta;
  
  // f(x) function to find root of
  const f = (x: number): number => {
    const expX = Math.exp(x);
    const num = expX * (deltaSq - phiSq - v - expX);
    const denom = 2 * Math.pow(phiSq + v + expX, 2);
    return num / denom - (x - a) / (tau * tau);
  };
  
  // Initialize bounds
  let A = a;
  let B: number;
  
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k++;
      if (k > 100) break; // Safety limit
    }
    B = a - k * tau;
  }
  
  // Illinois algorithm iteration
  let fA = f(A);
  let fB = f(B);
  
  for (let i = 0; i < maxIterations; i++) {
    if (Math.abs(B - A) <= epsilon) break;
    
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    
    B = C;
    fB = fC;
  }
  
  return Math.exp(A / 2);
}

/**
 * Update a single player's rating given their matches in a rating period.
 * 
 * @param player Current rating state
 * @param matches Array of matches with opponent states and scores
 * @param params Glicko-2 parameters
 * @returns New rating state
 */
export function glicko2UpdatePlayer(
  player: RatingState,
  matches: Array<{ opp: RatingState; score: 0 | 0.5 | 1 }>,
  params: Glicko2Params = DEFAULT_PARAMS
): RatingState {
  // Convert to Glicko-2 scale
  const { mu, phi } = toGlicko2Scale(player.r, player.rd);
  const sigma = player.vol;
  
  // No matches: only RD increases (Step 6 shortcut)
  if (matches.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    const { rd: newRd } = fromGlicko2Scale(mu, phiStar);
    return {
      r: player.r,
      rd: Math.min(newRd, 350), // Cap at initial RD
      vol: player.vol,
      games: player.games,
      lastTs: player.lastTs,
    };
  }
  
  // Convert opponents to Glicko-2 scale
  const opponents = matches.map(m => {
    const { mu: muJ, phi: phiJ } = toGlicko2Scale(m.opp.r, m.opp.rd);
    return { mu: muJ, phi: phiJ, score: m.score };
  });
  
  // Step 3: Compute variance v
  const v = computeVariance(mu, opponents);
  
  // Step 4: Compute delta
  const delta = computeDelta(mu, v, opponents);
  
  // Step 5: Compute new volatility
  const sigmaPrime = solveVolatility(phi, v, delta, sigma, params);
  
  // Step 6: Update phi to phi*
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  
  // Step 7: Update phi' and mu'
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  
  let muPrime = mu;
  for (const opp of opponents) {
    const gPhi = g(opp.phi);
    const e = E(mu, opp.mu, opp.phi);
    muPrime += phiPrime * phiPrime * gPhi * (opp.score - e);
  }
  
  // Convert back to Glicko scale
  const { r: newR, rd: newRd } = fromGlicko2Scale(muPrime, phiPrime);
  
  return {
    r: newR,
    rd: newRd,
    vol: sigmaPrime,
    games: player.games + matches.length,
    lastTs: new Date().toISOString(),
  };
}

/**
 * Update an entire pool of players simultaneously.
 * Uses a snapshot of pre-period ratings so update order doesn't matter.
 * 
 * @param stateByKey Current ratings for all entities
 * @param matchesByKey Matches grouped by entity key
 * @param params Glicko-2 parameters
 * @returns Updated ratings map
 */
export function glicko2UpdatePool(
  stateByKey: Map<string, RatingState>,
  matchesByKey: Map<string, Match[]>,
  params: Glicko2Params = DEFAULT_PARAMS
): Map<string, RatingState> {
  // Snapshot pre-period ratings
  const snapshot = new Map(stateByKey);
  const result = new Map<string, RatingState>();
  
  // Get all keys that need updating
  const allKeys = new Set([...stateByKey.keys(), ...matchesByKey.keys()]);
  
  for (const key of allKeys) {
    const player = snapshot.get(key) ?? { ...DEFAULT_RATING };
    const matches = matchesByKey.get(key) ?? [];
    
    // Build match array with opponent states from snapshot
    const matchesWithOpp = matches.map(m => ({
      opp: snapshot.get(m.opponentKey) ?? { ...DEFAULT_RATING },
      score: m.score,
    }));
    
    const newState = glicko2UpdatePlayer(player, matchesWithOpp, params);
    result.set(key, newState);
  }
  
  return result;
}

/**
 * Compute exposure rating (conservative estimate).
 * Used for ranking: rating - 2*RD gives 95% confidence lower bound.
 */
export function computeExposure(state: RatingState): number {
  return state.r - 2 * state.rd;
}
