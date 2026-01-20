/**
 * Derive Glicko-2 Matches from Pairwise Stats
 * 
 * Maps a pairwise stat entry to match arrays for each entity type:
 * - solver models (backend:model)
 * - modules (category/moduleId)
 * - categories
 * - judges (derived from agreement with consensus)
 */

import type {
  AnyPairwiseStatEntry,
  CandidateMetadata,
  VoteRecord,
  MatchesByKey,
  VoteOutcome,
} from './pairwise-types';

/** Entity key prefixes for namespacing */
export const KEY_PREFIX = {
  JUDGE: 'judge:',
  MODEL: 'solver:',
  MODULE: 'module:',
  CATEGORY: 'category:',
} as const;

/** Build entity key for judge */
export function judgeKey(backend: string, model: string): string {
  return `${KEY_PREFIX.JUDGE}${backend}:${model}`;
}

/** Build entity key for solver model */
export function modelKey(backend: string, model: string): string {
  return `${KEY_PREFIX.MODEL}${backend}:${model}`;
}

/** Build entity key for module */
export function moduleKey(category: string, moduleId: string): string {
  return `${KEY_PREFIX.MODULE}${category}/${moduleId}`;
}

/** Build entity key for category */
export function categoryKey(category: string): string {
  return `${KEY_PREFIX.CATEGORY}${category}`;
}

/** Convert vote outcome to scores for A and B */
function outcomeToScores(outcome: VoteOutcome): { scoreA: 0 | 0.5 | 1; scoreB: 0 | 0.5 | 1 } {
  switch (outcome) {
    case 'A': return { scoreA: 1, scoreB: 0 };
    case 'B': return { scoreA: 0, scoreB: 1 };
    case 'tie': return { scoreA: 0.5, scoreB: 0.5 };
  }
}

/**
 * Derive solver model matches from votes.
 * Each vote = one match between the two candidates' solver models.
 */
export function deriveModelMatches(
  entry: AnyPairwiseStatEntry
): MatchesByKey {
  const candidateMap = new Map<string, CandidateMetadata>();
  for (const c of entry.candidates) {
    candidateMap.set(c.candidateId, c);
  }
  
  const matchesByKey: MatchesByKey = new Map();
  
  for (const vote of entry.votes) {
    const candA = candidateMap.get(vote.candidateA);
    const candB = candidateMap.get(vote.candidateB);
    if (!candA || !candB) continue;
    
    const keyA = modelKey(candA.solverBackend, candA.solverModel);
    const keyB = modelKey(candB.solverBackend, candB.solverModel);
    
    // Skip self-matches (same model vs itself)
    if (keyA === keyB) continue;
    
    const { scoreA, scoreB } = outcomeToScores(vote.outcome);
    
    // Add match for A
    const matchesA = matchesByKey.get(keyA) ?? [];
    matchesA.push({ opponentKey: keyB, score: scoreA });
    matchesByKey.set(keyA, matchesA);
    
    // Add match for B
    const matchesB = matchesByKey.get(keyB) ?? [];
    matchesB.push({ opponentKey: keyA, score: scoreB });
    matchesByKey.set(keyB, matchesB);
  }
  
  return matchesByKey;
}

/**
 * Derive module matches from votes.
 * Each vote = one match between the two candidates' modules.
 */
export function deriveModuleMatches(
  entry: AnyPairwiseStatEntry
): MatchesByKey {
  const candidateMap = new Map<string, CandidateMetadata>();
  for (const c of entry.candidates) {
    candidateMap.set(c.candidateId, c);
  }
  
  const matchesByKey: MatchesByKey = new Map();
  
  for (const vote of entry.votes) {
    const candA = candidateMap.get(vote.candidateA);
    const candB = candidateMap.get(vote.candidateB);
    if (!candA || !candB) continue;
    
    const keyA = moduleKey(candA.category, candA.moduleId);
    const keyB = moduleKey(candB.category, candB.moduleId);
    
    // Skip self-matches (same module vs itself)
    if (keyA === keyB) continue;
    
    const { scoreA, scoreB } = outcomeToScores(vote.outcome);
    
    // Add match for A
    const matchesA = matchesByKey.get(keyA) ?? [];
    matchesA.push({ opponentKey: keyB, score: scoreA });
    matchesByKey.set(keyA, matchesA);
    
    // Add match for B
    const matchesB = matchesByKey.get(keyB) ?? [];
    matchesB.push({ opponentKey: keyA, score: scoreB });
    matchesByKey.set(keyB, matchesB);
  }
  
  return matchesByKey;
}

/**
 * Derive category matches from votes.
 * Each vote = one match between the two candidates' categories.
 */
export function deriveCategoryMatches(
  entry: AnyPairwiseStatEntry
): MatchesByKey {
  const candidateMap = new Map<string, CandidateMetadata>();
  for (const c of entry.candidates) {
    candidateMap.set(c.candidateId, c);
  }
  
  const matchesByKey: MatchesByKey = new Map();
  
  for (const vote of entry.votes) {
    const candA = candidateMap.get(vote.candidateA);
    const candB = candidateMap.get(vote.candidateB);
    if (!candA || !candB) continue;
    
    const keyA = categoryKey(candA.category);
    const keyB = categoryKey(candB.category);
    
    // Skip self-matches (same category vs itself)
    if (keyA === keyB) continue;
    
    const { scoreA, scoreB } = outcomeToScores(vote.outcome);
    
    // Add match for A
    const matchesA = matchesByKey.get(keyA) ?? [];
    matchesA.push({ opponentKey: keyB, score: scoreA });
    matchesByKey.set(keyA, matchesA);
    
    // Add match for B
    const matchesB = matchesByKey.get(keyB) ?? [];
    matchesB.push({ opponentKey: keyA, score: scoreB });
    matchesByKey.set(keyB, matchesB);
  }
  
  return matchesByKey;
}

