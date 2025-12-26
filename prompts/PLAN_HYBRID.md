## Navigator-Chat + Deep Mode: Stepwise Refinement

> **Your Role**: You are the **Driver** (implementor) running Stepwise Refinement. You have file editing tools and will implement the solution. You pause at checkpoints to consult **Navigator-Chat** (for design validation) and **Deep Mode** (for complex planning questions).
>
> **Navigator-Chat's Role**: A senior architect without file editing tools who reviews your design, validates assumptions, surfaces tradeoffs, and guides your implementation. Think of them as a paired programming partner.
>
> **Deep Mode's Role**: High-quality, verified answers for complex planning questions. Uses multiple solvers in parallel, aggregates with a judge, and optionally verifies/revises.

---

## Your Workflow

1. **Phase 1**: Problem & Data Architecture → consult **navigator-chat** for validation
2. **Phase 2**: Stepwise Refinement → use **deep mode** for complex design decisions
3. **Phase 3**: Implementation & Verification → implement and optionally consult **navigator-chat** for final review

---

## Setting Context

Both navigator-chat and deep mode use `veda sel add` for context. Build context before each consultation.

```bash
# Clear and build selection (use a descriptive session name)
veda -S refine-FEATURE sel clear
veda -S refine-FEATURE sel add "src/feature/" "src/shared/utils.ts"

# Check token count
veda -S refine-FEATURE sel ls
```

### Token Budget Guidelines

| Budget | When to Use |
|--------|-------------|
| **~80k tokens (ideal)** | Most consultations—enough context for deep analysis |
| **~100k tokens (max)** | Complex architectural decisions, cross-cutting concerns |
| **Full files first** | Always start with full files, slice only when necessary |

**Only use slices if you exceed ~100k tokens:**

```bash
# Select specific line ranges (only when over budget)
veda -S refine-FEATURE sel add main.c:10-50       # Lines 10-50 only
veda -S refine-FEATURE sel add main.c:100-        # Line 100 to end of file
veda -S refine-FEATURE sel add config.ts:25       # Single line 25
veda -S refine-FEATURE sel add "src/*.c:1-80"     # First 80 lines of each .c file
```

| Syntax | Description |
|--------|-------------|
| `file.c:10-20` | Lines 10 to 20 (inclusive) |
| `file.c:15-` | Line 15 to end of file |
| `file.c:8` | Single line 8 |
| `"src/*.c:1-50"` | First 50 lines of each matched file |

### Session Naming

Use `refine-FEATURE` format to isolate your selection from other concurrent agents:

```bash
veda -S refine-auth-flow ...     # Refining auth flow
veda -S refine-cache-layer ...   # Refining cache implementation
veda -S refine-api-redesign ...  # Refining API redesign
```

---

## Stepwise Refinement Process

### Phase 1: Problem & Data Architecture

**Step 1: Problem Statement (The "What")**
Define the problem as a pure data transformation.
- **Input:** What data enters the system?
- **Output:** What is the final state/result?
- **Operations:** List what the system does (verbs) before designing structures (nouns). Let operation clusters hint at module boundaries.
- **Constraint:** Do not mention specific programming languages, libraries, or platform-specific APIs.

**Step 2: Data Architecture (The "Shape of Truth")**
Design the data representations before refining instructions. For each data structure:
- **Rationale:** Why this representation? Center each module around one primary struct.
- **Invariant:** What must always be true? Avoid booleans for domain meaning—use enums or structured data that prevents impossible states.
- **Evolution:** How might requirements grow? Structure data so changes add fields or filters, not rewrites.
- **State & Time:** If the structure mutates, how will you log changes? What is derived vs. stored?

**[CHECKPOINT: CONSULT NAVIGATOR-CHAT]**

Before proceeding, consult navigator-chat for design validation:

