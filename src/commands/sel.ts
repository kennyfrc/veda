/**
 * Selection commands: add, rm, ls, clear, tokens
 */

import { ContextStore } from '../context';
import type { CliOptions } from '../cli';

export async function handleSel(
  subcommand: string | undefined,
  args: string[],
  options: CliOptions
): Promise<void> {
  const store = new ContextStore({ sessionId: options.session });
  
  switch (subcommand) {
    case 'add': {
      if (args.length === 0) {
        console.error('Usage: veda sel add <files...>');
        process.exit(1);
      }
      const result = await store.add(args);
      console.log(`Added ${result.added} file(s), skipped ${result.skipped} duplicate(s)`);
      if (result.notFound.length > 0) {
        console.warn(`Not found: ${result.notFound.join(', ')}`);
      }
      break;
    }
    
    case 'rm':
    case 'remove': {
      if (args.length === 0) {
        console.error('Usage: veda sel rm <files...>');
        process.exit(1);
      }
      const result = await store.remove(args);
      console.log(`Removed ${result.removed} file(s)`);
      break;
    }
    
    case 'ls':
    case 'list': {
      const entries = await store.list();
      if (entries.length === 0) {
        console.log('Selection is empty');
      } else {
        const details = await store.tokenDetails();
        let total = 0;
        for (const info of details) {
          console.log(`${info.path} (${info.lines} lines, ~${info.tokens} tokens)`);
          total += info.tokens;
        }
        console.log(`\nTotal: ${entries.length} file(s), ~${total} tokens`);
      }
      break;
    }
    
    case 'clear': {
      await store.clear();
      console.log('Selection cleared');
      break;
    }
    
    case 'tokens': {
      const tokens = await store.tokens();
      console.log(`~${tokens} tokens`);
      break;
    }
    
    default:
      console.error('Usage: veda sel <add|rm|ls|clear|tokens> [args...]');
      process.exit(1);
  }
}
