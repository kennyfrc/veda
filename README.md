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

## Install Agent Skills

Veda bundles three [Agent Skills](https://agentskills.io/specification) (`veda-plan`,
`veda-plan-and-implement`, `veda-review`) that teach coding agents how to collaborate
with the Navigator / Reviewer models. One command installs them into the directories
read by **Pi**, **OpenAI Codex CLI**, and **Claude Code**:

```bash
veda skills install     # writes ~/.agents/skills/ + symlinks ~/.claude/skills/
veda skills list        # show install status and symlink health
veda skills uninstall   # remove them
```

`veda init` runs `skills install` as part of first-time setup. The skills travel inside
the compiled `veda` binary as embedded assets, so install needs nothing on disk except
the binary. See [`.agents/skills/README.md`](.agents/skills/README.md) for the full
discovery layout.

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
veda -b droid "..."        # Factory Droid (droid exec)
veda -b pi "..."          # pi CLI (any provider/model from ~/.pi/agent/models.json)
```

**Note on reasoning configuration:**
- **Codex:** Uses native `model_reasoning_effort` flag. The `--reasoning` flag works as expected.
- **Claude Code:** Maps `--reasoning` levels to the `MAX_THINKING_TOKENS` environment variable automatically.
- **pi CLI:** Maps `--reasoning` to pi's `--thinking` flag and `--sandbox` to pi's `--tools` flag. Supports any provider/model defined in `~/.pi/agent/models.json`.
- **Droid:** Maps `--reasoning` to `-r` flag and `--sandbox` to `--auto` flag. Supports any model available to `droid exec`.

### Use Model Aliases

Model aliases auto-select the correct backend:

```bash
# Claude models (→ claude-code backend)
veda -m opus "..."      # Uses claude-code with opus
veda -m sonnet "..."    # Uses claude-code with sonnet
veda -m haiku "..."     # Uses claude-code with haiku

# OpenAI models (→ codex backend)
veda -m gpt "..."       # Uses codex with gpt-5.2


# pi models (→ pi backend, auto-inferred from pi/ prefix)
veda -m pi/wafer/glm-5.1 "..."                        # wafer provider
veda -m pi/fireworks/accounts/fireworks/routers/kimi-k2p6 "..."  # fireworks provider
veda -m pi/neuralwatt/moonshotai/Kimi-K2.6 "..."      # neuralwatt provider
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

**Backend/Model Precedence:**

The `-b` and `-m` flags apply to **all stages** (solver, judge, verifier, revision) unless overridden by per-stage flags:

```bash
# All stages use codex:gpt-5.2
veda deep -b codex -m gpt-5.2 "..."

# All stages use codex:gpt-5.2, except judge uses claude-code:opus
veda deep -m gpt-5.2 --judge-model opus "..."

# -m infers backend from model: opus → claude-code for all stages
veda deep -m opus "..."
```

Precedence order (highest to lowest):
1. Per-stage CLI flags (`--judge-model`, `--verifier-backend`, etc.)
2. Base CLI flags (`-b`, `-m`) — applies to all stages
3. Config file stage defaults (`DEEP_JUDGE_MODEL`, etc.) — only when no `-b`/`-m`
4. Global defaults

**Reasoning Precedence:**

The `-r` flag also applies to **all stages** (solver, judge, verifier, revision) unless overridden by per-stage flags:

```bash
# All stages use high reasoning
veda deep -r high "Complex analysis"

# All stages use high, except verifier uses xhigh
veda deep -r high --verifier-reasoning xhigh "..."

# Per-stage reasoning flags (no -r)
veda deep --solver-reasoning medium --judge-reasoning high "..."
```

Precedence order (highest to lowest):
1. Per-stage CLI flags (`--solver-reasoning`, `--judge-reasoning`, etc.)
2. Base CLI flag (`-r`) — applies to all stages
3. Config file stage defaults (`DEEP_SOLVER_REASONING`, etc.) — only when no `-r`
4. Stage defaults (solver: medium, judge: medium, verifier: high, revision: high)

