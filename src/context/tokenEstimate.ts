/**
 * Token estimation with Unicode script detection.
 * 
 * Uses language-specific characters-per-token ratios based on research:
 * - Latin (English, Spanish, etc.): ~4.5 chars/token
 * - Cyrillic (Russian, Ukrainian): ~4.0 chars/token
 * - CJK (Chinese, Japanese, Korean): ~1.4 chars/token
 * - Devanagari (Hindi, Sanskrit): ~3.5 chars/token
 * - Other (digits, punctuation, symbols): ~4.0 chars/token
 */

// Characters per token ratios by script
const RATIOS = {
  latin: 4.5,
  cyrillic: 4.0,
  devanagari: 3.5,
  cjk: 1.4,
  other: 4.0,
} as const;

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
