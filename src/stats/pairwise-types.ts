/**
 * Pairwise stats types for Glicko-2 rating computation.
 * Each vote from each judge = one match for rating purposes.
 */

export type VoteConfidence = 'high' | 'medium' | 'low';
export type VoteOutcome = 'A' | 'B' | 'tie';
export type PairVerdict = 'A' | 'B' | 'tie' | 'split';

export interface CandidateMetadata {
  candidateId: string;
  solverBackend: string;
  solverModel: string;
  category: string;
  moduleId: string;
}

export interface VoteRecord {
  pairId: string;
  judgeBackend: string;
  judgeModel: string;
  candidateA: string;
  candidateB: string;
  outcome: VoteOutcome;
  confidence: VoteConfidence;
}

export interface PairResultRecord {
  pairId: string;
  candidateA: string;
  candidateB: string;
  verdict: PairVerdict;
  consensusWinner: string | null;
  agreementRate: number;
}

/** v1: legacy entries without era tracking */
export interface PairwiseStatEntry {
  version: 1;
  timestamp: string;
  promptHash: string;
  runId: string;
  judgeMode: 'pairwise';
  candidates: CandidateMetadata[];
  votes: VoteRecord[];
  pairResults?: PairResultRecord[];
}

export type RatingEntityType = 'judge' | 'model' | 'module' | 'category';

export interface RatingState {
  r: number;   // rating (default 1500)
  rd: number;  // rating deviation (default 350)
  vol: number; // volatility (default 0.06)
  games: number;
  lastTs?: string;
}

export interface RatingsSnapshot {
  version: 1;
  updatedAt: string;
  entities: Record<string, RatingState>;
}

export interface Match {
  opponentKey: string;
  score: 0 | 0.5 | 1; // win/draw/loss
}

export type MatchesByKey = Map<string, Match[]>;

// Era types (v2) - tracks module catalog version

export interface EraRef {
  id: string;           // "m_" + first 12 chars of digest
  catalogDigest: string; // full SHA-256 hex
}

/** v2: includes era for module catalog versioning */
export interface PairwiseStatEntryV2 {
  version: 2;
  timestamp: string;
  promptHash: string;
  runId: string;
  judgeMode: 'pairwise';
  candidates: CandidateMetadata[];
  votes: VoteRecord[];
  pairResults?: PairResultRecord[];
  era: EraRef;
}

export type AnyPairwiseStatEntry = PairwiseStatEntry | PairwiseStatEntryV2;

export interface RatingsSnapshotV2 {
  version: 2;
  updatedAt: string;
  currentEra: EraRef;
  entities: Record<string, RatingState>;
}

export type AnyRatingsSnapshot = RatingsSnapshot | RatingsSnapshotV2;

export type EraSelector = 'current' | 'legacy' | 'all' | string;
