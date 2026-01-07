/**
 * Multi-Judge Round-Robin Types
 * 
 * Eliminates self-preference bias by having each backend judge
 * candidates from OTHER backends only. Each candidate is ranked
 * by N-1 judges (where N = unique solver backends).
 */

import type { UsageStats } from '../backend';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** Input candidate with backend tag */
export interface CandidateInfo {
  id: string;
  solverBackend: string;
  content: string;
}

/** Assignment of one judge to evaluate a pool of candidates */
export interface JudgeAssignment {
  judgeBackend: string;
  /** Candidate IDs to rank (already shuffled) */
  candidateIds: string[];
  /** Maps displayIdx (0-based) → original candidateId */
  indexMapping: string[];
  /** Deterministic seed used for shuffle */
  seed: string;
}

/** Per-candidate ranking from one judge */
export interface CandidateRanking {
  candidateId: string;
  /** 1 = best within this pool, poolSize = worst */
  rank: number;
  confidence: ConfidenceLevel;
  reasoning?: string;
}

/** Result from one judge evaluating its pool */
export interface JudgePoolResult {
  judgeBackend: string;
  judgeModel: string;
  /** Rankings for all candidates in this pool */
  rankings: CandidateRanking[];
  /** Number of candidates in this pool */
  poolSize: number;
  /** Maps displayIdx → candidateId */
  indexMapping: string[];
  consensusAnalysis?: string;
  usage: UsageStats;
  sessionId?: string;
  /** True if rankings were repaired (missing/duplicate handling) */
  repaired?: boolean;
}

/** Entry for one ranking from one judge (used in aggregation) */
export interface RankEntry {
  judgeBackend: string;
  rank: number;
  poolSize: number;
  normalizedRank: number;
  confidence: ConfidenceLevel;
}

/** Aggregated score for one candidate across all judges */
export interface AggregatedScore {
  candidateId: string;
  solverBackend: string;
  /** Average rank (1 = best) */
  avgRank: number;
  /** Average normalized rank (0 = best, 1 = worst) - used internally for sorting */
  avgNormalizedRank: number;
  /** Number of judges that ranked this candidate */
  judgeCount: number;
  /** Raw rank sum (for tiebreaking) */
  rawRankSum: number;
  /** Aggregated confidence */
  confidence: ConfidenceLevel;
  /** Numeric confidence score (0-1) */
  confidenceScore: number;
  /** Individual rankings from each judge */
  ranksByJudge: RankEntry[];
}

/** Final multi-judge result */
export interface MultiJudgeResult {
  /** Winning candidate ID */
  winnerCandidateId: string;
  /** Aggregated confidence level */
  confidence: ConfidenceLevel;
  /** Numeric confidence score (0-1) */
  confidenceScore: number;
  /** Margin over runner-up (for verification trigger) */
  winMargin: number;
  /** Results from each judge */
  judgeResults: JudgePoolResult[];
  /** Per-candidate aggregated scores, sorted by rank */
  scores: AggregatedScore[];
  /** Combined usage across all judges */
  totalUsage: UsageStats;
  /** True if any judge pools failed */
  hadFailures: boolean;
  /** Number of failed judge pools */
  failureCount: number;
}

/** Result wrapper for judge pool execution */
export interface JudgePoolExecutionResult {
  success: boolean;
  value?: JudgePoolResult;
  error?: string;
  judgeBackend: string;
}

/** Confidence penalty tiers */
export const CONFIDENCE_PENALTY = {
  NONE: 0,
  SOME_FAILURES: 1,
  MOST_FAILURES: 2,
} as const;

export type ConfidencePenaltyTier = typeof CONFIDENCE_PENALTY[keyof typeof CONFIDENCE_PENALTY];

/** Confidence level to numeric score mapping */
export const CONFIDENCE_SCORES: Record<ConfidenceLevel, number> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

/** Numeric score to confidence level */
export function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}
