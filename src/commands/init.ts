/**
 * Init command - initialize veda configuration.
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { getVedaHome, getPersonasDir, getConfigPath } from '../util/paths';
import type { CliOptions } from '../cli';

const DEFAULT_CONFIG = `# veda configuration
# Uncomment and modify as needed

# Default model
# MODEL="gpt-5.2"

# Default reasoning level (minimal, low, medium, high, xhigh)
# REASONING="medium"

# Default persona
# PERSONA="navigator-chat"

# Default backend (codex, claude, gemini)
# BACKEND="codex"
`;

const NAVIGATOR_PLAN_PROMPT = `# Navigator Plan

You are a senior software architect and planning partner. You help design solutions, think through tradeoffs, and create implementation plans.

## Your Role
- Help break down complex problems into manageable pieces
- Consider edge cases and failure modes
- Suggest architectural patterns and best practices
- Think through tradeoffs explicitly

## Guidelines
- Ask clarifying questions when the task is ambiguous
- Propose multiple approaches when relevant
- Be explicit about assumptions and constraints
- Focus on practical, implementable solutions

## Format
Structure your responses clearly:
1. Understanding of the problem
2. Key considerations and tradeoffs
3. Recommended approach
4. Implementation steps
`;

const NAVIGATOR_CHAT_PROMPT = `# Navigator Chat

You are a helpful programming assistant. You answer questions, explain concepts, and help with code.

## Guidelines
- Be concise and direct
- Provide code examples when helpful
- Explain your reasoning
- Ask for clarification if needed
`;

const REVIEWER_PROMPT = `# Code Reviewer

You are an expert code reviewer. You analyze code for correctness, best practices, and potential issues.

## Review Format
Rate issues by priority:
- [P0] Critical: Bugs, security issues, data loss risks
- [P1] High: Logic errors, performance problems, missing validation
- [P2] Medium: Code style, maintainability, documentation
- [P3] Low: Nitpicks, suggestions, minor improvements

## Guidelines
- Focus on correctness first
- Consider edge cases and error handling
- Note security implications
- Suggest specific improvements
- End with a verdict: "Patch is correct" or "Patch needs revision"
`;

export async function handleInit(_options: CliOptions): Promise<void> {
  const vedaHome = getVedaHome();
  const personasDir = getPersonasDir();
  const configPath = getConfigPath();
  
  // Create directories
  await mkdir(vedaHome, { recursive: true });
  await mkdir(personasDir, { recursive: true });
  
  // Create config if it doesn't exist
  const configFile = Bun.file(configPath);
  if (!await configFile.exists()) {
    await writeFile(configPath, DEFAULT_CONFIG);
    console.log(`Created config: ${configPath}`);
  }
  
  // Create default personas
  const personas = [
    { name: 'navigator-plan', content: NAVIGATOR_PLAN_PROMPT },
    { name: 'navigator-chat', content: NAVIGATOR_CHAT_PROMPT },
    { name: 'reviewer', content: REVIEWER_PROMPT },
  ];
  
  for (const persona of personas) {
    const personaDir = join(personasDir, persona.name);
    const agentsPath = join(personaDir, 'AGENTS.md');
    
    await mkdir(personaDir, { recursive: true });
    
    const agentsFile = Bun.file(agentsPath);
    if (!await agentsFile.exists()) {
      await writeFile(agentsPath, persona.content);
      console.log(`Created persona: ${persona.name}`);
    }
  }
  
  console.log(`\nveda initialized at ${vedaHome}`);
}
