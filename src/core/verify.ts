/**
 * Chain-of-Verification (CoVe) implementation: generate checks, answer, revise.
 * Stateless data types and functions.
 */

import type { Message, UsageStats } from '../backend';
import { runLlm, combineUsage, type Reasoning, type Sandbox } from './llm';

export type VerificationType = 'factual' | 'code' | 'reasoning';

export interface Check {
  id: string;
  question: string;
  targetClaim?: string;
}

/** Verdict of a verification check: explicit domain meaning */
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

/**
 * Derive whether a revision is unchanged by comparing to the original draft.
 * Follows pragmatic principle: derive data, don't store it.
 */
export function isUnchanged(revision: Revision, originalDraft: string): boolean {
  return revision.revised === originalDraft;
}

export interface VerificationResult {
  checks: Check[];
  results: CheckResult[];
  revision?: Revision;
  usage: UsageStats;
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
For each question, note which specific claim it verifies.

Format as:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific claim being verified</claim>
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

Format as:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific aspect being verified</claim>
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

Format as:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific reasoning step being verified</claim>
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
  const checkRegex = /<check id="(\d+)">\s*<question>([\s\S]*?)<\/question>\s*(?:<claim>([\s\S]*?)<\/claim>)?\s*<\/check>/g;

  let match;
  while ((match = checkRegex.exec(text)) !== null) {
    checks.push({
      id: match[1],
      question: match[2].trim(),
      targetClaim: match[3]?.trim(),
    });
  }

  return checks;
}

export function parseCheckResults(text: string, checks: Check[]): CheckResult[] {
  const results: CheckResult[] = [];
  const resultRegex = /<result id="(\d+)">\s*<answer>([\s\S]*?)<\/answer>\s*<verdict>([\s\S]*?)<\/verdict>\s*(?:<confidence>([\s\S]*?)<\/confidence>)?\s*<\/result>/g;

  const parsed = new Map<string, CheckResult>();
  let match;
  while ((match = resultRegex.exec(text)) !== null) {
    const id = match[1];
    const answer = match[2].trim();
    const verdictStr = match[3].trim().toLowerCase();
    const confLevel = match[4]?.trim().toLowerCase() ?? 'medium';

    // Parse verdict as direct domain value, avoiding boolean blindness
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

  // Return results in input order, with fallback for missing
  for (const check of checks) {
    const result = parsed.get(check.id);
    if (result) {
      results.push(result);
    } else {
      // Fallback: assume uncertain if check result missing
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

export function parseRevision(originalDraft: string, text: string): Revision {
  const revisedMatch = text.match(/<revised>([\s\S]*?)<\/revised>/);
  const changesMatch = text.match(/<changes>([\s\S]*?)<\/changes>/);
  const conflictsMatch = text.match(/<conflicts>([\s\S]*?)<\/conflicts>/);

  const revised = revisedMatch?.[1]?.trim() ?? originalDraft;

  // Parse changes list
  const changesText = changesMatch?.[1] ?? '';
  const changes = changesText
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line.length > 0);

  // Parse conflicts
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
}): Promise<VerificationResult> {
  const { backend, model, systemPrompt, reasoning, sandbox, cwd, type, draft, originalTask, onMessage } = args;
  const usages: (UsageStats | undefined)[] = [];

  const generatePrompt = formatGenerateChecksPrompt(type, draft, originalTask);
  const generateResponse = await runLlm({
    backend,
    model,
    prompt: generatePrompt,
    systemPrompt,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  });
  usages.push(generateResponse.usage);

  const checks = parseChecks(generateResponse.text);

  if (checks.length === 0) {
    return {
      checks: [],
      results: [],
      usage: combineUsage(usages),
    };
  }

  const answerPrompt = formatAnswerChecksPrompt(checks);
  const answerResponse = await runLlm({
    backend,
    model,
    prompt: answerPrompt,
    systemPrompt,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  });
  usages.push(answerResponse.usage);

  const results = parseCheckResults(answerResponse.text, checks);

  const contradictions = results.filter(r => r.verdict === 'contradicts');

  if (contradictions.length === 0) {
    return {
      checks,
      results,
      usage: combineUsage(usages),
    };
  }

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
  usages.push(revisionResponse.usage);

  const revision = parseRevision(draft, revisionResponse.text);

  return {
    checks,
    results,
    revision,
    usage: combineUsage(usages),
  };
}
