/**
 * Personas command.
 */

import { listPersonas } from '../agent';
import type { CliOptions } from '../cli';

export async function handlePersonas(
  subcommand: string | undefined,
  args: string[],
  options: CliOptions
): Promise<void> {
  // For now, just list personas
  const personas = await listPersonas();
  
  if (personas.length === 0) {
    console.log('No personas found. Run "veda init" to create default personas.');
  } else {
    console.log('Available personas:');
    for (const name of personas) {
      console.log(`  ${name}`);
    }
  }
}
