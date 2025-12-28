import { runJudge } from "./src/core/judge";
import { JUDGE_SYSTEM_PROMPT } from "./src/pipelines/prompts/judge";

const candidates = [
  "The answer is 42.",
  "The answer is 42.",
  "The answer is 43."
];

const result = await runJudge({
  backend: "codex",
  systemPrompt: JUDGE_SYSTEM_PROMPT,
  candidates,
  originalTask: "What is the answer to life, the universe, and everything?"
});

console.log(JSON.stringify(result.decision, null, 2));
