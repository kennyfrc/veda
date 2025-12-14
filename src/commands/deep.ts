/**
 * Deep thinking mode command.
 */

import { ContextStore } from '../context';
import { runDeepThink, type DeepThinkEvent } from '../pipelines';
import type { CliOptions } from '../cli';

export async function handleDeep(
  prompt: string,
  options: CliOptions
): Promise<void> {
  // Build context from selection (unless --no-sel)
  let context: string | undefined;
  if (!options.noSel) {
    const contextStore = new ContextStore({ sessionId: options.session });
    const entries = await contextStore.list();
    
    if (entries.length > 0) {
      context = await buildContext(contextStore);
    }
  }
  
  // Add ad-hoc files if provided
  if (options.files && options.files.length > 0) {
    const adhocContext = await buildAdhocContext(options.files);
    context = context ? `${context}\n\n${adhocContext}` : adhocContext;
  }
  
  console.error('[deep] Starting deep thinking mode...\n');
  
  // Run the pipeline
  for await (const event of runDeepThink(prompt, {
    k: options.k,
    verify: !options.noVerify,
    context,
  })) {
    handleEvent(event, options);
  }
}

function handleEvent(event: DeepThinkEvent, options: CliOptions): void {
  switch (event.type) {
    case 'stage_start':
      console.error(`[${event.stage}] Starting...`);
      break;
    
    case 'candidate':
      console.error(`  ${event.content}`);
      break;
    
    case 'selected':
      console.error(`\n[${event.stage}] Selected answer (confidence: ${((event.confidence ?? 0) * 100).toFixed(0)}%)`);
      break;
    
    case 'stage_complete':
      if (event.usage) {
        console.error(`[${event.stage}] Complete (${event.usage.inputTokens + event.usage.outputTokens} tokens)`);
      } else {
        console.error(`[${event.stage}] Complete`);
      }
      break;
    
    case 'verified':
      console.error(`[verify] ${event.content}`);
      break;
    
    case 'complete':
      if (event.result) {
        console.error(`\n[complete] Stages: ${event.result.stages.join(' → ')}`);
        console.error(`[complete] Confidence: ${(event.result.confidence * 100).toFixed(0)}%`);
        if (event.result.wasRevised) {
          console.error('[complete] Answer was revised by verification');
        }
        console.error(`[complete] Total tokens: ${event.result.usage.inputTokens + event.result.usage.outputTokens}`);
        console.error('');
        
        // Output final answer
        if (options.output) {
          Bun.write(options.output, event.result.answer);
          console.error(`Response saved to ${options.output}`);
        } else if (options.json) {
          console.log(JSON.stringify(event.result, null, 2));
        } else {
          console.log(event.result.answer);
        }
      }
      break;
  }
}

async function buildContext(store: ContextStore): Promise<string> {
  const entries = await store.list();
  const parts: string[] = [];
  
  for (const entry of entries) {
    try {
      const file = Bun.file(entry.absolutePath);
      if (await file.exists()) {
        let content = await file.text();
        
        if (entry.slice.hasSlice) {
          const lines = content.split('\n');
          const start = (entry.slice.start ?? 1) - 1;
          const end = entry.slice.end ?? lines.length;
          content = lines.slice(start, end).join('\n');
        }
        
        parts.push(`## ${entry.original}\n\`\`\`\n${content}\n\`\`\``);
      }
    } catch {
      // Skip files that can't be read
    }
  }
  
  return parts.join('\n\n');
}

async function buildAdhocContext(files: string[]): Promise<string> {
  const parts: string[] = [];
  
  for (const path of files) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        const content = await file.text();
        parts.push(`## ${path}\n\`\`\`\n${content}\n\`\`\``);
      }
    } catch {
      // Skip files that can't be read
    }
  }
  
  return parts.join('\n\n');
}
