#!/usr/bin/env bun
/**
 * veda - AI CLI wrapper with multi-backend support
 *
 * Entry point for the CLI application.
 */

import { parseArgs, showHelp, showVersion } from './cli';
import { handleSel, handlePersonas, handleRun, handleResume, handleInit, handleDeep } from './commands';
import { readStdin } from './util/stdin';

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv);

    // Handle help and version first
    if (parsed.options.help) {
      showHelp();
      return;
    }

    if (parsed.options.version) {
      showVersion();
      return;
    }

    // Read stdin and merge into prompt if available
    // Only read stdin for commands that use prompts (prompt, deep, resume)
    // to avoid blocking/hanging for non-prompt commands (sel, personas, init)
    const stdin = (parsed.command === 'prompt' || parsed.command === 'deep' || parsed.command === 'resume')
      ? await readStdin()
      : undefined;

    if (stdin) {
      if (parsed.prompt) {
        // If prompt exists, treat stdin as context (appended after prompt)
        parsed.prompt = `${parsed.prompt}\n\n${stdin}`;
      } else {
        // If no prompt, treat stdin as the prompt itself
        parsed.prompt = stdin;
      }
    }

    // Dispatch to command handlers
    switch (parsed.command) {
      case 'sel':
      case 'selection':
        await handleSel(parsed.subcommand, parsed.args, parsed.options);
        break;

      case 'personas':
        await handlePersonas(parsed.subcommand, parsed.args, parsed.options);
        break;

      case 'resume':
        await handleResume(parsed.prompt, parsed.options);
        break;
      
      case 'init':
        await handleInit(parsed.options);
        break;
      
      case 'deep':
        if (!parsed.prompt) {
          console.error('Usage: veda deep <prompt>');
          process.exit(1);
        }
        await handleDeep(parsed.prompt, parsed.options);
        break;
      
      case 'prompt':
      default:
        if (!parsed.prompt) {
          showHelp();
          process.exit(1);
        }
        // Check if --deep flag was set
        if (parsed.options.deep) {
          await handleDeep(parsed.prompt, parsed.options);
        } else {
          await handleRun(parsed.prompt, parsed.options);
        }
        break;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unexpected error occurred');
    }
    process.exit(1);
  }
}

main();
