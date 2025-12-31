import type { Message, UsageStats } from '../backend';
import { runLlm, combineUsage, type Reasoning, type Sandbox } from './llm';
import { getFactoredAnswerCheckPrompt } from '../pipelines/prompts/verifier';

export type VerificationType = 'factual' | 'code' | 'reasoning';

export type CheckDifficulty = 'easy' | 'moderate' | 'hard';

export interface Check {
  id: string;
  question: string;
  targetClaim?: string;
  difficulty?: CheckDifficulty;
}

/**
 * Maps check difficulty to LLM reasoning level.
 * Easy checks (file lookups, simple commands) use low reasoning.
 * Hard checks (algorithm analysis, invariant proofs) use high reasoning.
 */
export function difficultyToReasoning(difficulty?: CheckDifficulty): Reasoning {
  switch (difficulty) {
    case 'hard': return 'high';
    case 'moderate': return 'medium';
    case 'easy':
    default: return 'low';
  }
}

export type CheckVerdict = 'supports' | 'contradicts' | 'uncertain';

export interface CheckResult {
  checkId: string;
  answer: string;
  verdict: CheckVerdict;
  confidence: number;
}

export interface Revision {
  revised: string;
  changes: string[];
  conflicts: string[];
}

export function isUnchanged(revision: Revision, originalDraft: string): boolean {
  return revision.revised === originalDraft;
}

export interface VerificationResult {
  checks: Check[];
  results: CheckResult[];
  revision?: Revision;
  usage: UsageStats;
  sessionId?: string;  // Backend's thread ID for resumability
}

export function formatGenerateChecksPrompt(
  type: VerificationType,
  draft: string,
  originalTask?: string
): string {
  const taskContext = originalTask
    ? `Original task: ${originalTask}\n\n`
    : '';

  switch (type) {
    case 'factual':
      return `${taskContext}Given this draft response, generate verification questions to check its factual accuracy:

<draft>
${draft}
</draft>

Generate 3-5 specific questions that could verify the key claims in this response.
For each question:
- Note which specific claim it verifies
- Assess difficulty: easy (simple lookup), moderate (some analysis), hard (complex reasoning)

Format as:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific claim being verified</claim>
<difficulty>easy|moderate|hard</difficulty>
</check>
...
</checks>`;

    case 'code':
      return `${taskContext}Given this code response, generate verification checks:

<draft>
${draft}
</draft>

Generate 3-5 checks that verify:
1. Correctness (does it do what was asked?)
2. Edge cases (does it handle edge cases?)
3. Best practices (does it follow best practices?)

For each check, assess difficulty:
- easy: Simple lookup (check file exists, import present, type annotation)
- moderate: Some analysis (trace logic, check multiple files, test edge case)
- hard: Complex reasoning (prove correctness, analyze algorithm, verify invariants)

Format as:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific aspect being verified</claim>
<difficulty>easy|moderate|hard</difficulty>
</check>
...
</checks>`;

    case 'reasoning':
      return `${taskContext}Given this reasoning response, generate verification checks:

<draft>
${draft}
</draft>

Generate 3-5 checks that verify:
1. Logical consistency (are the steps valid?)
2. Completeness (are any cases missed?)
3. Correctness (is the conclusion supported?)

For each check, assess difficulty:
- easy: Simple lookup or direct verification
- moderate: Requires tracing logic or checking multiple steps
- hard: Requires proving correctness or analyzing complex reasoning

Format as:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific reasoning step being verified</claim>
<difficulty>easy|moderate|hard</difficulty>
</check>
...
</checks>`;
  }
}

export function formatAnswerChecksPrompt(
  checks: Check[]
): string {
  const checksXml = checks
    .map(c => `<check id="${c.id}">
<question>${c.question}</question>
${c.targetClaim ? `<claim>${c.targetClaim}</claim>` : ''}
</check>`)
    .join('\n');

  return `Answer each verification question independently. For each check, provide a direct answer and indicate whether it supports or contradicts the original claim.

<checks>
${checksXml}
</checks>

Format your response as:
<results>
<result id="1">
<answer>Your direct answer here</answer>
<verdict>supports|contradicts|uncertain</verdict>
<confidence>high|medium|low</confidence>
</result>
<result id="2">
...
</result>
...
</results>

Important: Include exactly one <result> for each <check> id. Evaluate each check independently.`;
}

