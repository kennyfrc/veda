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

## Deep Mode is Stateless

**Important:** Deep mode is completely stateless. It does not use sessions and does not support `resume`. Each `veda deep` call is independent.

If you need follow-up discussion after getting a deep answer, start a fresh conversation with `veda -p navigator-plan`.

---

## Setting Context

Provide context via the `-f` flag (ad-hoc files) since deep mode doesn't use session-based selection:

```bash
# Provide files directly
veda deep -f src/api/auth.ts -f src/models/user.ts "What's the best way to handle authentication?"

# Or use shell expansion
veda deep -f src/feature/*.ts "Design a caching layer for this"
```

---

## Using Deep Mode

### Basic Usage

```bash
# Simple deep thinking (3 solvers, verification enabled)
veda deep "What's the best way to handle authentication in this app?"

# More solvers for complex questions
veda deep -k 5 "Design a caching layer for this API"

# Skip verification for faster results
veda deep --no-verify "Compare REST vs GraphQL for this use case"

# With context files
veda deep -f src/api/*.ts "Given this code, what's the best approach?"
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-k N` | Number of parallel solvers | 3 |
| `--no-verify` | Skip Chain-of-Verification | verification enabled |
| `-f file` | Add context file(s) | none |
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
# Ask a complex design question with context
veda deep -f src/api/*.ts -f src/models/*.ts \
  "Given this codebase, what's the best strategy for adding real-time notifications? Consider: scalability, complexity, and integration with existing code."

# Save output for reference
veda deep -o design-decision.md "Should we use microservices or monolith for this project?"
```

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
veda deep --json "..." | jq '.answer'
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

2. **Provide context**: Use `-f` to include relevant code files so solvers understand your codebase

3. **Use more solvers for critical decisions**: `-k 5` gives more diverse perspectives

4. **Check the candidates**: The output shows all candidate answers - review them if the final answer seems off

5. **Verification adds value on uncertainty**: If the judge is confident (high), verification is skipped

---

## Reminders

Key commands:
- `veda deep "question"` for deep thinking
- `veda deep -k 5 "question"` for more solvers
- `veda deep --no-verify "question"` for faster results
- `veda deep -f file.ts "question"` to include context
- `veda deep --json "question"` for structured output
- `veda deep -o output.md "question"` to save response

**Note:** Deep mode is stateless - no sessions, no resume. Each run is independent.
