# veda-ts

TypeScript implementation of veda - AI CLI wrapper with multi-backend support and deep reasoning.

## Features

- **Multi-backend support**: Switch between codex, claude, and gemini CLI agents
- **Deep thinking mode**: Parallel hypothesis generation with verification
- **Session isolation**: Per-session file selection and conversation history
- **File slices**: Select specific line ranges from files
- **Personas**: Configurable system prompts for different use cases

## Installation

### From source

```bash
cd veda-ts
bun install
bun run build
cp dist/veda ~/.local/bin/
```

### Development

```bash
bun run dev -- --help        # Run directly
bun test                      # Run tests
bun run typecheck            # Type check
```

## Usage

### Basic prompt

```bash
# Simple query
veda "What is the CAP theorem?"

# With persona
veda -p navigator-plan "Design a caching layer"

# With different backend
veda --backend claude "Explain this code"
```

### Selection management

```bash
# Set session ID
export VEDA_SESSION=my-session

# Add files to selection
veda sel add "src/*.ts"

# Add file slices (specific line ranges)
veda sel add main.ts:10-50

# List selection with token counts
veda sel ls

# Clear selection
veda sel clear
```

### Resume conversation

```bash
# Start a conversation
veda -S agent-1 "Design a distributed lock"

# Continue the same conversation
veda -S agent-1 resume "What about fairness?"
```

### Deep thinking mode

```bash
# Full deep thinking (parallel solve + judge + verify)
veda deep "Design a CRDT for collaborative editing"

# With options
veda deep --k 5 --no-verify "Complex architectural decision"
```

## Architecture

```
veda-ts/
├── src/
│   ├── agent/         # Agent config and personas
│   ├── backend/       # CLI backend adapters (codex, claude, gemini)
│   ├── commands/      # CLI command handlers
│   ├── context/       # File selection management
│   ├── conversation/  # Thread/session persistence
│   ├── pipelines/     # Deep thinking orchestration
│   ├── primitives/    # Core orchestration primitives
│   └── util/          # Path and lock utilities
├── tests/             # Test files
└── dist/              # Compiled binary
```

### Core Primitives

The library is built on a set of composable primitives:

- **Solver**: A configured LLM endpoint with a role
- **Step**: Single LLM call with typed input/output
- **Ensemble**: Parallel solvers with aggregation
- **Aggregator**: Strategy for combining outputs (MajorityVote, Judge, Merge)
- **Verification**: Chain-of-Verification for checking outputs
- **Pipeline**: Compose stages with data flow

## Configuration

Config file: `~/.config/veda/config`

```bash
# Default model
MODEL="gpt-5.2"

# Default reasoning level
REASONING="medium"

# Default persona
PERSONA="navigator-chat"

# Default backend
BACKEND="codex"
```

## Personas

Personas are stored in `~/.config/veda/personas/<name>/AGENTS.md`.

Built-in personas:
- `navigator-plan`: High-level planning (xhigh reasoning)
- `navigator-chat`: General assistance (medium reasoning)
- `reviewer`: Code review (medium reasoning)

Create new ones by adding directories with AGENTS.md files.

## Session Isolation

Use `-S <session>` or `VEDA_SESSION` env var to isolate selections between concurrent agents:

```bash
# Different agents can have different selections
VEDA_SESSION=agent-1 veda sel add "src/*.ts"
VEDA_SESSION=agent-2 veda sel add "tests/*.ts"
```

## License

MIT
