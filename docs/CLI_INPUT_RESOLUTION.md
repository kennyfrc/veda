# CLI Input Resolution Specification

This document maps the **implemented behavior** of veda's CLI input resolution.

## Implementation Status: ✅ Complete

**Files:**
- `src/cli/types.ts` - Discriminated union types
- `src/cli/parse.ts` - Tokenize argv, classify command  
- `src/cli/validate.ts` - Flag applicability, conflict detection
- `src/cli/resolve.ts` - Backend/model resolution
- `src/cli/index.ts` - Main `parseAndValidate()` entry point

**Tests:** 63 tests passing (32 new + 31 existing)

---

## Commands & Modes

| Command | Mode | Description |
|---------|------|-------------|
| `veda <prompt>` | simple | Single LLM call |
| `veda --deep <prompt>` or `veda deep <prompt>` | deep | Ensemble solvers → judge → optional verify |
| `veda resume [prompt]` | resume | Continue existing conversation |
| `veda sel <subcommand>` | selection | Manage file context |
| `veda init` | init | Initialize config |
| `veda personas` | personas | List available personas |

---

## Flag Applicability Matrix

Which flags apply to which commands?

| Flag | `prompt` | `deep` | `resume` | `sel` | Notes |
|------|:--------:|:------:|:--------:|:-----:|-------|
| `-S, --session` | ✅ | ✅ | ✅ | ✅ | Session ID |
| `-b, --backend` | ✅ | ✅ | ❌ | ❌ | Resume uses saved backend |
| `-m, --model` | ✅ | ✅ | ✅ | ❌ | |
| `-p, --persona` | ✅ | ❌ | ✅ | ❌ | Deep mode doesn't use personas |
| `-r, --reasoning` | ✅ | ❌ | ✅ | ❌ | Deep has fixed reasoning per stage |
| `--sandbox` | ✅ | ❌ | ✅ | ❌ | Deep is always read-only |
| `-f, --files` | ✅ | ✅ | ❌ | ❌ | Ad-hoc context |
| `--no-sel` | ✅ | ✅ | ❌ | ❌ | Ignore selection |
| `-o, --output` | ✅ | ✅ | ✅ | ❌ | Save to file |
| `--json` | ✅ | ✅ | ✅ | ❌ | JSON output |
| `--notify / --no-notify` | ✅ | ✅ | ✅ | ❌ | System notifications |
| `-k` | ❌ | ✅ | ❌ | ❌ | Number of solvers (1-8) |
| `--categories` | ❌ | ✅ | ❌ | ❌ | Reasoning categories |
| `--modules` | ❌ | ✅ | ❌ | ❌ | Exact modules |
| `--uniform` | ❌ | ✅ | ❌ | ❌ | Disable Thompson Sampling (uniform random module selection) |
| `--low-count-modules` | ❌ | ✅ | ❌ | ❌ | Bias module selection toward low-appearance modules (single-judge) |
| `--no-verify` | ❌ | ✅ | ❌ | ❌ | Skip verification |
| `--force-verify` | ❌ | ✅ | ❌ | ❌ | Always verify |
| `--trace` | ❌ | ✅ | ❌ | ❌ | Save trace YAML |
| `--solver-backend` | ❌ | ✅ | ❌ | ❌ | Per-stage override |
| `--solver-model` | ❌ | ✅ | ❌ | ❌ | Per-stage override |
| `--judge-backend` | ❌ | ✅ | ❌ | ❌ | Per-stage override |
| `--judge-model` | ❌ | ✅ | ❌ | ❌ | Per-stage override |
| `--verifier-backend` | ❌ | ✅ | ❌ | ❌ | Per-stage override |
| `--verifier-model` | ❌ | ✅ | ❌ | ❌ | Per-stage override |
| `--distribute-solvers` | ❌ | ✅ | ❌ | ❌ | Round-robin backends |
| `--solver-backends` | ❌ | ✅ | ❌ | ❌ | Backends for distribution |

### Questions for you:

1. **Should flags that don't apply to a command produce an error or be silently ignored?**
   - Current: Silently ignored
   - Proposed: Error with "flag X is not valid for command Y"

2. **`-p, --persona` in deep mode** — currently ignored. Should it error?

---

## Backend/Model Resolution

### Model Aliases

| Alias | Backend | Model |
|-------|---------|-------|
| `opus` | `claude-code` | `opus` |
| `sonnet` | `claude-code` | `sonnet` |
| `haiku` | `claude-code` | `haiku` |
| `gpt` | `codex` | `gpt-5.2` |
| `gemini-pro` | `gemini-cli` | `gemini-3-pro-preview` |
| `gemini-flash` | `gemini-cli` | `gemini-3-flash-preview` |

### Model Prefix Inference

When a model is specified but NOT in aliases, infer backend from prefix:

