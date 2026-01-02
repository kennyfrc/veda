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

## Resuming Deep Mode Sessions

Deep mode now supports `resume` for continuing conversations. Each session's thread is preserved for follow-up.

```bash
# Get initial deep answer
veda -S deep-auth-strategy deep --trace /tmp/deep-trace.yaml "What's the best way to handle authentication?"

# Resume the same session for follow-up questions
veda -S deep-auth-strategy resume "Can you elaborate on the JWT approach?"
veda -S deep-auth-strategy resume "What about OAuth integration options?"
```

For complex follow-up discussions that benefit from iterative refinement, consider using `veda -p navigator-chat` - it's optimized for conversational flow. Use `resume` when you need to:
- Stay within the same session context
- Maintain the thread for reference
- Ask specific follow-up questions about the deep answer

---

## Session Naming (for Selection)

**Use a descriptive, contextual session ID** with `-S` to isolate your file selection from other concurrent agents. Format: `deep-TASKNAME` where TASKNAME briefly describes the work.

```bash
# Examples of good session names:
veda -S deep-cache-design ...     # Deep thinking about cache design
veda -S deep-auth-strategy ...    # Deep thinking about auth strategy
veda -S deep-api-versioning ...   # Deep thinking about API versioning
```

---

## Setting Context

Build context with `veda sel add` before running deep mode. The context is passed to all solvers.

**Always start by selecting full files.** Check token count with `sel ls`. The 80k-100k range is acceptable; ~80k is ideal. Deep mode runs multiple solvers, so large context multiplies cost.

```bash
# Clear and build selection (use your session name)
veda -S deep-cache-design sel clear
veda -S deep-cache-design sel add "src/feature/" "src/shared/"

# Check token count
veda -S deep-cache-design sel ls
```

### File Slices

**Only use slices if you exceed ~100k tokens.** When paring down, target ~80k tokens.

```bash
# Selection-based slices
veda -S deep-cache-design sel add main.c:10-50       # Lines 10-50
veda -S deep-cache-design sel add main.c:100-        # Line 100 to end of file
veda -S deep-cache-design sel add "src/*.ts:1-100"   # First 100 lines of each

# Ad-hoc file slices (doesn't modify selection)
veda -S deep-cache-design deep -f src/auth.ts:50-150 -f src/models/user.ts:1-80 "What's the best approach?"
```

| Syntax | Description |
|--------|-------------|
| `file.c:10-20` | Lines 10 to 20 (inclusive) |
| `file.c:15-` | Line 15 to end of file |
| `file.c:8` | Single line 8 |
| `"src/*.c:1-50"` | First 50 lines of each matched file |

### Ad-hoc Files

Provide files directly without affecting selection:

```bash
veda deep -f src/api/auth.ts -f src/models/user.ts "What's the best approach?"
veda deep -f large_file.c:100-200 "Review this function"  # Slices work here too
```

---

## Using Deep Mode

### Basic Usage

**Always use `--trace` to save the full pipeline execution for review:**

```bash
# Simple deep thinking (4 solvers, verification enabled)
veda -S deep-auth-strategy deep --trace /tmp/deep-trace.yaml "What's the best way to handle authentication in this app?"

# More solvers for complex questions
veda -S deep-cache-design deep --trace /tmp/deep-trace.yaml -k 5 "Design a caching layer for this API"

# Distribute solvers across multiple backends (for diversity across providers)
veda -S deep-architecture deep --trace /tmp/deep-trace.yaml -k 6 --distribute-solvers "Compare microservices vs monolith for this app"
veda -S deep-architecture deep --trace /tmp/deep-trace.yaml -k 6 --distribute-solvers --solver-backends claude-code,gemini-cli,codex "Custom backends"

# Skip verification for faster results
veda -S deep-api-design deep --trace /tmp/deep-trace.yaml --no-verify "Compare REST vs GraphQL for this use case"
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--trace file` | Save full trace to YAML file (recommended: always use) | none |
| `-k N` | Number of parallel solvers | 4 |
| `--distribute-solvers` | Distribute solvers evenly across backends (round-robin) | single backend |
| `--solver-backends LIST` | Comma-separated backends for `--distribute-solvers` | all available |
| `--solver-backend NAME` | Force all solvers to use this backend | base backend |
| `--categories` | Reasoning categories to use (comma-separated) | random sampling |
| `--modules` | Module specifiers (prefer `category/module_id` format) | none |
| `--no-verify` | Skip Chain-of-Verification | verification enabled |
| `-f file` | Add ad-hoc context file(s) | none |
| `--json` | Output structured JSON result | text output |
| `-o file` | Save response to file | stdout |

