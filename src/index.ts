#!/usr/bin/env bun
/**
 * veda - AI CLI wrapper with multi-backend support
 * 
 * Uses "parse, don't validate" approach - invalid states are caught at parse time.
 */

import { parseAndValidate, CliValidationError } from './cli/index';
import { simpleConfigToCliOptions, deepConfigToCliOptions, resumeConfigToCliOptions } from './cli/adapter';
import { showHelp, showVersion } from './cli';
import { handleSel, handlePersonas, handleRun, handleResume, handleInit, handleDeep } from './commands';
import { readStdin } from './util/stdin';

async function main(): Promise<void> {
  try {
    const input = await parseAndValidate(process.argv);

    // Handle meta commands
    switch (input.command) {
      case 'help':
        showHelp();
        return;

      case 'version':
        showVersion();
        return;

      case 'init':
        await handleInit({ session: 'default' } as any);
        return;

      case 'personas':
        await handlePersonas(input.subcommand, [], { session: 'default' } as any);
        return;

      case 'sel':
        await handleSel(input.subcommand, input.args, { session: input.session } as any);
        return;

      case 'dry-run':
        console.log(JSON.stringify(input.resolved, null, 2));
        return;

      case 'resume': {
        // Read stdin for resume command
        const stdin = await readStdin();
        let prompt = input.config.prompt;
        if (stdin) {
          prompt = prompt ? `${prompt}\n\n${stdin}` : stdin;
        }

        const options = resumeConfigToCliOptions(input.config);
        await handleResume(prompt, options);
        return;
      }

      case 'prompt': {
        // Read stdin for prompt commands
        const stdin = await readStdin();
        
        if (input.mode === 'deep') {
          let prompt = input.config.prompt;
          if (stdin) {
            prompt = `${prompt}\n\n${stdin}`;
          }

          const options = deepConfigToCliOptions(input.config);
          await handleDeep(prompt, options);
        } else {
          let prompt = input.config.prompt;
          if (stdin) {
            prompt = `${prompt}\n\n${stdin}`;
          }

          const options = simpleConfigToCliOptions(input.config);
          await handleRun(prompt, options);
        }
        return;
      }
    }
  } catch (error) {
    if (error instanceof CliValidationError) {
      console.error(`Error: ${error.message}`);
      if (error.suggestion) {
        console.error(`Hint: ${error.suggestion}`);
      }
      process.exit(1);
    }
    
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unexpected error occurred');
    }
    process.exit(1);
  }
}

main();
