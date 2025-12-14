## Your Task

Use **deep thinking mode** (`veda deep`) to get high-quality, verified answers for complex planning and design questions. Deep mode runs multiple solvers in parallel, aggregates their answers with a judge, and optionally verifies/revises the result.

### When to Use Deep Mode

Deep mode is best for:
- **Architecture decisions**: "Should we use microservices or monolith?"
- **Design tradeoffs**: "What's the best caching strategy for this use case?"
- **Complex debugging**: "Why might this race condition occur?"
- **Open-ended questions**: "What's the best approach to implement X?"

For simple factual queries or quick questions, use regular `veda` instead.

---

## Session Isolation (Critical for Multi-Agent)

**Always use `-S $VEDA_SESSION`** (or set `VEDA_SESSION` env var) to isolate your selection from other concurrent agents.

```bash
# Set session ID (stable per shell, unique per terminal)
export VEDA_SESSION="${VEDA_SESSION:-agent-$$}"
```

---

## Setting Context

Build context with `veda sel add` before running deep mode. The context is passed to all solvers.

```bash
# Clear and build selection
veda -S $VEDA_SESSION sel clear
veda -S $VEDA_SESSION sel add "src/feature/" "src/shared/"

# Check token count (aim for <80k)
veda -S $VEDA_SESSION sel ls
```

### File Slices

Use slices to focus on specific code sections:

```bash
veda -S $VEDA_SESSION sel add main.c:10-50       # Lines 10-50
veda -S $VEDA_SESSION sel add "src/*.ts:1-100"   # First 100 lines of each
```

---

## Using Deep Mode

### Basic Usage

```bash
# Simple deep thinking (3 solvers, verification enabled)
veda -S $VEDA_SESSION deep "What's the best way to handle authentication in this app?"

# More solvers for complex questions
veda -S $VEDA_SESSION deep -k 5 "Design a caching layer for this API"

# Skip verification for faster results
veda -S $VEDA_SESSION deep --no-verify "Compare REST vs GraphQL for this use case"
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-k N` | Number of parallel solvers | 3 |
| `--no-verify` | Skip Chain-of-Verification | verification enabled |
| `--json` | Output structured JSON result | text output |
| `-o file` | Save response to file | stdout |

### How It Works

1. **Parallel Solving**: N solvers generate independent answers using prompt diversity
2. **Judge Aggregation**: A judge LLM evaluates all candidates and selects/synthesizes the best answer with a confidence level (low/medium/high)
3. **Verification Gate**: Verification triggers when judge confidence < 70% (i.e., low or medium confidence)
4. **Chain-of-Verification**: If triggered, generates verification questions, answers them independently, and revises the answer if contradictions are found

---

## Example Workflow

```bash
# 1. Set session
export VEDA_SESSION="${VEDA_SESSION:-agent-$$}"

# 2. Build context
veda -S $VEDA_SESSION sel clear
veda -S $VEDA_SESSION sel add "src/api/" "src/models/" "src/config/"
veda -S $VEDA_SESSION sel ls

# 3. Ask a complex design question
veda -S $VEDA_SESSION deep "Given this codebase, what's the best strategy for adding real-time notifications? Consider: scalability, complexity, and integration with existing code."
```

**Note:** Deep mode does not support `resume` - each run is stateless. If you need follow-up discussion, use `veda -p navigator-plan` for a fresh planning conversation.

---

## Output Format

Deep mode shows progress as it runs:

```
[deep] Starting deep thinking mode...

[solve] Starting...
  Candidate 1: Use WebSockets with Redis pub/sub for horizontal scaling...
  Candidate 2: Server-Sent Events (SSE) would be simpler and sufficient...
  Candidate 3: Consider a hybrid approach with WebSockets for bidirectional...

[solve] Selected answer (confidence: 70%)
[solve] Complete (28432 tokens)
[verify] Starting...
[verify] Revised: Added consideration for connection limits...
[verify] Complete

[complete] Stages: solve → verify
[complete] Confidence: 70%
[complete] Answer was revised by verification
[complete] Total tokens: 28432

[Final answer here...]
```

### JSON Output

Use `--json` for structured output:

```bash
veda -S $VEDA_SESSION deep --json "..." | jq '.answer'
```

Returns:
```json
{
  "answer": "Final synthesized answer...",
  "confidence": 0.7,
  "candidates": ["Candidate 1...", "Candidate 2...", "Candidate 3..."],
  "wasRevised": true,
  "usage": {"inputTokens": 28000, "outputTokens": 432},
  "stages": ["solve", "verify"]
}
```

---

## Tips

1. **Be specific**: "Design a caching layer" → "Design a caching layer for user session data with 100k DAU, prioritizing read performance"

2. **Provide context**: Select relevant code files so solvers understand your codebase

3. **Use more solvers for critical decisions**: `-k 5` gives more diverse perspectives

4. **Check the candidates**: The output shows all candidate answers - review them if the final answer seems off

5. **Verification adds value on uncertainty**: If the judge is confident (high), verification is skipped

---

## Reminders

Key commands:
- `veda -S $VEDA_SESSION sel add` to build context
- `veda -S $VEDA_SESSION sel ls` to check token count
- `veda -S $VEDA_SESSION deep "question"` for deep thinking
- `veda -S $VEDA_SESSION deep -k 5 "question"` for more solvers
- `veda -S $VEDA_SESSION deep --no-verify "question"` for faster results
- `veda -S $VEDA_SESSION deep --json "question"` for structured output
- **Always use `-S $VEDA_SESSION`** to avoid conflicts with other agents