export function formatRevisionPrompt(
  draft: string,
  contradictions: CheckResult[]
): string {
  const issues = contradictions
    .map((c, i) => `${i + 1}. ${c.answer}`)
    .join('\n');

  return `Revise this draft to address the following issues:

<draft>
${draft}
</draft>

<issues>
${issues}
</issues>

Revise the draft to fix these issues while preserving correct parts.

Format as:
<revised>
Your revised response here
</revised>

<changes>
- Change 1
- Change 2
...
</changes>

<conflicts>
Any unresolved conflicts (or "none")
    </conflicts>`;
}

export function parseChecks(text: string): Check[] {
  const checks: Check[] = [];
  // Match check blocks with lenient parsing:
  // - Allows id attribute anywhere in the opening tag
  // - Allows non-numeric IDs
  // - Allows extra attributes in any order
  // - Supports both double and single quotes for id attribute
  const checkRegex = /<check\s+([^>]*)>([\s\S]*?)<\/check>/g;

  let match;
  while ((match = checkRegex.exec(text)) !== null) {
    const openingTag = match[1];
    const body = match[2];

    // Extract id from opening tag attributes (supports id anywhere, double or single quotes)
    const idMatch = openingTag.match(/id=["']([^"']+)["']/);
    if (!idMatch) continue; // id is required
    const id = idMatch[1];

    // Extract fields from body (order-independent)
    const questionMatch = body.match(/<question>([\s\S]*?)<\/question>/);
    const claimMatch = body.match(/<claim>([\s\S]*?)<\/claim>/);
    const difficultyMatch = body.match(/<difficulty>([\s\S]*?)<\/difficulty>/);

    if (!questionMatch) continue; // question is required

    const difficultyStr = difficultyMatch?.[1]?.trim().toLowerCase();
    const difficulty: CheckDifficulty =
      difficultyStr === 'easy' ? 'easy' :
      difficultyStr === 'moderate' ? 'moderate' :
      difficultyStr === 'hard' ? 'hard' :
      'easy'; // default to easy for safety

    checks.push({
      id,
      question: questionMatch[1].trim(),
      targetClaim: claimMatch?.[1]?.trim(),
      difficulty,
    });
  }

  return checks;
}

export function parseCheckResults(text: string, checks: Check[]): CheckResult[] {
  const results: CheckResult[] = [];
  // Accept non-numeric IDs (e.g., "check-1", "abc123") to match parseChecks behavior
  const resultRegex = /<result id="([^"]+)">\s*<answer>([\s\S]*?)<\/answer>\s*<verdict>([\s\S]*?)<\/verdict>\s*(?:<confidence>([\s\S]*?)<\/confidence>)?\s*<\/result>/g;

  const parsed = new Map<string, CheckResult>();
  let match;
  while ((match = resultRegex.exec(text)) !== null) {
    const id = match[1];
    const answer = match[2].trim();
    const verdictStr = match[3].trim().toLowerCase();
    const confLevel = match[4]?.trim().toLowerCase() ?? 'medium';

    const verdict: CheckVerdict =
      verdictStr === 'contradicts' ? 'contradicts' :
      verdictStr === 'supports' ? 'supports' :
      'uncertain';

    parsed.set(id, {
      checkId: id,
      answer,
      verdict,
      confidence: confLevel === 'high' ? 0.9 : confLevel === 'medium' ? 0.7 : 0.5,
    });
  }

  for (const check of checks) {
    const result = parsed.get(check.id);
    if (result) {
      results.push(result);
    } else {
      results.push({
        checkId: check.id,
        answer: 'Unable to parse result for this check',
        verdict: 'uncertain',
        confidence: 0.5,
      });
    }
  }

  return results;
}

/**
 * Parse a single check result from factored verification response.
 * Returns a default "uncertain" result if parsing fails or ID mismatches.
 */
export function parseSingleCheckResult(text: string, check: Check): CheckResult {
  const resultRegex = /<result id="([^"]*)">\s*<answer>([\s\S]*?)<\/answer>\s*<verdict>([\s\S]*?)<\/verdict>\s*(?:<confidence>([\s\S]*?)<\/confidence>)?\s*<\/result>/;
  const match = resultRegex.exec(text);

  if (!match) {
    return {
      checkId: check.id,
      answer: 'Unable to parse result for this check',
      verdict: 'uncertain',
      confidence: 0.5,
    };
  }

  const resultId = match[1];
  // Validate that the result ID matches the check ID
  if (resultId !== check.id) {
    return {
      checkId: check.id,
      answer: `Result ID mismatch: expected ${check.id}, got ${resultId}`,
      verdict: 'uncertain',
      confidence: 0.5,
    };
  }

  const answer = match[2].trim();
  const verdictStr = match[3].trim().toLowerCase();
  const confLevel = match[4]?.trim().toLowerCase() ?? 'medium';

  const verdict: CheckVerdict =
    verdictStr === 'contradicts' ? 'contradicts' :
    verdictStr === 'supports' ? 'supports' :
    'uncertain';

  return {
    checkId: check.id,
    answer,
    verdict,
    confidence: confLevel === 'high' ? 0.9 : confLevel === 'medium' ? 0.7 : 0.5,
  };
}