```bash
# Build context for navigator-chat
veda -S refine-FEATURE sel clear
veda -S refine-FEATURE sel add "relevant/source/files"
veda -S refine-FEATURE sel ls

# Send your design for validation
veda -S refine-FEATURE -p navigator-chat '## Phase 1 Complete

### Problem Statement
- **Input:** [what enters the system]
- **Output:** [what results]
- **Operations:** [verbs the system performs, grouped by module]
- **Constraints:** [key constraints]

### Data Architecture
**Structure: PrimaryEntity**
- **Rationale:** [why this representation]
- **Invariant:** [always-true rule, using enums not booleans]
- **Evolution:** [how requirements might grow]
- **State & Time:** [derived vs stored, mutation logging]

### Questions
1. Does this problem statement capture the core transformation correctly?
2. Does the data architecture prevent impossible states?
3. Are there edge cases in input/output I should consider?
4. Should I proceed to Phase 2?'

# Continue the same consultation (session-scoped)
veda -S refine-FEATURE resume "Follow-up question based on Navigator's feedback"
```

---

### Phase 2: Stepwise Refinement (Deep Mode)

**Step 3: Stepwise Refinement (The "How")**
Develop the program through a sequence of refinement steps. In each step:

1. **Write usage first** — express how the caller invokes the current instruction before refining its internals.
2. **Refine one instruction** — decompose it into sub-instructions or express it in terms closer to the target language.
3. **Design caller interfaces** — as you refine, decide: Who owns state? Does the caller choose control flow? Is this crossing a serialization boundary (if so, defunctionalize—encode callbacks as data)?
4. **Document the design decision** — note alternatives considered and why this choice was made.

Label each instruction as:
- **[Instruction]** — abstract, to be refined further
- **[Primitive]** — terminal, directly expressible in the target language

Continue until all instructions are primitives. Inline logic until duplication appears—extract only when two sites need the same semantics.

**[CHECKPOINT: USE DEEP MODE FOR COMPLEX DECISIONS]**

Use deep mode for complex design questions that benefit from multiple perspectives:

```bash
# Build context for deep mode
veda -S refine-FEATURE sel clear
veda -S refine-FEATURE sel add "relevant/design/files"
veda -S refine-FEATURE sel ls

# Ask complex design questions with deep mode
veda -S refine-FEATURE deep --trace /tmp/deep-trace.yaml '## Phase 2: Stepwise Refinement

Given the codebase context, help me refine this design:

### Current Refinement Hierarchy
**[Instruction] ProcessData** (caller usage: `result = ProcessData(input)`)
  └─ **[Instruction] ValidateInput** (caller usage: `validated = ValidateInput(raw)`)
       └─ **[Primitive]** CheckRequiredFields
       └─ **[Primitive]** NormalizeFormat
  └─ **[Instruction] Transform** (caller usage: `transformed = Transform(validated)`)
       └─ [needs refinement]
  └─ **[Primitive]** SerializeOutput

### Design Questions
1. What is the best approach for the Transform step given the existing codebase patterns?
2. Should state be owned by the caller or the Transform function?
3. Are there serialization boundaries that require defunctionalization?
4. What are the tradeoffs between [Alternative A] vs [Alternative B]?'

# Review trace if needed
cat /tmp/deep-trace.yaml

# For follow-up questions, use resume
veda -S refine-FEATURE resume "Can you elaborate on the state ownership recommendation?"
```

**When to use deep mode in Phase 2:**
- Architecture decisions with multiple valid approaches
- Design tradeoffs that need analysis from multiple perspectives
- Complex interface design questions
- Risk/impact assessment of design choices

**Deep mode options for design questions:**

```bash
# More solvers for critical decisions
veda -S refine-FEATURE deep --trace /tmp/deep-trace.yaml -k 5 "Design question..."

# Focus on specific reasoning categories
veda -S refine-FEATURE deep --trace /tmp/deep-trace.yaml --categories analytical,evaluative "Should we use approach A or B?"
veda -S refine-FEATURE deep --trace /tmp/deep-trace.yaml --categories systematic,strategic "How should we structure this module?"

# Skip verification for faster iteration
veda -S refine-FEATURE deep --trace /tmp/deep-trace.yaml --no-verify "Quick design question..."
```

| Category | Best For |
|----------|----------|
| `analytical` | Breaking down problems, finding root causes |
| `creative` | Novel solutions, unconventional approaches |
| `systematic` | Structured problem-solving, step-by-step |
| `strategic` | Planning, iterating on solutions |
| `evaluative` | Risk assessment, tradeoff analysis |
| `contextual` | Understanding constraints, stakeholders |
| `empirical` | Evidence-based validation, testing |
| `reflective` | Meta-cognition, success criteria |

