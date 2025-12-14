# veda-ts

TypeScript CLI for AI-assisted development with multi-backend support and deep reasoning.

## Motivation

I wanted a subagent that does heavy thinking. Something that can take as long as it needs to—you use it sparingly, but when you do, it goes deep. Similar to Ampcode's Oracle, where I can delegate to Codex for the hard stuff.

I also wanted to replicate what Grok Heavy, GPT Pro, and Gemini Deepthink do: multiple rollouts, verification sequences, the works. So I built my own, based on a couple of papers:

- [Self-Discover](https://arxiv.org/abs/2402.03620) for structured reasoning
- [Chain-of-Verification](https://arxiv.org/abs/2309.11495) for fact-checking outputs

Multiple solvers run in parallel, a judge synthesizes the best answer, and a verifier kicks in when there's disagreement. That's basically it—a homegrown Deepthink I can invoke from the terminal.

## Quick Start

```bash
# Install
bun install && bun run build
cp dist/veda ~/.local/bin/

# Basic usage
veda "What is the CAP theorem?"
veda -p navigator-plan "Design a caching layer"
veda -b claude "Explain this code"

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
veda -b codex "..."    # OpenAI Codex (default)
veda -b claude "..."   # Anthropic Claude
veda -b gemini "..."   # Google Gemini
```

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
veda deep --json "..." | jq '.candidates'     # JSON output
```

### Use Personas

```bash
veda -p navigator-plan "..."   # Planning (high reasoning)
veda -p navigator-chat "..."   # Discussion (medium reasoning)
veda -p reviewer "..."         # Code review (high reasoning)
veda personas                  # List available
```

## Key Concepts

### Primitives

The core building blocks for AI orchestration:

| Primitive | Purpose | Example |
|-----------|---------|---------|
| **Solver** | Configured LLM endpoint with role | `createSolver({ backend, systemPrompt })` |
| **Step** | Single LLM call with typed I/O | `createStep({ solver, formatPrompt, parseOutput })` |
| **Ensemble** | Parallel solvers with aggregation | `createEnsemble({ solvers, aggregator })` |
| **Aggregator** | Combine multiple outputs | `MajorityVote`, `createJudgeAggregator(solver)` |
| **Verification** | Chain-of-Verification | `createVerification({ type, solver })` |

### Deep Thinking Pipeline

```
┌─────────────┐
│   Prompt    │
└──────┬──────┘
       ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Solver 1   │    │  Solver 2   │    │  Solver 3   │  (parallel, diverse backends)
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       └──────────────────┼──────────────────┘
                          ▼
                 ┌─────────────────┐
                 │      Judge      │  (select/synthesize best)
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │    Verifier     │  (if disagreement detected)
                 └────────┬────────┘
                          ▼
                 ┌─────────────────┐
                 │     Answer      │
                 └─────────────────┘
```

**Verification triggers when:**
- Solvers disagree (low agreement rate)
- Judge picks minority answer
- Low margin between top answers

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
  -b, --backend <name>   codex|claude|gemini
  -m, --model <model>    Model override
  -r, --reasoning <lvl>  minimal|low|medium|high|xhigh
  -k <n>                 Solver count for deep mode (default: 3)
  --no-verify            Skip verification in deep mode
  --no-sel               Ignore selection
  --json                 JSON output
  -o, --output <file>    Save to file
```

### Project Structure

```
src/
├── primitives/    # Solver, Step, Ensemble, Aggregator, Verification
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
MODEL="gpt-5.2"
REASONING="medium"
PERSONA="navigator-chat"
BACKEND="codex"
```

## Development

```bash
bun test              # Run 147 tests
bun run build         # Compile to dist/veda
bun run dev -- args   # Run without compiling
```

## License

MIT
