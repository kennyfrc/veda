# Monorepo & Prompt Optimizer Plan

## Overview

This plan covers two phases:
1. **Phase 1: Monorepo Restructuring** — Extract core primitives into `llm-kit`, keep veda CLI separate
2. **Phase 2: Prompt Optimizer** — Build `prompt-optimizer` package for iterative prompt optimization

### Package Relationship

```
llm-kit                 # Shared primitives (no brand)
    ↑
    ├── veda            # Deep-think CLI (veda brand)
    │
    └── prompt-optimizer  # Prompt optimization tool (separate product)
```

---

## Phase 1: Monorepo Restructuring

### Goal

Convert veda-ts from a single package into a monorepo with:
- `llm-kit` — Shared primitives (runLlm, runEnsemble, runJudge, runVerification, etc.)
- `veda` — The deep-think CLI tool, depends on llm-kit

### Target Structure

```
veda-ts/
├── packages/
│   ├── llm-kit/                    # llm-kit (shared primitives)
│   │   ├── src/
│   │   │   ├── llm.ts              # LlmRequest, runLlm, streamLlm
│   │   │   ├── ensemble.ts         # EnsembleMember, runEnsemble
│   │   │   ├── judge.ts            # runJudge, JudgeResult
│   │   │   ├── judge-format.ts     # XML format, shuffling
│   │   │   ├── verify.ts           # runVerification, runRevision
│   │   │   ├── modules.ts          # ReasoningModule, selectModules
│   │   │   ├── backend/            # Backend abstraction (claude, gemini, codex)
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── registry.ts
│   │   │   │   ├── claude.ts
│   │   │   │   ├── gemini.ts
│   │   │   │   └── codex.ts
│   │   │   └── index.ts            # Public exports
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   │
│   └── veda/                       # veda (CLI tool)
│       ├── src/
│       │   ├── index.ts            # CLI entry point
│       │   ├── cli.ts              # Help, version, arg parsing
│       │   ├── cli/                # Parse, validate, resolve, adapter
│       │   ├── commands/           # run, deep, resume, init, personas, sel
│       │   ├── pipelines/          # deep-think pipeline
│       │   ├── agent/              # Config, personas, sandbox
│       │   ├── context/            # Context gathering
│       │   ├── conversation/       # Conversation state
│       │   └── util/               # CLI utilities (stdin, output, etc.)
│       ├── package.json            # Depends on llm-kit
│       ├── tsconfig.json
│       └── README.md
│
├── package.json                    # Workspace root
├── tsconfig.base.json              # Shared TypeScript config
├── bunfig.toml                     # Bun workspace config
└── README.md
```

### Package Boundaries

**llm-kit exports:**
- Types: `LlmRequest`, `LlmResponse`, `Message`, `UsageStats`, `Reasoning`, `Sandbox`
- Types: `EnsembleMember`, `EnsembleOutput`, `EnsembleResult`, `EnsembleEvent`
- Types: `JudgeDecision`, `JudgeResult`, `ConfidenceLevel`
- Types: `Check`, `CheckResult`, `Revision`, `VerificationResult`, `VerificationType`
- Types: `ReasoningModule`, `ModuleCategory`, `ModuleRegistry`
- Functions: `runLlm`, `streamLlm`, `isBackendAvailable`, `extractText`, `extractErrors`, `getSessionId`, `getUsage`, `combineUsage`
- Functions: `runEnsemble`
- Functions: `runJudge`, `formatJudgePrompt`, `parseJudgeDecision`, `shuffleCandidates`
- Functions: `runVerification`, `runRevision`, `parseChecks`, `parseCheckResults`, `parseRevision`
- Functions: `selectModules`, `createModuleRegistry`, `REASONING_MODULES`, `DEFAULT_REGISTRY`
- Backend: `getBackend`, `registerBackend`, backend implementations

**veda keeps:**
- CLI parsing and validation
- Commands (run, deep, resume, init, personas, sel)
- Pipelines (deep-think orchestration with streaming UI)
- Agent config, personas, sandbox
- Context gathering
- Conversation state
- Output formatting, spinner, colors

### Migration Steps

#### Step 1.1: Set up monorepo infrastructure
- [ ] Create `packages/` directory
- [ ] Create root `package.json` with bun workspaces
- [ ] Create `tsconfig.base.json` with shared compiler options
- [ ] Update `bunfig.toml` for workspaces

#### Step 1.2: Extract llm-kit
- [ ] Create `packages/llm-kit/` structure
- [ ] Move `src/core/*.ts` → `packages/llm-kit/src/`
- [ ] Move `src/backend/*.ts` → `packages/llm-kit/src/backend/`
- [ ] Create `packages/llm-kit/package.json` with name `llm-kit`
- [ ] Create `packages/llm-kit/tsconfig.json` extending base
- [ ] Create `packages/llm-kit/src/index.ts` with all public exports
- [ ] Ensure no imports from veda-specific code