### Per-Stage Reasoning

Control reasoning level per stage (minimal, low, medium, high, xhigh):

| Flag | Description | Default |
|------|-------------|---------|
| `--solver-reasoning LEVEL` | Reasoning for solvers | medium |
| `--judge-reasoning LEVEL` | Reasoning for judge | medium |
| `--verifier-reasoning LEVEL` | Reasoning for verifier | high |
| `--revision-reasoning LEVEL` | Reasoning for revision | verifier value |

```bash
# High reasoning for solvers on critical decisions
veda deep --solver-reasoning high "Critical architecture decision"

# Use xhigh for all verification stages
veda deep --verifier-reasoning xhigh "Need thorough fact-checking"

# Mix: fast solvers, careful verification
veda deep --solver-reasoning low --verifier-reasoning xhigh "Quick candidates, careful check"
```

**Config file support:** Set defaults via `DEEP_SOLVER_REASONING`, `DEEP_JUDGE_REASONING`, `DEEP_VERIFIER_REASONING`, `DEEP_REVISION_REASONING` in `~/.config/veda/config`.

---

## Reasoning Categories

Deep mode uses **SELF-DISCOVER reasoning modules** to create cognitive diversity across solvers. Each solver gets a different reasoning approach. Modules are sourced from Polya's "How to Solve It", Hamming's "Art of Doing Science and Engineering", McKinsey problem-solving frameworks, Fermi estimation, TRIZ inventive principles, Meadows' leverage points, and Klein's premortem.

**9 categories, 44 total modules (2-7 per category):**

| Category | Best For | Modules |
|----------|----------|---------|
| `analytical` | Breaking down problems, finding root causes | critical_thinking, assumption_analysis, causal_analysis, so_what_test, eighty_twenty_focus, limiting_case |
| `creative` | Novel solutions, unconventional approaches | creative_thinking, novel_solution, radical_rethinking, alternative_perspectives, invert_the_problem, thought_experiment |
| `systematic` | Structured problem-solving, decomposition | mece_decomposition, issue_tree, vary_the_problem, systems_thinking, working_backward, leverage_points, simplify_the_problem |
| `strategic` | Planning, iterating, forecasting | hypothesis_first, analogical_transfer, iterative_solving, solution_modification, planning, contradiction_resolution, scenario_planning |
| `evaluative` | Risk assessment, tradeoff analysis | risk_assessment, tradeoff_analysis, check_completeness, long_term_implications, premortem |
| `contextual` | Understanding constraints, stakeholders | stakeholder_analysis, resource_constraints, behavioral_factors |
| `empirical` | Evidence-based validation, testing | experimental_design, historical_analysis, data_driven, fermi_estimation, sanity_check |
| `debugging` | Code-specific debugging techniques | binary_search_debug, print_debugging |
| `reflective` | Meta-cognition, success criteria | reflective_thinking, success_criteria, decision_under_uncertainty |

### Choosing Categories

Match categories to your question type:

