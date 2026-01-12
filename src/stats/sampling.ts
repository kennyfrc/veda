/**
 * Statistical sampling utilities for weighted module selection.
 * 
 * Thompson Sampling uses Beta distribution posteriors to balance
 * exploration (try uncertain options) with exploitation (favor winners).
 */

/**
 * Sample from Beta(alpha, beta) distribution.
 * Uses ratio of gamma variates: Beta(a,b) = Gamma(a) / (Gamma(a) + Gamma(b))
 */
export function sampleBeta(alpha: number, beta: number): number {
  const a = gammaVariate(alpha);
  const b = gammaVariate(beta);
  return a / (a + b);
}

/**
 * Generate gamma variate using Marsaglia-Tsang method.
 * For shape < 1, uses Ahrens-Dieter transformation.
 */
function gammaVariate(shape: number): number {
  if (shape < 1) {
    // Ahrens-Dieter: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    return gammaVariate(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  // Marsaglia-Tsang method for shape >= 1
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x: number;
    let v: number;
    do {
      x = normalVariate();
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = Math.random();

    // Quick acceptance
    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v;
    }
    // Slow acceptance
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Generate standard normal variate using Box-Muller transform.
 */
function normalVariate(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Wilson score lower bound for binomial proportion.
 * Provides 95% confidence lower bound on true win rate.
 * 
 * Better than raw win% for small samples:
 * - 1/1 (100%) → ≥21% (high uncertainty)
 * - 10/10 (100%) → ≥72% (more confident)
 * - 0/5 (0%) → ≥0% (could still be bad)
 * 
 * @param wins Number of wins
 * @param n Total appearances
 * @param z Z-score for confidence level (default 1.96 for 95%)
 */
export function wilsonLower(wins: number, n: number, z = 1.96): number {
  if (n === 0) return 0;

  const p = wins / n;
  const zsq = z * z;
  const denom = 1 + zsq / n;
  const center = p + zsq / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + zsq / (4 * n)) / n);

  return Math.max(0, (center - spread) / denom);
}
