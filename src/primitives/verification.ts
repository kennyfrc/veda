/**
 * Verification implementation - Task-aware output checking.
 * 
 * Implements Chain-of-Verification (CoVe) pattern:
 * 1. Generate verification checks from draft output
 * 2. Answer checks independently
 * 3. Revise draft based on check results
 */

import { collectMessages, extractText } from '../backend';
import type {
  Verification,
  Check,
  CheckResult,
  RevisionResult,
  Solver,
  StepContext,
} from './types';

export interface CreateVerificationOptions {
  /** Verification type */
  type: 'factual' | 'code' | 'reasoning';
  /** Solver for verification steps */
  solver: Solver;
}

/**
 * Create a verification instance.
 */
export function createVerification(options: CreateVerificationOptions): Verification {
  const { type, solver } = options;
  
  return {
    type,
    solver,
    
    async generateChecks(draft: string, context: StepContext): Promise<Check[]> {
      const prompt = getGenerateChecksPrompt(type, draft, context);
      const messages = await collectMessages(solver.run(prompt));
      const text = extractText(messages);
      return parseChecks(text);
    },
    
    async answerChecks(checks: Check[]): Promise<CheckResult[]> {
      // Answer each check independently
      const results = await Promise.all(
        checks.map(async (check) => {
          const prompt = getAnswerCheckPrompt(type, check);
          const messages = await collectMessages(solver.run(prompt));
          const text = extractText(messages);
          return parseCheckResult(check.id, text);
        })
      );
      
      return results;
    },
    
    async revise(draft: string, results: CheckResult[]): Promise<RevisionResult> {
      // Find contradictions
      const contradictions = results.filter(r => r.contradictsDraft);
      
      if (contradictions.length === 0) {
        return {
          revised: draft,
          changes: [],
          conflicts: [],
          unchanged: true,
        };
      }
      
      const prompt = getRevisionPrompt(type, draft, contradictions);
      const messages = await collectMessages(solver.run(prompt));
      const text = extractText(messages);
      return parseRevisionResult(draft, text);
    },
  };
}

// ============================================================================
// Prompt Templates
// ============================================================================

function getGenerateChecksPrompt(
  type: 'factual' | 'code' | 'reasoning',
  draft: string,
  context: StepContext
): string {
  const taskContext = context.originalTask
    ? `Original task: ${context.originalTask}\n\n`
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

function getAnswerCheckPrompt(
  type: 'factual' | 'code' | 'reasoning',
  check: Check
): string {
  return `Answer this verification question:

Question: ${check.question}
${check.targetClaim ? `Claim being verified: ${check.targetClaim}` : ''}

Provide a direct answer. Then indicate whether your answer contradicts or supports the original claim.

Format as:
<answer>Your direct answer here</answer>
<verdict>supports|contradicts|uncertain</verdict>
<confidence>high|medium|low</confidence>`;
}

function getRevisionPrompt(
  type: 'factual' | 'code' | 'reasoning',
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

// ============================================================================
// Parsers
// ============================================================================

function parseChecks(text: string): Check[] {
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

function parseCheckResult(checkId: string, text: string): CheckResult {
  const answerMatch = text.match(/<answer>([\s\S]*?)<\/answer>/);
  const verdictMatch = text.match(/<verdict>([\s\S]*?)<\/verdict>/);
  const confMatch = text.match(/<confidence>([\s\S]*?)<\/confidence>/);
  
  const verdict = verdictMatch?.[1]?.trim().toLowerCase() ?? 'uncertain';
  const confLevel = confMatch?.[1]?.trim().toLowerCase() ?? 'medium';
  
  return {
    checkId,
    answer: answerMatch?.[1]?.trim() ?? text,
    contradictsDraft: verdict === 'contradicts',
    confidence: confLevel === 'high' ? 0.9 : confLevel === 'medium' ? 0.7 : 0.5,
  };
}

function parseRevisionResult(originalDraft: string, text: string): RevisionResult {
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
    unchanged: revised === originalDraft,
  };
}