```bash
# Architecture decision → analytical + evaluative
veda deep --categories analytical,evaluative "Should we use microservices?"

# Creative brainstorming → creative + strategic
veda deep --categories creative,strategic "What are novel approaches to caching?"

# Risk analysis → evaluative + contextual
veda deep --categories evaluative,contextual "What could go wrong with this migration?"

# Implementation planning → systematic + strategic
veda deep --categories systematic,strategic "How should we implement this feature?"

# Default (no --categories) → random sampling across all categories
veda deep "General question"
```

### Using Module Specifiers

For fine-grained control, use the `--modules` flag. **Always use `category/module_id` format** so the LLM can choose the modules best suited to the problem:

| Format | Example | Behavior |
|--------|---------|----------|
| `category/module_id` | `analytical/so_what_test` | Exact module from category **(preferred)** |
| `category` | `analytical` | Random module from category |
| `module_id` | `so_what_test` | Exact module by ID (legacy, avoid) |

```bash
# Architecture decision → analytical + evaluative modules
veda deep --modules analytical/assumption_analysis,evaluative/risk_assessment,strategic/hypothesis_first "Should we use microservices?"

# Debugging → empirical + systematic modules  
veda deep --modules empirical/binary_search_debug,systematic/simplify_the_problem,analytical/causal_analysis "Why is this failing?"

# Design tradeoffs → evaluative + strategic modules
veda deep --modules evaluative/tradeoff_analysis,strategic/contradiction_resolution,systematic/mece_decomposition "REST vs GraphQL?"

# Creative exploration → creative + reflective modules
veda deep --modules creative/invert_the_problem,creative/thought_experiment,reflective/decision_under_uncertainty "Novel caching approaches?"
```

**Note:** Each module must be from a different category (max 8 modules, one per category).

**Output shows selected modules:**
```
▸ solve ─────────────────────────────────────────────────────────────────────────
  [solver-1:codex:gpt-5.2:analytical/so_what_test] → shell: rg -n "test"
  [solver-1:codex:gpt-5.2:analytical/so_what_test] → done (683 out)
  [solver-2:codex:gpt-5.2:creative/invert_the_problem] → done (512 out)
```

### How It Works

1. **Parallel Solving**: N solvers generate independent answers using prompt diversity
2. **Judge Aggregation**: A judge LLM evaluates all candidates and selects/synthesizes the best answer with a confidence level (low/medium/high)
3. **Verification Gate**: Verification triggers when judge confidence < 70% (i.e., low or medium confidence)
4. **Chain-of-Verification**: If triggered, generates verification questions, answers them independently, and revises the answer if contradictions are found

---

## Example Workflow

```bash
# 1. Build context (use a descriptive session name)
veda -S deep-realtime-notif sel clear
veda -S deep-realtime-notif sel add "src/api/" "src/models/" "src/config/"
veda -S deep-realtime-notif sel ls

# 2. Ask a complex design question (always trace to /tmp)
veda -S deep-realtime-notif deep --trace /tmp/deep-trace.yaml "Given this codebase, what's the best strategy for adding real-time notifications? Consider: scalability, complexity, and integration with existing code."

# 3. Review trace if needed
cat /tmp/deep-trace.yaml
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
veda -S deep-cache-design deep --json "..." | jq '.answer'
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
- `veda -S deep-TASKNAME sel add` to build context
- `veda -S deep-TASKNAME sel ls` to check token count
- `veda -S deep-TASKNAME deep --trace /tmp/deep-trace.yaml "question"` for deep thinking
- `veda -S deep-TASKNAME deep --trace /tmp/deep-trace.yaml -k 5 "question"` for more solvers
- `veda -S deep-TASKNAME deep --trace /tmp/deep-trace.yaml --no-verify "question"` for faster results
- `cat /tmp/deep-trace.yaml` to review full pipeline execution

**Use a descriptive session name** (e.g., `deep-cache-design`) to keep selections organized.

**Note:** Deep mode supports `resume` for follow-up questions. Each run preserves conversation history. Always use `--trace` for reviewability.