export function parseRevision(originalDraft: string, text: string): Revision {
  const revisedMatch = text.match(/<revised>([\s\S]*?)<\/revised>/);
  const changesMatch = text.match(/<changes>([\s\S]*?)<\/changes>/);
  const conflictsMatch = text.match(/<conflicts>([\s\S]*?)<\/conflicts>/);

  const revised = revisedMatch?.[1]?.trim() ?? originalDraft;

  const changesText = changesMatch?.[1] ?? '';
  const changes = changesText
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line.length > 0);

  const conflictsText = conflictsMatch?.[1]?.trim() ?? '';
  const conflicts = conflictsText.toLowerCase() === 'none' || !conflictsText
    ? []
    : [conflictsText];

  return {
    revised,
    changes,
    conflicts,
  };
}

/**
 * Run verification using factored approach (one LLM call per check).
 * 
 * Factored verification answers each check in isolation WITHOUT access to the
 * original draft. This prevents copying hallucinations from the draft.
 * 
 * Each check's difficulty (easy/moderate/hard) maps to reasoning level (low/medium/high).
 * 
 * Supports partial resume:
 * - checksOverride: Use pre-computed checks (skip generation step)
 * - completedResults: Results already computed (skip these checks)
 */
export async function runVerification(args: {
  backend: string;
  model?: string;
  systemPrompt: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  type: VerificationType;
  draft: string;
  originalTask: string;
  onMessage?: (msg: Message) => void;
  /**
   * Factory to create per-check onMessage handlers.
   * When verification runs in parallel, each check needs its own handler
   * that captures the check's index and ID to correctly tag events.
   * If not provided, falls back to onMessage for all checks.
   */
  createCheckMessageHandler?: (info: { index: number; check: Check }) => ((msg: Message) => void) | undefined;
  // Callbacks for streaming verification progress
  onChecksGenerated?: (checks: Check[]) => void;
  onCheckStart?: (info: { index: number; check: Check }) => void;
  onCheckComplete?: (info: { index: number; check: Check; result: CheckResult }) => void;
  // Resume support
  /** Pre-computed checks to use (skip generation step). For resuming from checkpoint. */
  checksOverride?: Check[];
  /** Already-completed results to merge (skip these checks). For resuming mid-verify. */
  completedResults?: CheckResult[];
}): Promise<VerificationResult> {
  const { backend, model, systemPrompt, sandbox, cwd, type, draft, originalTask, onMessage, createCheckMessageHandler } = args;
  const usages: (UsageStats | undefined)[] = [];
  let lastSessionId: string | undefined;

  // Step 1: Get checks (generate or use override)
  let checks: Check[];
  
  if (args.checksOverride && args.checksOverride.length > 0) {
    // Use pre-computed checks (resume mode)
    checks = args.checksOverride;
    // Notify caller of checks (for streaming display consistency)
    args.onChecksGenerated?.(checks);
  } else {
    // Generate checks normally
    const generatePrompt = formatGenerateChecksPrompt(type, draft, originalTask);
    const generateResponse = await runLlm({
      backend,
      model,
      prompt: generatePrompt,
      systemPrompt,
      reasoning: args.reasoning,
      sandbox,
      cwd,
      onMessage,
    });
    usages.push(generateResponse.usage);
    lastSessionId = generateResponse.sessionId;

    checks = parseChecks(generateResponse.text);

    // Notify caller of generated checks (for streaming display)
    if (checks.length > 0) {
      args.onChecksGenerated?.(checks);
    }
  }

  if (checks.length === 0) {
    return {
      checks: [],
      results: [],
      usage: combineUsage(usages),
      sessionId: lastSessionId,
    };
  }

  // Build map of completed results by checkId (for resume)
  const completedResultsById = new Map<string, CheckResult>();
  if (args.completedResults) {
    for (const result of args.completedResults) {
      completedResultsById.set(result.checkId, result);
    }
  }

  // Step 2: Answer each check in isolation (factored verification) — PARALLEL
  // Each check is answered WITHOUT access to the original draft.
  // Reasoning level is determined by the check's difficulty.
  // Tool calls may interleave in the output, which is expected.
  // 
  // IMPORTANT: Each check gets its own onMessage handler via createCheckMessageHandler
  // to avoid race conditions when events interleave during parallel execution.
  //
  // We use Promise.allSettled (not Promise.all) so that individual check failures
  // don't abort the entire verification. Failed checks become "uncertain" results.
  //
  // Skipped checks (from completedResults) don't create promises.
  
  // Identify which checks need to be run vs skipped
  const checksToRun: Array<{ originalIndex: number; check: Check }> = [];
  for (let i = 0; i < checks.length; i++) {
    if (!completedResultsById.has(checks[i].id)) {
      checksToRun.push({ originalIndex: i, check: checks[i] });
    }
  }
  
  const checkPromises = checksToRun.map(async ({ originalIndex, check }) => {
    // Notify caller that we're starting this check (using original index)
    args.onCheckStart?.({ index: originalIndex, check });
    
    const answerPrompt = getFactoredAnswerCheckPrompt(check, originalTask);
    const checkReasoning = difficultyToReasoning(check.difficulty);
    
    // Create per-check message handler to correctly tag interleaved events.
    // Falls back to shared onMessage if factory not provided.
    const checkOnMessage = createCheckMessageHandler?.({ index: originalIndex, check }) ?? onMessage;
    
    const answerResponse = await runLlm({
      backend,
      model,
      prompt: answerPrompt,
      systemPrompt,
      reasoning: checkReasoning,
      sandbox,
      cwd,
      onMessage: checkOnMessage,
    });

    const result = parseSingleCheckResult(answerResponse.text, check);

    return {
      originalIndex,
      check,
      result,
      usage: answerResponse.usage,
      sessionId: answerResponse.sessionId,
    };
  });

  const settledOutcomes = await Promise.allSettled(checkPromises);
  
  // Build results map from newly-run checks
  const newResultsById = new Map<string, CheckResult>();
  for (let i = 0; i < settledOutcomes.length; i++) {
    const outcome = settledOutcomes[i];
    const { originalIndex, check } = checksToRun[i];
    
    if (outcome.status === 'fulfilled') {
      const { result, usage, sessionId } = outcome.value;
      newResultsById.set(check.id, result);
      usages.push(usage);
      if (sessionId) lastSessionId = sessionId;
      
      // Notify caller of successful check completion
      args.onCheckComplete?.({ index: originalIndex, check, result });
    } else {
      // Check failed (LLM error, timeout, etc.) — return "uncertain" result
      const errorMsg = outcome.reason instanceof Error 
        ? outcome.reason.message 
        : String(outcome.reason);
      const failedResult: CheckResult = {
        checkId: check.id,
        answer: `Check failed: ${errorMsg}`,
        verdict: 'uncertain',
        confidence: 0.5,
      };
      newResultsById.set(check.id, failedResult);
      
      // Still notify caller so they see all checks complete
      args.onCheckComplete?.({ index: originalIndex, check, result: failedResult });
    }
  }

  // Step 3: Merge results in checks order (completed + new)
  // Checks order is authoritative - ensures consistent result ordering
  const results: CheckResult[] = checks.map(check => {
    // First try completed results (from resume), then new results
    return completedResultsById.get(check.id) 
        ?? newResultsById.get(check.id) 
        ?? {
          checkId: check.id,
          answer: 'Check not executed',
          verdict: 'uncertain' as const,
          confidence: 0.5,
        };
  });

  return {
    checks,
    results,
    usage: combineUsage(usages),
    sessionId: lastSessionId,
  };
}

/**
 * Run revision on a draft based on verification contradictions.
 * This is a separate step from verification to allow different models.
 */
export async function runRevision(args: {
  backend: string;
  model?: string;
  systemPrompt: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  draft: string;
  contradictions: CheckResult[];
  onMessage?: (msg: Message) => void;
}): Promise<{ revision: Revision; usage: UsageStats; sessionId?: string }> {
  const { backend, model, systemPrompt, reasoning, sandbox, cwd, draft, contradictions, onMessage } = args;

  const revisionPrompt = formatRevisionPrompt(draft, contradictions);
  const revisionResponse = await runLlm({
    backend,
    model,
    prompt: revisionPrompt,
    systemPrompt,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  });

  const revision = parseRevision(draft, revisionResponse.text);

  return {
    revision,
    usage: revisionResponse.usage ?? { inputTokens: 0, outputTokens: 0 },
    sessionId: revisionResponse.sessionId,
  };
}
