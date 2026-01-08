/**
 * Pairwise Judge Types
 * 
 * Replaces ranking-based multi-judge with head-to-head comparisons.
 * Each pair gets votes from eligible judges (those who didn't produce BOTH candidates).
 * Aggregation uses Copeland scoring (wins - losses).
 */

import type { UsageStats } from '../backend';

// Reuse from multi-judge
export type { CandidateInfo } from './multi-judge-types';
export { CONFIDENCE_SCORES, scoreToLevel, type ConfidenceLevel } from './multi-judge-types';

/** A pair of candidates to compare */
export interface CandidatePair {
  /** Deterministic ID: sorted candidate IDs joined with ":" */
  id: string;
  /** Candidate ID (lexically smaller) */
  candidateA: string;
  /** Candidate ID (lexically larger) */
  candidateB: string;
  /** Solver backend of candidate A */
  backendA: string;
  /** Solver backend of candidate B */
  backendB: string;
  /** True if both candidates from same solver backend */
  isSameBackend: boolean;
  /** Judge backends eligible to vote (excludes backend that produced BOTH candidates) */
  eligibleJudges: string[];
}

/** Vote choice */
export type VoteChoice = 'A' | 'B' | 'tie';

/** A single pairwise vote from one judge */
export interface PairwiseVote {
  pairId: string;
  judgeBackend: string;
  judgeModel: string;
  /** Winner candidate ID, or null for tie */
  winner: string | null;
  /** Raw choice */
  choice: VoteChoice;
  /** Judge's confidence in this comparison */
  confidence: 'high' | 'medium' | 'low';
  reasoning?: string;
}

/** Verdict for a pair after aggregating all votes */
export type PairVerdict = 'A' | 'B' | 'tie' | 'split';

/** Aggregated result for one pair across all judges */
export interface PairResult {
  pairId: string;
  candidateA: string;
  candidateB: string;
  votes: PairwiseVote[];
  /** Consensus winner ID, or null if tie/split */
  consensusWinner: string | null;
  /** Aggregated verdict */
  verdict: PairVerdict;
  /** Fraction of votes matching consensus (1.0 if unanimous) */
  agreementRate: number;
}

/** Per-candidate aggregated score (Copeland) */
export interface PairwiseScore {
  candidateId: string;
  solverBackend: string;
  /** Pairs won (consensus winner was this candidate) */
  wins: number;
  /** Pairs lost (consensus winner was opponent) */
  losses: number;
  /** Pairs with no consensus (tie/split) */
  ties: number;
  /** Copeland score: wins - losses */
  copelandScore: number;
  /** Total pairs involving this candidate */
  totalPairs: number;
  /** Head-to-head results against each opponent */
  headToHead: Map<string, 'win' | 'loss' | 'tie'>;
}

/** Assignment of pairs to one judge */
export interface PairwiseJudgeAssignment {
  judgeBackend: string;
  /** Pairs to evaluate (shuffled for position debiasing) */
  pairs: CandidatePair[];
  /** Seed used for shuffle */
  seed: string;
}

/** Result from one judge evaluating their pairs */
export interface PairwiseJudgeResult {
  judgeBackend: string;
  judgeModel: string;
  votes: PairwiseVote[];
  usage: UsageStats;
  sessionId?: string;
  /** True if some votes were repaired (missing/invalid in response) */
  repaired?: boolean;
}

/** Execution result wrapper (success or failure) */
export interface PairwiseJudgeExecutionResult {
  success: boolean;
  value?: PairwiseJudgeResult;
  error?: string;
  judgeBackend: string;
}

/** Final aggregated result */
export interface PairwiseJudgeAggregateResult {
  winnerCandidateId: string;
  winnerSolverBackend: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  /** Copeland margin: (winner.copeland - runnerUp.copeland) / maxPossibleScore */
  winMargin: number;
  /** All pair results */
  pairResults: PairResult[];
  /** Per-candidate scores, sorted by rank (best first) */
  scores: PairwiseScore[];
  /** Per-judge results */
  judgeResults: PairwiseJudgeResult[];
  /** Combined token usage */
  totalUsage: UsageStats;
  /** True if any judge calls failed */
  hadFailures: boolean;
  failureCount: number;
}
