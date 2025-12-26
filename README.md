# veda-ts

TypeScript CLI for AI-assisted development with multi-backend support and deep reasoning.

## Motivation

I wanted a subagent that does heavy thinking. Something that can take as long as it needs to—you use it sparingly. Good examples are architectural planning or debugging hard problems.

Stuff like GPT High was not enough for me. I needed something closer to GPT Pro, Gemini Deepthink, Grok Heavy, or Kimi K2 Heavy—where you do multiple rollouts and converge on the right answer.

So I built my own, inspired by a few papers:

- [Self-Consistency](https://arxiv.org/abs/2203.11171) — sample diverse reasoning paths, aggregate the best
- [Universal Self-Consistency](https://arxiv.org/abs/2311.17311) — use an LLM as judge to select among candidates
- [Chain-of-Verification](https://arxiv.org/abs/2309.11495) — fact-check outputs before finalizing

Solvers run in parallel, each using a different problem-solving strategy. A judge picks the best answer, and a verifier kicks in when confidence is low. That's basically it—a homegrown Deepthink I can invoke from the terminal.

## Quick Start

```bash
# Install
bun install && bun run build
cp dist/veda ~/.local/bin/

# Basic usage
veda "What is the CAP theorem?"
veda -p navigator-plan "Design a caching layer"
veda -m opus "Explain this code"          # Auto-selects claude-code backend

# Deep thinking (parallel solvers + verification)
veda deep "Best architecture for real-time sync?"
```

## How-To Guides

### Manage File Selection

```bash
export VEDA_SESSION=my-session

veda sel add "src/*.ts"           # Add files (quote globs)
veda sel add main.ts:10-50        # Add line range (1-indexed)
veda sel ls                       # List with token counts
veda sel rm main.ts               # Remove file and all its slices
veda sel clear                    # Clear all
```

### Use Different Backends

```bash
veda -b codex "..."        # OpenAI Codex (default)
veda -b claude-code "..."  # Anthropic Claude Code
veda -b gemini-cli "..."   # Google Gemini CLI
```

**Note on reasoning configuration:**
- **Codex:** Uses native `model_reasoning_effort` flag. The `--reasoning` flag works as expected.
- **Claude Code:** Maps `--reasoning` levels to the `MAX_THINKING_TOKENS` environment variable automatically.
- **Gemini CLI:** Injects scoped override into `~/.gemini/settings.json`. Automatically cleaned up after execution.

### Use Model Aliases

Model aliases auto-select the correct backend:

```bash
# Claude models (→ claude-code backend)
veda -m opus "..."      # Uses claude-code with opus
veda -m sonnet "..."    # Uses claude-code with sonnet
veda -m haiku "..."     # Uses claude-code with haiku

# OpenAI models (→ codex backend)
veda -m gpt "..."       # Uses codex with gpt-5.2

# Gemini models (→ gemini-cli backend)
veda -m gemini-pro "..."    # Uses gemini-cli with gemini-3-pro-preview
veda -m gemini-flash "..."  # Uses gemini-cli with gemini-3-flash-preview
```

When you specify both `-b` and `-m`, the model is passed literally (no alias resolution).

**Note:** The `--reasoning` flag (`-r`) is fully supported by the Codex backend, automatically configured for the Claude backend (mapped to `MAX_THINKING_TOKENS`), and supported by the Gemini backend (via scoped settings.json override with automatic cleanup).

### Resume Conversations

```bash
veda -S agent-1 "Design a distributed lock"
veda -S agent-1 resume "What about fairness?"
veda -S agent-1 resume -- "--explain flags"  # Prompt with dashes
```

### Use Deep Thinking Mode

```bash
veda deep "Complex design question"           # 3 solvers, verification on
veda deep -k 5 "Critical architecture"        # 5 solvers
veda deep --no-verify "Quick comparison"      # Skip verification
veda deep --trace /tmp/trace.yaml "..."       # Save trace for debugging
veda deep --json "..." | jq '.candidates'     # JSON output

# Per-stage model/backend overrides (mixed providers)
veda deep --solver-model opus --judge-model gpt "..."
veda deep --solver-backend claude-code --verifier-backend codex "..."
```

**Distribute solvers across multiple backends:**
```bash
# Even distribution: 2 solvers per backend (k=6, 3 backends)
veda deep -k 6 --distribute-solvers "Complex problem"
veda deep -k 6 --distribute-solvers --solver-backends claude-code,gemini-cli,codex "Custom backends"
```

Order is deterministic: explicit `--solver-backends` is normalized (trim/lowercase/dedup) and sorted before round-robin.

### Use Personas

```bash
veda -p navigator-plan "..."   # Planning (high reasoning)
veda -p navigator-chat "..."   # Discussion (medium reasoning)
veda -p reviewer "..."         # Code review (high reasoning)
veda personas                  # List available
```

## Architecture

### Core Primitives

The library uses data-oriented primitives—plain data structs with standalone functions:

**LLM Call** — Single model invocation
```typescript
interface LlmRequest {
  backend: string;
  prompt: string;
  context?: string;
  systemPrompt: string;
  model?: string;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'full';
}

// Usage
const response = await runLlm(request);
console.log(response.text, response.usage);
```

**Ensemble** — Parallel LLM calls
```typescript
const result = await runEnsemble([
  { id: 'solver-1', request: { backend: 'codex', prompt, systemPrompt: '...' } },
  { id: 'solver-2', request: { backend: 'codex', prompt, systemPrompt: '...' } },
]);
console.log(result.successful); // Array of response texts
```

**Judge** — Select best candidate
```typescript
const result = await runJudge({
  backend: 'codex',
  systemPrompt: JUDGE_SYSTEM_PROMPT,
  candidates: ['Answer A', 'Answer B', 'Answer C'],
  originalTask: 'What is 2+2?',
});
console.log(result.selected, result.decision.confidence);
```

**Verification** — Chain-of-Verification for fact-checking
```typescript
const result = await runVerification({
  backend: 'codex',
  systemPrompt: VERIFIER_SYSTEM_PROMPT,
  type: 'reasoning',
  draft: 'The answer is 42',
  originalTask: 'What is the meaning of life?',
});
console.log(result.checks, result.results, result.revision);
```

### Deep Thinking Pipeline

```
┌─────────────┐
│   Prompt    │
└──────┬──────┘
       ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Solver 1   │    │  Solver 2   │    │  Solver 3   │  (parallel, diverse strategies)
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       └──────────────────┼──────────────────┘
                          ▼
                 ┌─────────────────┐
                 │      Judge      │  (select best candidate)
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │    Verifier     │  (if confidence < 70%)
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │     Answer      │
                 └─────────────────┘
```

**Verification triggers when:**
- Judge confidence is below 70% (medium or low)

### Reasoning Modules

Each solver uses a different cognitive strategy from 8 categories:

| Category | Focus |
|----------|-------|
| `analytical` | Critical thinking, assumption analysis, causal reasoning |
| `creative` | Novel solutions, alternative perspectives |
| `systematic` | Step-by-step decomposition, simplification |
| `strategic` | Planning, iterative solving |
| `evaluative` | Risk assessment, tradeoff analysis |
| `contextual` | Stakeholder analysis, constraints |
| `empirical` | Data analysis, experimental design |
| `reflective` | Meta-cognition, success metrics |

```bash
veda deep --categories analytical,evaluative "Should we use microservices?"
veda deep --modules critical_thinking,step_by_step "Analyze this design"
```

### Backends

Each backend normalizes to a common `Message` stream:

```typescript
interface Message {
  type: 'init' | 'text' | 'reasoning' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content?: string;
  sessionId?: string;
  usage?: { inputTokens: number; outputTokens: number };
}
```

### Sessions

Sessions isolate state between concurrent agents:
- File selection: `~/.config/veda/sessions/<id>/selection`
- Thread info: `~/.config/veda/sessions/<id>/thread.json`

## Reference

### CLI Options

```
veda [options] <prompt>
veda sel <add|rm|ls|clear|tokens> [args]
veda resume [prompt]
veda deep [options] <prompt>

Options:
  -S, --session <id>     Session ID (or VEDA_SESSION env)
  -p, --persona <name>   navigator-plan|navigator-chat|reviewer
  -b, --backend <name>   codex|claude-code|gemini-cli
  -m, --model <model>    Model or alias (opus|sonnet|haiku|gpt|gemini-pro|gemini-flash)
  -r, --reasoning <lvl>  minimal|low|medium|high|xhigh
  -k <n>                 Solver count for deep mode (default: 3, max: 8)
  --categories <list>    Reasoning categories (comma-separated)
  --modules <list>       Exact module IDs (comma-separated)
  --no-verify            Skip verification in deep mode
  --trace <file>         Save trace to YAML file
  --no-sel               Ignore selection
  --json                 JSON output
  -o, --output <file>    Save to file

Deep Mode Stage Overrides:
  --solver-backend <name>   Backend for solvers
  --solver-model <model>    Model for solvers
  --judge-backend <name>    Backend for judge
  --judge-model <model>     Model for judge
  --verifier-backend <name> Backend for verifier
  --verifier-model <model>  Model for verifier
```

### Project Structure

```
src/
├── core/          # Deep primitives (llm, ensemble, judge, verify, modules)
├── backend/       # codex.ts, claude.ts, gemini.ts
├── pipelines/     # deep-think.ts (orchestration)
├── context/       # Selection and slice management
├── conversation/  # Thread persistence
├── agent/         # Config and persona loading
├── commands/      # CLI handlers
└── cli.ts         # Argument parsing
```

### Configuration

`~/.config/veda/config`:
```bash
# Default backend
BACKEND="codex"
PERSONA="navigator-chat"

# Per-backend model and reasoning settings
CODEX_MODEL="gpt-5.2"
CODEX_REASONING="medium"     # Uses native -c model_reasoning_effort flag

CLAUDE_CODE_MODEL="opus"
# CLAUDE_CODE_REASONING is mapped to MAX_THINKING_TOKENS env variable:
#   minimal → 0 (disabled)
#   low → 7999 (8k-1 tokens)
#   medium → 15999 (16k-1 tokens)
#   high → 31999 (32k-1 tokens)
#   xhigh → 63999 (64k-1 tokens)

GEMINI_CLI_MODEL="gemini-3-pro-preview"
# Gemini 3.x: Maps --reasoning to thinkingLevel (LOW|MEDIUM|HIGH)
#   minimal → LOW
#   low → LOW
#   medium → MEDIUM
#   high → HIGH
#   xhigh → HIGH
# Gemini 2.x: Maps --reasoning to thinkingBudget (tokens)
#   minimal → 8192 (same as low)
#   low → 8192
#   medium → 16000
#   high → 32000
#   xhigh → 32000
# Implementation: Injects scoped override into ~/.gemini/settings.json
```

## Development

```bash
bun test              # Run tests
bun run typecheck     # Type check
bun run build         # Compile to dist/veda
bun run dev -- args   # Run without compiling
```

## License

MIT