**Distribute solvers across multiple backends:**
```bash
# Even distribution: 2 solvers per backend (k=6, 3 backends)
veda deep -k 6 --distribute-solvers "Complex problem"
veda deep -k 6 --distribute-solvers --solver-backends claude-code,codex,droid "Custom backends"
```

Order is deterministic: explicit `--solver-backends` is normalized (trim/lowercase/dedup) and sorted before round-robin.

**Note:** `-m` cannot be used with `--distribute-solvers` across multiple backends (use `--solver-model` instead).

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

Each solver uses a different cognitive strategy from 8 categories. Modules are sourced from Polya's "How to Solve It", Hamming's "Art of Doing Science and Engineering", and McKinsey problem-solving frameworks.

| Category | Focus | Example Modules |
|----------|-------|-----------------|
| `analytical` | Critical thinking, root cause analysis | so_what_test, eighty_twenty_focus, causal_analysis |
| `creative` | Novel solutions, reframing | invert_the_problem, first_principles, radical_rethinking |
| `systematic` | Structured decomposition | mece_decomposition, issue_tree, working_backward |
| `strategic` | Planning, hypothesis-driven | hypothesis_first, analogical_transfer, planning |
| `evaluative` | Risk assessment, tradeoffs | risk_assessment, check_completeness, tradeoff_analysis |
| `contextual` | Stakeholder analysis, constraints | stakeholder_analysis, resource_constraints |
| `empirical` | Evidence-based validation | experimental_design, historical_analysis, data_driven |
| `reflective` | Meta-cognition, success criteria | reflective_thinking, success_criteria, decision_under_uncertainty |

```bash
# By category (random module from each)
veda deep --categories analytical,evaluative "Should we use microservices?"

# Exact modules with category/id format
veda deep --modules analytical/so_what_test,systematic/mece_decomposition "Analyze design"

# Mix exact and random: exact analytical, random creative, exact systematic
veda deep --modules analytical/so_what_test,creative,systematic/working_backward "Complex question"
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
veda skills <install|uninstall|list>
veda resume [prompt]
veda deep [options] <prompt>

Options:
  -S, --session <id>     Session ID (or VEDA_SESSION env)
  -p, --persona <name>   navigator-plan|navigator-chat|reviewer
  -b, --backend <name>   codex|claude-code|droid|pi
  -m, --model <model>    Model or alias (opus|sonnet|haiku|gpt|glm-5.2|makora|pi/<provider>/<model-id>)
  -r, --reasoning <lvl>  minimal|low|medium|high|xhigh
  -k <n>                 Solver count for deep mode (default: 3, max: 8)
  --categories <list>    Reasoning categories (comma-separated)
  --modules <list>       Module specifiers: category/id, category, or id
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
├── backend/       # codex.ts, claude.ts, droid.ts, pi.ts
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
BACKEND="pi"
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

# Gemini 3.x: Maps --reasoning to thinkingLevel (LOW|MEDIUM|HIGH)

DROID_MODEL="custom:Makora-GLM-5.2-NVFP4-9"
DROID_REASONING="medium"
# Droid: Maps --reasoning to -r flag, --sandbox to --auto flag
#   minimal → off
#   low → low
#   medium → medium
#   high → high
#   xhigh → high

PI_MODEL="pi/wafer/glm-5.1"
# pi CLI: Maps --reasoning to --thinking flag, --sandbox to --tools flag
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

# Deep mode stage defaults (overridden by -b/-m CLI flags)
DEEP_DISTRIBUTE_SOLVERS="true"
DEEP_SOLVER_BACKENDS="pi"
DEEP_JUDGE_BACKEND="pi"
DEEP_JUDGE_MODEL="pi/wafer/glm-5.1"
DEEP_VERIFIER_BACKEND="pi"
DEEP_VERIFIER_MODEL="pi/wafer/glm-5.1"
DEEP_REVISION_BACKEND="pi"
DEEP_REVISION_MODEL="pi/wafer/glm-5.1"
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
