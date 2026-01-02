/**
 * Judge statistics types for tracking module win rates.
 * 
 * Records are append-only JSONL entries that capture each successful
 * judge decision, enabling analysis of module bias and effectiveness.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * A single judge decision record.
 * Stored as one JSON line in judge-stats.jsonl.
 */
export interface StatEntry {
  /** Schema version for forward compatibility */
  version: 1;
  /** ISO timestamp of the decision */
  timestamp: string;
  /** Hash of the prompt (16 hex chars) for correlation */
  promptHash: string;
  /** The judge model that made the decision */
  judge: {
    backend: string;
    model: string;
  };
  /** The winning candidate's metadata */
  winner: {
    category: string;
    moduleId: string;
    backend: string;
    model: string;
  };
  /** Confidence of the decision */
  confidence: {
    level: ConfidenceLevel;
    score: number;  // 0.9 (high), 0.5 (medium), 0.3 (low)
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