#### Step 1.3: Create veda package
- [ ] Create `packages/veda/` structure
- [ ] Move remaining `src/` files → `packages/veda/src/`
- [ ] Update all imports to use `llm-kit`
- [ ] Create `packages/veda/package.json` with dependency on `llm-kit`
- [ ] Create `packages/veda/tsconfig.json` extending base
- [ ] Update bin entry point

#### Step 1.4: Update build and test
- [ ] Update root `package.json` scripts for workspace builds
- [ ] Move/update tests to appropriate packages
- [ ] Verify `bun run build` works
- [ ] Verify `bun test` works
- [ ] Verify CLI still works: `bun run packages/veda/src/index.ts --help`

#### Step 1.5: Clean up
- [ ] Remove old `src/` directory
- [ ] Update root README.md
- [ ] Update AGENTS.md with new structure

### Verification Criteria
- [ ] `bun install` works at root
- [ ] `bun run build` builds both packages
- [ ] `bun test` runs tests for both packages
- [ ] `veda --help` works
- [ ] `veda "test prompt"` works (simple run)
- [ ] `veda -d "test prompt"` works (deep think)
- [ ] All existing tests pass

---

## Phase 2: Prompt Optimizer

### Goal

Build `prompt-optimizer` — a standalone tool for iteratively improving prompts using:
- Golden examples (input → expected output pairs)
- Binary pass/fail rubric criteria (Hamel Hussain's best practices)
- Multi-round optimization with early stopping on regression

### Target Structure

```
packages/
└── prompt-optimizer/               # prompt-optimizer
    ├── src/
    │   ├── types.ts                # Core types
    │   ├── modules.ts              # Prompt transformation modules
    │   ├── evaluate.ts             # Run prompt against examples, score
    │   ├── generate.ts             # Generate prompt variants
    │   ├── optimize.ts             # Main optimization loop
    │   └── index.ts                # Public exports
    ├── tests/
    │   ├── evaluate.test.ts
    │   ├── generate.test.ts
    │   └── optimize.test.ts
    ├── package.json                # Depends on llm-kit
    ├── tsconfig.json
    └── README.md
```

### Data Structures

```typescript
// types.ts

/** A single input/output pair the optimized prompt should reproduce */
interface GoldenExample {
  id: string;
  input: string;
  expectedOutput: string;
}

/** A binary pass/fail criterion for judging outputs */
interface RubricCriterion {
  id: string;
  name: string;
  description: string;        // What the judge looks for
  passExample?: string;       // Few-shot: example of passing
  failExample?: string;       // Few-shot: example of failing
}

/** The complete rubric: multiple binary criteria */
interface Rubric {
  criteria: RubricCriterion[];
}

/** Result of evaluating one criterion on one output */
interface CriterionResult {
  criterionId: string;
  pass: boolean;
  critique: string;           // Detailed explanation
}

/** Result of evaluating one golden example */
interface ExampleEvalResult {
  exampleId: string;
  actualOutput: string;
  criterionResults: CriterionResult[];
  passRate: number;           // Derived: # passed / # criteria
}

/** Result of evaluating a prompt variant across all examples */
interface VariantEvalResult {
  variantId: string;
  prompt: string;
  exampleResults: ExampleEvalResult[];
  overallPassRate: number;    // Derived: avg passRate across examples
}

/** A module for generating prompt variants */
interface PromptModule {
  id: string;
  name: string;
  instruction: string;        // How to transform the prompt
}

/** Configuration for the optimization run */
interface OptimizeConfig {
  basePrompt: string;
  goldenExamples: GoldenExample[];
  rubric: Rubric;
  maxRounds?: number;         // Default: 3
  variantsPerRound?: number;  // Default: 3
  backend?: string;
  model?: string;
  modules?: string[];         // Specific modules to use
}

/** Result of a single optimization round */
interface RoundResult {
  round: number;
  variants: VariantEvalResult[];
  bestVariant: VariantEvalResult;
  improved: boolean;          // Did best beat previous round?
}

/** Final optimization result */
interface OptimizeResult {
  originalPrompt: string;
  optimizedPrompt: string;
  originalPassRate: number;
  optimizedPassRate: number;
  rounds: RoundResult[];
  stoppedEarly: boolean;      // True if regression caused early stop
}
```

### Operations

#### evaluate.ts
```typescript
/** Evaluate a single output against rubric criteria */
async function evaluateCriteria(
  output: string,
  expected: string,
  rubric: Rubric,
  options: EvalOptions
): Promise<CriterionResult[]>;

/** Run prompt against all golden examples and score */
async function evaluatePrompt(
  prompt: string,
  examples: GoldenExample[],
  rubric: Rubric,
  options: EvalOptions
): Promise<VariantEvalResult>;
```

#### generate.ts
```typescript
/** Generate N prompt variants using selected modules */
async function generateVariants(
  basePrompt: string,
  feedback: string,           // Critique from previous round
  modules: PromptModule[],
  options: GenerateOptions
): Promise<string[]>;
```

#### optimize.ts
```typescript
/** Main optimization loop */
async function* optimize(
  config: OptimizeConfig
): AsyncGenerator<OptimizeEvent>;

/** Blocking version */
async function runOptimize(
  config: OptimizeConfig
): Promise<OptimizeResult>;
```

### Prompt Modules

Unlike the 8 reasoning categories in veda/core, these are specific to prompt transformation:

```typescript
const PROMPT_MODULES: PromptModule[] = [
  {
    id: 'clarify_intent',
    name: 'Clarify Intent',
    instruction: 'Make the prompt\'s goal and expected output format more explicit. Add clarifying context about what success looks like.',
  },
  {
    id: 'add_constraints',
    name: 'Add Constraints',
    instruction: 'Add specific constraints or boundaries to guide the output. Include what NOT to do.',
  },
  {
    id: 'add_examples',
    name: 'Add Examples',
    instruction: 'Add concrete input/output examples to the prompt as few-shot demonstrations.',
  },
  {
    id: 'simplify',
    name: 'Simplify',
    instruction: 'Remove unnecessary complexity. Make instructions more direct and concise.',
  },
  {
    id: 'restructure',
    name: 'Restructure',
    instruction: 'Reorganize the prompt structure. Try numbered steps, sections, or different ordering.',
  },
  {
    id: 'add_persona',
    name: 'Add Persona',
    instruction: 'Add or refine a persona/role for the model to adopt that aligns with the task.',
  },
];
```

### Optimization Loop

```
Round 0 (Baseline):
  1. Evaluate basePrompt against all goldenExamples
  2. Score with rubric → baselinePassRate
  3. Collect critiques for failures

Round 1..N:
  1. Generate K variants using modules + failure critiques
  2. Evaluate each variant against all goldenExamples
  3. Score each with rubric → variantPassRates
  4. Select best variant
  5. If bestPassRate < previousBestPassRate → STOP (regression)
  6. If round == maxRounds → STOP
  7. Collect critiques for failures → feed into next round

Return: best prompt found, all round results
```

### Implementation Steps

#### Step 2.1: Create package structure
- [ ] Create `packages/prompt-optimizer/` directory
- [ ] Create `package.json` with `llm-kit` dependency
- [ ] Create `tsconfig.json` extending base
- [ ] Create `src/index.ts` with placeholder exports

#### Step 2.2: Implement types
- [ ] Create `src/types.ts` with all interfaces
- [ ] Export from index

#### Step 2.3: Implement modules
- [ ] Create `src/modules.ts` with PROMPT_MODULES
- [ ] Add selectPromptModules function

#### Step 2.4: Implement evaluate
- [ ] Create `src/evaluate.ts`
- [ ] Implement `evaluateCriteria` using runLlm with judge prompt
- [ ] Implement `evaluatePrompt` orchestrating multiple examples
- [ ] Use runEnsemble for parallel evaluation across examples
- [ ] Write tests

#### Step 2.5: Implement generate
- [ ] Create `src/generate.ts`
- [ ] Implement `generateVariants` using runEnsemble with modules
- [ ] Incorporate failure critiques into generation prompt
- [ ] Write tests

#### Step 2.6: Implement optimize
- [ ] Create `src/optimize.ts`
- [ ] Implement optimization loop with early stopping
- [ ] Implement streaming via AsyncGenerator
- [ ] Implement blocking `runOptimize` wrapper
- [ ] Write tests

#### Step 2.7: Documentation and examples
- [ ] Write README.md with usage examples
- [ ] Add example script in `examples/`

### Verification Criteria
- [ ] Package builds successfully
- [ ] Unit tests pass for evaluate, generate, optimize
- [ ] Integration test: optimize a simple prompt with 3 golden examples
- [ ] Early stopping works when regression detected
- [ ] Can import and use from external project

---

## Dependencies

```
Phase 1 (Monorepo) ──────► Phase 2 (Prompt Optimizer)
     │
     └── Must complete before Phase 2 can begin
```

## Open Questions

1. **Package publishing**: Will these be published to npm, or internal only?
2. **Shared utilities**: Some utils (like AsyncQueue) may need to move to llm-kit or a shared utils package
3. **Backend configuration**: Should prompt-optimizer have its own config, or reuse llm-kit's backend system?

---

## References

- [Hamel Hussain: LLM-as-Judge Guide](https://hamel.dev/blog/posts/llm-judge/)
- [Hamel Hussain: Why Binary Pass/Fail](https://hamel.dev/blog/posts/evals-faq/why-do-you-recommend-binary-passfail-evaluations-instead-of-1-5-ratings-likert-scales.html)
- [Bloom Framework](https://github.com/safety-research/bloom) — inspiration for iterative evaluation pipelines