| Prefix | Backend |
|--------|---------|
| `gpt-*` | `codex` |
| `o1-*` | `codex` |
| `o3-*` | `codex` |
| `gemini-*` | `gemini-cli` |
| `claude-*` | `claude-code` |

### Backend Default Models

| Backend | Default Model |
|---------|---------------|
| `codex` | `gpt-5.2` |
| `claude-code` | `opus` |
| `gemini-cli` | `gemini-3-pro-preview` |

---

## Resolution Precedence: Simple Mode (`veda <prompt>`)

```
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND RESOLUTION                          │
├─────────────────────────────────────────────────────────────────┤
│  1. CLI: -b/--backend                                           │
│  2. Model alias inference (if -m opus → claude-code)            │
│  3. Model prefix inference (if -m gpt-5.2 → codex)              │
│  4. Config file: BACKEND=...                                    │
│  5. Default: codex                                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      MODEL RESOLUTION                           │
├─────────────────────────────────────────────────────────────────┤
│  1. CLI: -m/--model                                             │
│  2. Config file: <BACKEND>_MODEL=... (e.g., CLAUDE_CODE_MODEL)  │
│  3. Config file: MODEL=...                                      │
│  4. Backend default (see table above)                           │
└─────────────────────────────────────────────────────────────────┘
```

### Example Scenarios (Simple Mode)

| Input | Backend | Model | Why |
|-------|---------|-------|-----|
| `veda "hello"` | `codex` | `gpt-5.2` | All defaults |
| `veda -m opus "hello"` | `claude-code` | `opus` | Alias infers backend |
| `veda -b gemini-cli "hello"` | `gemini-cli` | `gemini-3-pro-preview` | Explicit backend, default model |
| `veda -b codex -m opus "hello"` | `codex` | `opus` | Explicit backend wins, model literal |
| `veda -m gpt-5.2 "hello"` | `codex` | `gpt-5.2` | Prefix infers backend |
| `veda -m unknown-model "hello"` | ❌ ERROR | - | Unknown model, no backend |

### Questions for you:

3. **`-b codex -m opus`** — opus is a claude alias, but -b forces codex. Current behavior passes `opus` literally to codex (probably fails). **Should this error at parse time?**

---

## Resolution Precedence: Deep Mode

Deep mode has 3 stages, each with independent backend/model:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOLVER BACKEND RESOLUTION                    │
├─────────────────────────────────────────────────────────────────┤
│  1. --solver-backend (single backend for all solvers)           │
│  2. --distribute-solvers + --solver-backends (round-robin)      │
│  3. --solver-model inference (if specified, infer backend)      │
│  4. Base backend (from -b or config or default)                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     SOLVER MODEL RESOLUTION                     │
├─────────────────────────────────────────────────────────────────┤
│  Per backend in the solver pool:                                │
│  1. --solver-model                                              │
│  2. -m/--model (inherited from global)                          │
│  3. Backend's default model                                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    JUDGE BACKEND RESOLUTION                     │
├─────────────────────────────────────────────────────────────────┤
│  1. --judge-backend                                             │
│  2. --judge-model inference                                     │
│  3. First solver's backend (if distributed)                     │
│  4. Base backend                                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     JUDGE MODEL RESOLUTION                      │
├─────────────────────────────────────────────────────────────────┤
│  1. --judge-model                                               │
│  2. -m/--model (inherited from global)                          │
│  3. Judge backend's default model                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  VERIFIER BACKEND RESOLUTION                    │
├─────────────────────────────────────────────────────────────────┤
│  1. --verifier-backend                                          │
│  2. --verifier-model inference                                  │
│  3. Judge's backend (follows judge by default)                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   VERIFIER MODEL RESOLUTION                     │
├─────────────────────────────────────────────────────────────────┤
│  1. --verifier-model                                            │
│  2. Judge's model (follows judge by default)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Example Scenarios (Deep Mode)

| Input | Solvers | Judge | Verifier | Notes |
|-------|---------|-------|----------|-------|
| `veda deep "solve"` | `codex/gpt-5.2` ×4 | `codex/gpt-5.2` | `codex/gpt-5.2` | All defaults |
| `veda deep -m opus "solve"` | `claude-code/opus` ×4 | `claude-code/opus` | `claude-code/opus` | Alias propagates everywhere |
| `veda deep -b gemini-cli "solve"` | `gemini-cli/gemini-3-pro-preview` ×4 | same | same | Backend explicit, model defaults |
| `veda deep --solver-model haiku "solve"` | `claude-code/haiku` ×4 | `codex/gpt-5.2` | `codex/gpt-5.2` | Solver override, judge/verifier default |
| `veda deep --judge-model opus "solve"` | `codex/gpt-5.2` ×4 | `claude-code/opus` | `claude-code/opus` | Judge alias, verifier follows judge |
| `veda deep --distribute-solvers "solve"` | round-robin available backends | first solver's backend | same | |
| `veda deep -m opus --distribute-solvers "solve"` | ❌ ERROR | - | - | Can't use -m with multi-backend distribution |

