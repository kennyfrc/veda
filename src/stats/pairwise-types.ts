/**
 * Pairwise Stats Types
 * 
 * Records full pairwise matchup data for Glicko-2 rating computation.
 * Each vote from each judge = one match for rating purposes.
 */

/** Confidence level for a vote */
export type VoteConfidence = 'high' | 'medium' | 'low';

/** Vote outcome from judge's perspective */
export type VoteOutcome = 'A' | 'B' | 'tie';

/** Aggregated pair verdict */
export type PairVerdict = 'A' | 'B' | 'tie' | 'split';

/** Candidate metadata for rating derivation */
export interface CandidateMetadata {
  candidateId: string;
  solverBackend: string;
  solverModel: string;
  category: string;
  moduleId: string;
}

/** Individual vote record */
export interface VoteRecord {
  pairId: string;
  judgeBackend: string;
  judgeModel: string;
  candidateA: string;
  candidateB: string;
  outcome: VoteOutcome;
  confidence: VoteConfidence;
}

/** Aggregated pair result (for debugging/UX) */
export interface PairResultRecord {
  pairId: string;
  candidateA: string;
  candidateB: string;
  verdict: PairVerdict;
  consensusWinner: string | null;
  agreementRate: number;
}

/**
 * Pairwise stat entry - one per deep-think run.
 * Contains all data needed to derive Glicko-2 matches.
 */
export interface PairwiseStatEntry {
  /** Schema version */
  version: 1;
  /** ISO timestamp */
  timestamp: string;
  /** Hash of prompt for correlation */
  promptHash: string;
  /** Unique run identifier */
  runId: string;
  /** Always 'pairwise' for this schema */
  judgeMode: 'pairwise';
  /** Candidate metadata for rating derivation */
  candidates: CandidateMetadata[];
  /** All individual votes (each = one match for Glicko-2) */
  votes: VoteRecord[];
  /** Aggregated pair results (optional, for debugging) */
  pairResults?: PairResultRecord[];
}

/** Entity type for rating grouping */
export type RatingEntityType = 'judge' | 'model' | 'module' | 'category';

/** Glicko-2 rating state for one entity */
export interface RatingState {
  /** Rating (Elo-like, default 1500) */
  r: number;
  /** Rating deviation (uncertainty, default 350) */
  rd: number;
  /** Volatility (expected fluctuation, default 0.06) */
  vol: number;
  /** Number of games/matches played */
  games: number;
  /** Last update timestamp */
  lastTs?: string;
}

/** Ratings snapshot file format */
export interface RatingsSnapshot {
  version: 1;
  updatedAt: string;
  entities: Record<string, RatingState>;
}

/** Match for Glicko-2 computation */
export interface Match {
  /** Opponent's entity key */
  opponentKey: string;
  /** Score: 1 = win, 0.5 = draw, 0 = loss */
  score: 0 | 0.5 | 1;
}

/** Derived matches grouped by entity key */
export type MatchesByKey = Map<string, Match[]>;
