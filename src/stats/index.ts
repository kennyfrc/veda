// Legacy exports (for backward compatibility)
export type {
  StatEntry,
  GroupAgg,
  GroupByMode,
  ConfidenceLevel,
} from './types';
export { StatsStore, type StatsStoreOptions } from './store';

// Pairwise stats exports
export type {
  PairwiseStatEntry,
  CandidateMetadata,
  VoteRecord,
  PairResultRecord,
  VoteConfidence,
  VoteOutcome,
  PairVerdict,
  RatingEntityType,
  RatingState,
  RatingsSnapshot,
  Match,
  MatchesByKey,
} from './pairwise-types';

export { PairwiseStatsStore, type PairwiseStatsStoreOptions } from './pairwise-store';
export { RatingsStore, type RatingsStoreOptions } from './ratings-store';

// Glicko-2 exports
export {
  glicko2UpdatePlayer,
  glicko2UpdatePool,
  computeExposure,
  DEFAULT_PARAMS,
  DEFAULT_RATING,
  type Glicko2Params,
} from './glicko2';

// Match derivation exports
export {
  deriveAllMatches,
  deriveJudgeMatches,
  deriveModelMatches,
  deriveModuleMatches,
  deriveCategoryMatches,
  mergeMatches,
  judgeKey,
  modelKey,
  moduleKey,
  categoryKey,
  KEY_PREFIX,
} from './derive-matches';
