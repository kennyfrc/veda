import type { Aggregator, AggregatedOutput, StepContext, Solver, Message } from './types';
import { collectMessages, extractText } from '../backend';

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Select most frequent output. Good for discrete answers. */
export const MajorityVote: Aggregator<string> = {
  name: 'majority-vote',
  
  aggregate(outputs: string[]): AggregatedOutput<string> {
    if (outputs.length === 0) {
      return { selected: '', confidence: 0, conflicts: [] };
    }
    
    if (outputs.length === 1) {
      return { selected: outputs[0], confidence: 1 };
    }
    
    // Count occurrences (normalize whitespace for comparison)
    const counts = new Map<string, { normalized: string; original: string; count: number }>();
    
    for (const output of outputs) {
      const normalized = output.trim().toLowerCase();
      const existing = counts.get(normalized);
      if (existing) {
        existing.count++;
      } else {
        counts.set(normalized, { normalized, original: output, count: 1 });
      }
    }
    
    // Sort by count descending
    const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
    
    const winner = sorted[0];
    const confidence = winner.count / outputs.length;
    
    // Collect conflicts (other unique answers)
    const conflicts = sorted.length > 1
      ? sorted.slice(1).map(c => c.original)
      : undefined;
    
    return {
      selected: winner.original,
      confidence,
      conflicts,
    };
  },
};

/** Use first non-empty output. Good for fallback patterns. */
export const FirstSuccess: Aggregator<string> = {
  name: 'first-success',
  
  aggregate(outputs: string[]): AggregatedOutput<string> {
    for (const output of outputs) {
      if (output && output.trim()) {
        return {
          selected: output,
          confidence: 1,
        };
      }
    }
    
    return {
      selected: '',
      confidence: 0,
      conflicts: ['No successful outputs'],
    };
  },
};

/** Select longest output. Heuristic: longer = more detailed. */
export const Longest: Aggregator<string> = {
  name: 'longest',
  
  aggregate(outputs: string[]): AggregatedOutput<string> {
    if (outputs.length === 0) {
      return { selected: '', confidence: 0 };
    }
    
    const sorted = [...outputs].sort((a, b) => b.length - a.length);
    const maxLen = sorted[0].length;
    const avgLen = outputs.reduce((sum, o) => sum + o.length, 0) / outputs.length;
    
    // Confidence based on how much longer the winner is
    const confidence = avgLen > 0 ? Math.min(1, maxLen / avgLen / 2) : 0;
    
    return {
      selected: sorted[0],
      confidence,
    };
  },
};

/** LLM judge picks best answer. Shuffles candidates to reduce position bias. */
export function createJudgeAggregator(judgeSolver: Solver): Aggregator<string> {
  return {
    name: 'judge',
    
    async aggregate(outputs: string[], context?: StepContext): Promise<AggregatedOutput<string>> {
      if (outputs.length === 0) {
        return { selected: '', confidence: 0 };
      }
      
      if (outputs.length === 1) {
        return { selected: outputs[0], confidence: 1 };
      }
      
      // Shuffle to reduce position bias
      // indexMapping[shuffledIdx] = originalIdx
      const indices = outputs.map((_, i) => i);
      const indexMapping = shuffle(indices);
      
      const prompt = formatJudgePrompt(outputs, indexMapping, context);
      const messages = await collectMessages(judgeSolver.run(prompt));
      return parseJudgeResult(outputs, indexMapping, messages);
    },
  };
}

function formatJudgePrompt(
  outputs: string[],
  indexMapping: number[],
  context?: StepContext
): string {
  // Present candidates in shuffled order
  const candidateList = indexMapping
    .map((originalIdx, displayIdx) => `## Candidate ${displayIdx + 1}\n${outputs[originalIdx]}`)
    .join('\n\n');
  
  const taskContext = context?.originalTask
    ? `Original task: ${context.originalTask}\n\n`
    : '';
  
  return `${taskContext}You are a judge evaluating multiple candidate answers.

${candidateList}

---

Evaluate these candidates and select the best one based on:
1. Correctness
2. Completeness
3. Clarity

Respond with:
<best>number of the best candidate (1-${outputs.length})</best>
<confidence>high|medium|low</confidence>
<reason>brief explanation</reason>`;
}

function parseJudgeResult(
  outputs: string[],
  indexMapping: number[],
  messages: Message[]
): AggregatedOutput<string> {
  const text = extractText(messages);
  
  // Parse XML format: <best>N</best>, <confidence>...</confidence>
  const bestMatch = text.match(/<best>\s*(\d+)\s*<\/best>/i);
  const confMatch = text.match(/<confidence>\s*(high|medium|low)\s*<\/confidence>/i);
  
  const displayIdx = bestMatch ? parseInt(bestMatch[1], 10) - 1 : 0;
  const confLevel = confMatch?.[1]?.toLowerCase() ?? 'medium';
  
  const confidence = confLevel === 'high' ? 0.9 : confLevel === 'medium' ? 0.5 : 0.3;
  
  // Map display index back to original index
  const clampedDisplayIdx = Math.min(Math.max(0, displayIdx), indexMapping.length - 1);
  const originalIdx = indexMapping[clampedDisplayIdx];
  const selected = outputs[originalIdx];
  
  // Other candidates are conflicts (filter by original index)
  const conflicts = outputs.filter((_, i) => i !== originalIdx);
  
  return {
    selected,
    confidence,
    conflicts: conflicts.length > 0 ? conflicts : undefined,
  };
}

/** LLM synthesizes best parts of all answers into one. */
export function createMergeAggregator(mergeSolver: Solver): Aggregator<string> {
  return {
    name: 'merge',
    
    async aggregate(outputs: string[], context?: StepContext): Promise<AggregatedOutput<string>> {
      if (outputs.length === 0) {
        return { selected: '', confidence: 0 };
      }
      
      if (outputs.length === 1) {
        return { selected: outputs[0], confidence: 1 };
      }
      
      const prompt = formatMergePrompt(outputs, context);
      const messages = await collectMessages(mergeSolver.run(prompt));
      return parseMergeResult(messages);
    },
  };
}

function formatMergePrompt(outputs: string[], context?: StepContext): string {
  const candidateList = outputs
    .map((o, i) => `## Candidate ${i + 1}\n${o}`)
    .join('\n\n');
  
  const taskContext = context?.originalTask
    ? `Original task: ${context.originalTask}\n\n`
    : '';
  
  return `${taskContext}You are synthesizing multiple candidate answers into a single, superior answer.

${candidateList}

---

Create a merged answer that:
1. Combines the best insights from each candidate
2. Resolves any contradictions (note them in your reasoning)
3. Maintains clarity and coherence

Format your response as:
<merged_answer>
Your synthesized answer here
</merged_answer>

<conflicts>
List any unresolved conflicts or contradictions (if any)
</conflicts>`;
}

function parseMergeResult(messages: Message[]): AggregatedOutput<string> {
  const text = extractText(messages);
  
  // Parse merged answer
  const answerMatch = text.match(/<merged_answer>([\s\S]*?)<\/merged_answer>/);
  const conflictsMatch = text.match(/<conflicts>([\s\S]*?)<\/conflicts>/);
  
  const selected = answerMatch?.[1]?.trim() ?? text;
  const conflictsText = conflictsMatch?.[1]?.trim() ?? '';
  
  const conflicts = conflictsText && conflictsText.toLowerCase() !== 'none'
    ? [conflictsText]
    : undefined;
  
  // Confidence is lower if there were conflicts
  const confidence = conflicts ? 0.7 : 0.9;
  
  return {
    selected,
    confidence,
    conflicts,
  };
}
