import { listPersonas, loadPersona, personaExists } from '../agent/persona';
import type { CliOptions } from '../cli';

export async function handlePersonas(
  subcommand: string | undefined,
  _args: string[],
  _options: CliOptions
): Promise<void> {
  // If a persona name is given, show its system prompt
  if (subcommand && subcommand !== 'list') {
    const exists = await personaExists(subcommand);
    if (!exists) {
      console.error(`Persona not found: ${subcommand}`);
      console.error('Run "veda personas" to list available personas.');
      process.exit(1);
    }
    const persona = await loadPersona(subcommand);
    console.log(`# Persona: ${persona.name}`);
    console.log(`# Path: ${persona.path}`);
    console.log(`# Default reasoning: ${persona.defaultReasoning}`);
    console.log('');
    console.log(persona.systemPrompt);
    return;
  }

  // List personas
  const personas = await listPersonas();

  if (personas.length === 0) {
    console.log('No personas found. Run "veda init" to create default personas.');
  } else {
    console.log('Available personas:');
    for (const name of personas) {
      const persona = await loadPersona(name);
      const desc = personaDescription(name);
      console.log(`  ${name.padEnd(20)} ${desc}  (reasoning: ${persona.defaultReasoning})`);
    }
    console.log('');
    console.log('Run "veda personas <name>" to view a persona\'s system prompt.');
  }
}

function personaDescription(name: string): string {
  switch (name) {
    case 'navigator-plan':
      return 'High-reasoning planning (use once per task)';
    case 'navigator-chat':
      return 'Medium-reasoning in-flight discussion';
    case 'navigator-plan-notools':
      return 'Planning mode, no tool access (context-only)';
    case 'navigator-chat-notools':
      return 'In-flight discussion, no tool access (context-only)';
    case 'reviewer':
      return 'Code review with [P0]-[P3] findings';
    default:
      return '';
  }
}