### Questions for you:

4. **Verifier follows judge by default** — is this intentional? Should verifier follow base instead?

5. **`--solver-backend` vs `--distribute-solvers`** — these are mutually exclusive. Current: `--solver-backend` wins silently. **Should this error?**

6. **`-m` with `--distribute-solvers`** — currently errors if multiple unique backends. **Is this the right behavior?**

---

## Conflicting Flags

### Currently Detected Conflicts

| Flags | Current Behavior | Proposed |
|-------|------------------|----------|
| `--no-verify` + `--force-verify` | Both can be set, `--no-verify` wins | Error: mutually exclusive |
| `--solver-backend` + `--distribute-solvers` | `--solver-backend` wins | Error: mutually exclusive |
| `-m` + `--distribute-solvers` (multi-backend) | Error | ✅ Keep |
| `--modules` + `--categories` | Both used (modules override k) | Document this |

### Currently Undetected Conflicts

| Flags | Current Behavior | Proposed |
|-------|------------------|----------|
| `-b codex -m opus` | Passes opus to codex (likely fails at runtime) | Error: alias target mismatch |
| `--solver-model X --solver-backend Y` (X aliases to different backend) | Uses Y with model X literally | Error or warning |
| `-p navigator-plan --deep` | Persona ignored | Error: persona not used in deep mode |
| `--trace file.yaml` (without deep) | Ignored | Error: --trace requires deep mode |

### Questions for you:

7. **What should happen with `-b codex -m opus`?**
   - A) Error: "opus resolves to claude-code, conflicts with -b codex"
   - B) Warning + use opus literally (current)
   - C) Silently use opus literally

8. **What about `--solver-model opus --solver-backend codex`?** Same question.

---

## Proposed Discriminated Union Types

Based on the above, here's how the input space could be modeled:

```typescript
// Top-level command discrimination
type VedaInput =
  | { command: 'prompt'; mode: 'simple'; config: SimpleConfig }
  | { command: 'prompt'; mode: 'deep'; config: DeepConfig }
  | { command: 'resume'; config: ResumeConfig }
  | { command: 'sel'; subcommand: SelSubcommand; args: string[] }
  | { command: 'init' }
  | { command: 'personas' }

// Simple mode config
interface SimpleConfig {
  session: string;
  prompt: string;
  backend: ResolvedBackend;
  persona?: string;
  reasoning?: ReasoningLevel;
  sandbox?: SandboxMode;
  context: ContextConfig;
  output: OutputConfig;
}

// Deep mode config  
interface DeepConfig {
  session: string;
  prompt: string;
  k: number;  // 1-8
  context: ContextConfig;
  output: OutputConfig;
  verify: VerifyConfig;
  stages: {
    solver: SolverStageConfig;
    judge: StageConfig;
    verifier: StageConfig;
  };
}

// Verification is a discriminated union
type VerifyConfig =
  | { enabled: false }
  | { enabled: true; forced: boolean }

// Solver has special distribution logic
type SolverStageConfig =
  | { mode: 'fixed'; backend: string; model: string }
  | { mode: 'distributed'; backends: string[]; modelPerBackend: Map<string, string> }

// Judge/Verifier are simpler
interface StageConfig {
  backend: string;
  model: string;
}

// Context loading
interface ContextConfig {
  useSelection: boolean;  // inverse of --no-sel
  adhocFiles: string[];   // -f flags
}

// Output handling
type OutputConfig =
  | { format: 'text' }
  | { format: 'json' }
  | { format: 'file'; path: string }
```

### Questions for you:

9. **Does this type structure match your mental model?**

10. **Should we add a `--dry-run` flag that shows the resolved config without executing?** This would help debug complex flag combinations.

---

## Validation Rules Summary

If we implement strict validation, these combinations would error:

| Rule | Error Message |
|------|---------------|
| `--no-verify` + `--force-verify` | "Cannot use --no-verify and --force-verify together" |
| `--solver-backend` + `--distribute-solvers` | "Cannot use --solver-backend with --distribute-solvers" |
| `-m <alias>` + `-b <different-backend>` | "Model alias '<alias>' targets <target-backend>, conflicts with -b <backend>" |
| `--trace` without deep mode | "--trace requires deep mode (use --deep or `veda deep`)" |
| `-p/--persona` with deep mode | "--persona is not used in deep mode" |
| `--solver-*` without deep mode | "--solver-backend requires deep mode" |
| Unknown model (no alias, no prefix, no explicit backend) | "Unknown model '<model>'. Use -b to specify backend, or use an alias: opus, sonnet, ..." |

---

## Next Steps

Please review and answer the numbered questions above. Once confirmed, I'll:

1. Create Zod schemas that encode these rules
2. Refactor `parseArgs()` to return discriminated union types
3. Add property-based tests for the resolution logic
4. Centralize all resolution in one module with this doc as the source of truth