/**
 * Derive judge matches from votes.
 * 
 * For each pair, we compare judges' votes to the consensus verdict:
 * - Judge pairs are matched head-to-head
 * - Judge whose vote matches consensus wins; other loses
 * - If both match or both differ from consensus: draw
 * - If verdict is tie/split: draw for all
 */
export function deriveJudgeMatches(
  entry: AnyPairwiseStatEntry
): MatchesByKey {
  // Build pair verdict lookup
  const pairVerdicts = new Map<string, VoteOutcome | 'split'>();
  for (const pr of entry.pairResults ?? []) {
    pairVerdicts.set(pr.pairId, pr.verdict);
  }
  
  // If no pairResults stored, derive verdicts from votes
  if (pairVerdicts.size === 0) {
    const votesByPair = new Map<string, VoteRecord[]>();
    for (const vote of entry.votes) {
      const votes = votesByPair.get(vote.pairId) ?? [];
      votes.push(vote);
      votesByPair.set(vote.pairId, votes);
    }
    
    for (const [pairId, votes] of votesByPair) {
      let countA = 0, countB = 0, countTie = 0;
      for (const v of votes) {
        if (v.outcome === 'A') countA++;
        else if (v.outcome === 'B') countB++;
        else countTie++;
      }
      
      let verdict: VoteOutcome | 'split';
      if (countA > countB && countA > countTie) verdict = 'A';
      else if (countB > countA && countB > countTie) verdict = 'B';
      else if (countTie > countA && countTie > countB) verdict = 'tie';
      else verdict = 'split';
      
      pairVerdicts.set(pairId, verdict);
    }
  }
  
  // Group votes by pair
  const votesByPair = new Map<string, VoteRecord[]>();
  for (const vote of entry.votes) {
    const votes = votesByPair.get(vote.pairId) ?? [];
    votes.push(vote);
    votesByPair.set(vote.pairId, votes);
  }
  
  const matchesByKey: MatchesByKey = new Map();
  
  // For each pair, create judge-vs-judge matches
  for (const [pairId, votes] of votesByPair) {
    const verdict = pairVerdicts.get(pairId);
    if (!verdict) continue;
    
    // If verdict is tie or split, all judge pairs draw
    const isTieOrSplit = verdict === 'tie' || verdict === 'split';
    
    // Create matches between all judge pairs
    for (let i = 0; i < votes.length; i++) {
      for (let j = i + 1; j < votes.length; j++) {
        const v1 = votes[i];
        const v2 = votes[j];
        
        const key1 = judgeKey(v1.judgeBackend, v1.judgeModel);
        const key2 = judgeKey(v2.judgeBackend, v2.judgeModel);
        
        // Skip self-matches (same judge)
        if (key1 === key2) continue;
        
        let score1: 0 | 0.5 | 1;
        let score2: 0 | 0.5 | 1;
        
        if (isTieOrSplit) {
          // Everyone draws
          score1 = 0.5;
          score2 = 0.5;
        } else {
          // Verdict is A or B
          const v1Correct = v1.outcome === verdict;
          const v2Correct = v2.outcome === verdict;
          
          if (v1Correct && !v2Correct) {
            score1 = 1;
            score2 = 0;
          } else if (!v1Correct && v2Correct) {
            score1 = 0;
            score2 = 1;
          } else {
            // Both correct or both wrong: draw
            score1 = 0.5;
            score2 = 0.5;
          }
        }
        
        // Add matches
        const matches1 = matchesByKey.get(key1) ?? [];
        matches1.push({ opponentKey: key2, score: score1 });
        matchesByKey.set(key1, matches1);
        
        const matches2 = matchesByKey.get(key2) ?? [];
        matches2.push({ opponentKey: key1, score: score2 });
        matchesByKey.set(key2, matches2);
      }
    }
  }
  
  return matchesByKey;
}

/**
 * Derive all matches from a pairwise stat entry.
 * Returns matches grouped by entity type.
 */
export function deriveAllMatches(entry: AnyPairwiseStatEntry): {
  judges: MatchesByKey;
  models: MatchesByKey;
  modules: MatchesByKey;
  categories: MatchesByKey;
} {
  return {
    judges: deriveJudgeMatches(entry),
    models: deriveModelMatches(entry),
    modules: deriveModuleMatches(entry),
    categories: deriveCategoryMatches(entry),
  };
}

/**
 * Merge multiple MatchesByKey maps into one.
 */
export function mergeMatches(...maps: MatchesByKey[]): MatchesByKey {
  const result: MatchesByKey = new Map();
  
  for (const map of maps) {
    for (const [key, matches] of map) {
      const existing = result.get(key) ?? [];
      existing.push(...matches);
      result.set(key, existing);
    }
  }
  
  return result;
}
