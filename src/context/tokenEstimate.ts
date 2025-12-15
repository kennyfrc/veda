// Token estimation using language-specific ratios (Latin: ~4, CJK: ~0.6, Cyrillic: ~3.5).

const RATIOS = {
  latin: 4.0,       // ~4 chars/token - industry consensus for English
  cyrillic: 3.5,    // ~3.5 chars/token - slightly higher token premium
  devanagari: 3.0,  // ~3 chars/token - multi-byte UTF-8 overhead
  cjk: 0.6,         // ~0.6 chars/token - most CJK chars = 2-3 BPE tokens
  other: 3.5,       // ~3.5 chars/token - punctuation/symbols often multi-token
} as const;

/** Default safety buffer (15%) to avoid hitting token limits */
export const DEFAULT_SAFETY_BUFFER = 0.15;

// Unicode script patterns (native ES2018+ property escapes)
const PATTERNS = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  // CJK: Han (Chinese) + Hiragana/Katakana (Japanese) + Hangul (Korean)
  han: /\p{Script=Han}/u,
  hiragana: /\p{Script=Hiragana}/u,
  katakana: /\p{Script=Katakana}/u,
  hangul: /\p{Script=Hangul}/u,
  devanagari: /\p{Script=Devanagari}/u,
} as const;

export interface ScriptCharCounts {
  /** Total codepoints (not bytes) */
  totalCodepoints: number;
  /** Latin script characters */
  latin: number;
  /** Cyrillic script characters */
  cyrillic: number;
  /** Devanagari script characters */
  devanagari: number;
  /** CJK characters (Han + Hiragana + Katakana + Hangul) */
  cjk: number;
  /** Everything else (digits, punctuation, emoji, whitespace) */
  other: number;
}

export interface TokenEstimate {
  /** Estimated token count (rounded up) */
  tokens: number;
  /** Character counts by script */
  counts: ScriptCharCounts;
}

/**
 * Count characters by Unicode script.
 */
export function countScripts(text: string): ScriptCharCounts {
  // Use Array.from for proper surrogate pair handling
  const codepoints = Array.from(text);
  const total = codepoints.length;

  let latin = 0;
  let cyrillic = 0;
  let devanagari = 0;
  let cjk = 0;

  for (const char of codepoints) {
    if (PATTERNS.latin.test(char)) {
      latin++;
    } else if (PATTERNS.cyrillic.test(char)) {
      cyrillic++;
    } else if (PATTERNS.devanagari.test(char)) {
      devanagari++;
    } else if (
      PATTERNS.han.test(char) ||
      PATTERNS.hiragana.test(char) ||
      PATTERNS.katakana.test(char) ||
      PATTERNS.hangul.test(char)
    ) {
      cjk++;
    }
    // Everything else falls into 'other'
  }

  const other = total - latin - cyrillic - devanagari - cjk;

  return {
    totalCodepoints: total,
    latin,
    cyrillic,
    devanagari,
    cjk,
    other,
  };
}

/**
 * Estimate token count using weighted script ratios.
 * Handles mixed-script content by summing per-script estimates.
 */
export function estimateTokensByScript(text: string): TokenEstimate {
  const counts = countScripts(text);

  if (counts.totalCodepoints === 0) {
    return { tokens: 0, counts };
  }

  // Weighted estimate: sum of (count / ratio) for each script
  const estimate =
    counts.latin / RATIOS.latin +
    counts.cyrillic / RATIOS.cyrillic +
    counts.devanagari / RATIOS.devanagari +
    counts.cjk / RATIOS.cjk +
    counts.other / RATIOS.other;

  return {
    tokens: Math.ceil(estimate),
    counts,
  };
}

/**
 * Estimate token count with safety buffer to avoid hitting limits.
 * 
 * @param text - Text to estimate tokens for
 * @param buffer - Safety buffer as decimal (default: 0.15 = 15%)
 * @returns Token estimate with buffer applied
 * 
 * @example
 * // Get conservative estimate with 15% buffer
 * const safe = estimateTokensWithBuffer("Hello world");
 * 
 * @example
 * // Custom 20% buffer for extra safety
 * const safer = estimateTokensWithBuffer("Hello world", 0.20);
 */
export function estimateTokensWithBuffer(
  text: string,
  buffer: number = DEFAULT_SAFETY_BUFFER
): number {
  const base = estimateTokensByScript(text).tokens;
  return Math.ceil(base * (1 + buffer));
}
