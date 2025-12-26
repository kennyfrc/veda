## Your Task

Please collaborate, discuss, align, and implement with the Navigator model on the plan, using `veda -S impl-TASKNAME -p navigator-plan`. Navigator has no access to tool calls, therefore you need to provide extensive context through `veda sel add`. Always start with full files. The 80k-100k token range is acceptable; ~80k is ideal. Only use slices if you exceed 100k tokens. Use `-p navigator-plan` to start, then switch to `-p navigator-chat` if you'd like to discuss further. Only use `navigator-plan` once or unless the user instructs you to do so.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains code examples with backticks, they will be executed as commands:

```bash
# BAD - double quotes evaluate backticks:
veda -p navigator-plan "The function uses `console.log`"
# Results in: sh: console.log: command not found

# GOOD - use single quotes (simplest):
veda -S impl-auth-feature -p navigator-plan 'The function uses `console.log` to output.'

# GOOD - escape backticks in double quotes:
veda -p navigator-plan "The function uses \`console.log\`"
```

**Recommendation:** Use single quotes (`'...'`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes. 


## Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with `-S` to isolate your selection from other concurrent agents. Format: `impl-TASKNAME` where TASKNAME briefly describes the work.

```bash
# Examples of good session names:
veda -S impl-auth-feature ...     # Implementing auth feature
veda -S impl-cache-layer ...      # Implementing cache layer
veda -S impl-api-refactor ...     # Implementing API refactor
```

---

## Setting Context (Critical)

**You must run `veda sel add` before sending prompts**—this is how you provide files for Navigator/Reviewer to see. They have no other way to access code.

```bash
# Clear and build selection (use your session name)
veda -S impl-auth-feature sel clear
veda -S impl-auth-feature sel add "src/feature/" "src/shared/utils.ts"

# Check token count
veda -S impl-auth-feature sel ls
veda -S impl-auth-feature sel tokens  # Just the total
```

**Always start by selecting full files.** Check token count with `sel ls` or `sel tokens`. The 80k-100k range is acceptable; ~80k is ideal.

### File Slices (Line Ranges)

**Only use slices if you exceed ~100k tokens.** When paring down, target ~80k tokens.

```bash
# Select specific line ranges (only when over budget)
veda -S impl-auth-feature sel add main.ts:10-50       # Lines 10-50 only
veda -S impl-auth-feature sel add main.ts:100-        # Line 100 to end of file
veda -S impl-auth-feature sel add config.ts:25       # Single line 25
veda -S impl-auth-feature sel add "src/*.ts:1-80"     # First 80 lines of each .ts file
```

| Syntax | Description |
|--------|-------------|
| `file.ts:10-20` | Lines 10 to 20 (inclusive) |
| `file.ts:15-` | Line 15 to end of file |
| `file.ts:8` | Single line 8 |
| `"src/*.ts:1-50"` | First 50 lines of each matched file |

**Selection strategy:**
1. Start with full files—always
2. Check `sel ls` for token count
3. If under 100k tokens → you're done, full files are fine
4. If over 100k tokens → pare down to ~80k using slices on the largest files

Prefer full files when possible—more context is better for Navigator.

---

## Collaborating with Navigator

Use `veda -S impl-TASKNAME -p navigator-plan` to start planning, then `veda -S impl-TASKNAME -p navigator-chat` for follow-up discussion.

Think of Navigator as a senior engineer you're pairing with:
- Share your understanding and proposed approach
- Ask for input on tricky decisions
- Discuss tradeoffs and alternatives
- Confirm alignment before you start implementing

Example flow:
```bash
# 1. Set the context
veda -S impl-auth-feature sel clear
veda -S impl-auth-feature sel add "src/auth/" "src/api/users.ts"

# 2. Start planning conversation
veda -S impl-auth-feature -p navigator-plan "Here's my understanding of the task and proposed approach: [details]. What do you think?"

# 3. Continue discussion (session-scoped resume)
veda -S impl-auth-feature resume "What about edge case X?"
# Or switch to chat mode for back-and-forth
veda -S impl-auth-feature -p navigator-chat "What about edge case X?"
```

Use `veda -S impl-TASKNAME resume` to continue the same conversation, or start fresh with a new prompt.

**Once aligned, you (the Driver) proceed to implementation.** Navigator does not implement—you do.

---

## Implementation

After aligning with Navigator:
- Execute the plan using your native editing tools
- Validate as you go (check files, search for issues)
- You can consult Navigator mid-implementation if you hit unexpected questions:
  ```bash
  veda -S impl-auth-feature -p navigator-chat "Quick question: should X handle Y this way?"
  ```


## Reminders

Make sure to onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- `veda -S impl-TASKNAME sel add` to build context (quote globs: `"src/*.ts"`)
- `veda -S impl-TASKNAME sel add file.ts:10-50` to add specific line ranges (slices)
- `veda -S impl-TASKNAME sel ls` to verify selection and token count
- `veda -S impl-TASKNAME -p navigator-plan` for initial planning (xhigh reasoning)
- `veda -S impl-TASKNAME -p navigator-chat` for follow-up discussion (medium reasoning)
- `veda -S impl-TASKNAME resume` to continue a conversation (session-scoped)
- All personas run in read-only sandbox mode
- **Use a descriptive session name** (e.g., `impl-auth-feature`) to avoid conflicts with other agents

s