---

### Phase 3: Implementation & Verification

**Step 4: Concrete Implementation (The "Code")**
Translate the refined logic into final code. This must be a **literal translation of the primitives from Step 3**.

**Step 5: Verification (The "Self-Audit")**
1. **Trace boundary transformations** — For each primitive that transforms data (parsing, pattern matching, serialization), write the concrete input → expected output. Execute these micro-examples *before* integrating into the larger system.
2. **Generate failure hypotheses** — Target likely-failure points: edge cases, invariant violations, impossible states, and behavioral issues. For operations involving string patterns, escaping, or special characters, explicitly test the pattern against literal example inputs.
3. **Verify intermediate outputs first** — Before testing end-to-end behavior, confirm each phase produces the expected intermediate data structure. A passing integration test can hide broken internals that surface later.
4. **Answer hypotheses with executable checks** — Don't rationalize the implementation. Run verification code that inspects actual outputs, not code structure. **Prefer headless/terminal-based verification (e.g., Node with jsdom over browser, CLI over GUI) so tests execute immediately without manual intervention.**
5. **Revise implementation based on findings** — Fail fast with clear diagnostics beside each invariant.

**[CHECKPOINT: CONSULT NAVIGATOR-CHAT (OPTIONAL)]**

If verification uncovers issues or you'd like a final review:

```bash
# Build context for navigator-chat
veda -S refine-FEATURE sel clear
veda -S refine-FEATURE sel add "implemented/files" "tests/"
veda -S refine-FEATURE sel ls

# Request final review
veda -S refine-FEATURE -p navigator-chat '## Implementation Complete

### Boundary Transformation Traces
- `parseInput("raw string")` → `{ field: "value" }`
- `serializeOutput(data)` → `"expected output"`

### Failure Hypotheses Tested
| Hypothesis | Test | Result |
|------------|------|--------|
| Empty input crashes | `ProcessData("")` | ✓ Returns error enum |
| Special chars in pattern | `match("a\*b")` | ✓ Escaped correctly |

### Verification Results
- [Summary of what was tested]
- [Issues found and fixed]
- [Remaining concerns]

### Questions
1. Does the implementation correctly translate the primitives?
2. Are there any remaining risks or issues?
3. Is the work complete?'
```

---

## When to Use Which Tool

| Situation | Tool | Why |
|-----------|------|-----|
| Design validation, quick feedback | `navigator-chat` | Fast, conversational |
| Complex design decisions | `deep` | Multiple perspectives, verified |
| Tradeoff analysis | `deep --categories evaluative` | Systematic evaluation |
| Architecture questions | `deep --categories analytical,evaluative` | Deep analysis |
| Implementation questions | `navigator-chat` | Quick back-and-forth |
| Final review | `navigator-chat` | Conversational validation |

---

## Key Reminders

1. **Navigator-chat has no file access**—always set context with `veda sel add` first
2. **Deep mode multiplies context cost**—keep selection lean (~80k tokens ideal)
3. **Always use `--trace`** with deep mode for reviewability
4. **Be specific in questions**—ask about tradeoffs, assumptions, and edge cases
5. **Incorporate feedback**—revise your design before proceeding
6. **Operations before structures**—list verbs before designing nouns
7. **Trace boundaries**—test transformations with concrete input → output before integration

---

## Command Reference

| Command | Purpose |
|---------|---------|
| `veda -S refine-FEATURE sel clear` | Clear current selection |
| `veda -S refine-FEATURE sel add "path/"` | Add files to selection (use quotes for globs) |
| `veda -S refine-FEATURE sel ls` | Check selection and token count |
| `veda -S refine-FEATURE -p navigator-chat "prompt"` | Consult navigator-chat (design validation) |
| `veda -S refine-FEATURE deep --trace /tmp/deep-trace.yaml "prompt"` | Deep mode (complex decisions) |
| `veda -S refine-FEATURE resume "follow-up"` | Continue the same conversation |
| `cat /tmp/deep-trace.yaml` | Review deep mode trace |

**Use a descriptive session name** (e.g., `refine-auth-flow`) to keep selections organized across phases.
