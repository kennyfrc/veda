import type { Message } from '../backend';
import { runLlm, type Reasoning, type Sandbox } from './llm';
import {
  XML_JUDGE_FORMAT,
  shuffleCandidates,
  type JudgeDecision,
  type JudgeResult,
  type ConfidenceLevel,
  type JudgeFormat,
} from './judge-format';

export type { JudgeDecision, JudgeResult, ConfidenceLevel };
export {
  XML_JUDGE_FORMAT,
  shuffleCandidates,
  shuffleCandidates as shuffle,
  type JudgeFormat,
} from './judge-format';

export function formatJudgePrompt(
  candidates: string[],
  indexMapping: number[],
  originalTask?: string
): string {
  return XML_JUDGE_FORMAT.format(candidates, indexMapping, originalTask);
}

export function parseJudgeDecision(
  text: string,
  indexMapping: number[],
  _candidateCount?: number
): JudgeDecision {
  return XML_JUDGE_FORMAT.parse(text, indexMapping);
}

export async function runJudge(args: {
  backend: string;
  model?: string;
  systemPrompt: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  candidates: string[];
  originalTask?: string;
  onMessage?: (msg: Message) => void;
  format?: JudgeFormat;
}): Promise<JudgeResult> {
  const { backend, model, systemPrompt, reasoning, sandbox, cwd, candidates, originalTask, onMessage, format = XML_JUDGE_FORMAT } = args;

  if (candidates.length === 0) {
    return {
      decision: { selectedIndex: 0, confidence: 0, confidenceLevel: 'low' },
      selected: '',
      conflicts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (candidates.length === 1) {
    return {
      decision: { selectedIndex: 0, confidence: 1, confidenceLevel: 'high' },
      selected: candidates[0],
      conflicts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const { indexMapping } = shuffleCandidates(candidates);

  const prompt = format.format(candidates, indexMapping, originalTask);

  const response = await runLlm({
    backend,
    model,
    prompt,
    systemPrompt,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  });

  const decision = format.parse(response.text, indexMapping);
  const selected = candidates[decision.selectedIndex];
  const conflicts = candidates.filter((_, i) => i !== decision.selectedIndex);

  return {
    decision,
    selected,
    conflicts,
    usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
    sessionId: response.sessionId,
  };
}
