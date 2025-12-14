#!/usr/bin/env bun
/**
 * veda - AI CLI wrapper with multi-backend support
 * 
 * Entry point for the CLI application.
 */

import { parseArgs, showHelp, showVersion } from './cli';
import { handleSel, handlePersonas, handleRun, handleResume, handleInit, handleDeep } from './commands';

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
