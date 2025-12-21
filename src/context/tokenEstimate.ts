const RATIOS = {
  latin: 4.0,       // ~4 chars/token (English consensus)
  cyrillic: 3.5,    // ~3.5 chars/token
  devanagari: 3.0,  // ~3 chars/token (multi-byte UTF-8 overhead)
  cjk: 0.6,         // ~0.6 chars/token (most CJK chars = 2-3 BPE tokens)
  other: 3.5,
} as const;

export const DEFAULT_SAFETY_BUFFER = 0.15;

const PATTERNS = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  han: /\p{Script=Han}/u,
  hiragana: /\p{Script=Hiragana}/u,
  katakana: /\p{Script=Katakana}/u,
  hangul: /\p{Script=Hangul}/u,
  devanagari: /\p{Script=Devanagari}/u,
} as const;

export interface ScriptCharCounts {
  totalCodepoints: number;
  latin: number;
  cyrillic: number;
  devanagari: number;
  cjk: number;
  other: number;
}

export interface TokenEstimate {
  tokens: number;
  counts: ScriptCharCounts;
}

export function countScripts(text: string): ScriptCharCounts {
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
 * Estimate token count using weighted script ratios to handle mixed-script content.
 */
export function estimateTokensByScript(text: string): TokenEstimate {
  const counts = countScripts(text);

  if (counts.totalCodepoints === 0) {
    return { tokens: 0, counts };
  }

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

export function estimateTokensWithBuffer(
  text: string,
  buffer: number = DEFAULT_SAFETY_BUFFER
): number {
  const base = estimateTokensByScript(text).tokens;
  return Math.ceil(base * (1 + buffer));
}
