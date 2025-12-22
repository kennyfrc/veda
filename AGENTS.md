# AGENTS.md

## Build

```bash
bun run build
```

## Test

```bash
bun test
bun run typecheck
```

## Code

- TypeScript with strict mode
- ES modules
- Root entry: `src/index.ts`
- Tests in `tests/`

## Style

**Deep primitives**: Plain data structs with standalone functions.

Core primitives:
- `LlmRequest` / `runLlm` — single model invocation
- `Ensemble` / `runEnsemble` — parallel LLM calls
- `Judge` / `runJudge` — select best candidate
- `Verification` / `runVerification` — fact-checking (Chain-of-Verification)

**Deep thinking pipeline**:
- `Solver` — runs with a reasoning strategy (8 categories: analytical, creative, systematic, strategic, evaluative, contextual, empirical, reflective)
- `Persona` — config wrapper (navigator-plan, navigator-chat, reviewer)
- `Session` — state isolation for concurrent agents

**Principles**:
- Inline until duplication appears
- Additive over invasive evolution
- Let callers drive control flow (callbacks optional, provide immediate-mode)
- Derive data, don't store it
