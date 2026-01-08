/**
 * Judge statistics types for tracking module win rates.
 * 
 * Records are append-only JSONL entries that capture each successful
 * judge decision, enabling analysis of module bias and effectiveness.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type JudgeMode = 'single' | 'multi' | 'pairwise';

/**
 * A single judge decision record.
 * Stored as one JSON line in judge-stats.jsonl.
 * 
 * Version 1: Single-judge mode only
 * Version 2: Adds judgeMode and multi-judge fields
 */
export interface StatEntry {
  /** Schema version for forward compatibility (1 or 2) */
  version: 1 | 2;
  /** ISO timestamp of the decision */
  timestamp: string;
  /** Hash of the prompt (16 hex chars) for correlation */
  promptHash: string;
  
  /** Judge mode (v2+, defaults to 'single' for v1) */
  judgeMode?: JudgeMode;
  
  /** The judge model that made the decision (single-judge, or primary judge for multi) */
  judge: {
    backend: string;
    model: string;
  };
  
  /** All judges that participated (multi-judge only, v2+) */
  judges?: Array<{
    backend: string;
    model: string;
  }>;
  
  /** The winning candidate's metadata */
  winner: {
    category: string;
    moduleId: string;
    backend: string;
    model: string;
  };
  
  /** Confidence of the decision (single-judge) */
  confidence: {
    level: ConfidenceLevel;
    score: number;  // 0.9 (high), 0.5 (medium), 0.3 (low)
  };
  
  /** Aggregated confidence with multi-judge details (v2+) */
  aggregatedConfidence?: {
    level: ConfidenceLevel;
    score: number;
    winMargin: number;
    judgeCount: number;
  };
}

/**
 * Aggregated statistics for a group (module, category, or backend).
 * Computed at query time, not stored.
 */
export interface GroupAgg {
  key: string;
  wins: number;
  totalConfidence: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  lastSeen: string;
}

export type GroupByMode = 'module' | 'category' | 'backend';
