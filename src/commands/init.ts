import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { getVedaHome, getPersonasDir, getConfigPath } from '../util/paths';
import { handleSkills } from './skills';
import { EMBEDDED_PERSONA_NAMES, readPersonaForInit } from '../agent/persona';
import { detectBackends, pickDefaultModel } from '../agent/detect';
import type { CliOptions } from '../cli';

const DEFAULT_CONFIG = `# veda configuration
# Uncomment and modify as needed

# Default model
# MODEL="gpt-5.2"

# Default reasoning level (minimal, low, medium, high, xhigh)
# REASONING="medium"

# Default persona
# PERSONA="navigator-chat"

# Default backend (codex, claude-code, droid, pi)
# BACKEND="codex"

# Notifications
# NOTIFY="true"
# NOTIFY_SOUND="Purr"  # macOS sound name, full path, or "none" to disable sound
`;

export async function handleInit(_options: CliOptions): Promise<void> {
  const vedaHome = getVedaHome();
  const personasDir = getPersonasDir();
  const configPath = getConfigPath();
  
  // Create directories
  await mkdir(vedaHome, { recursive: true });
  await mkdir(personasDir, { recursive: true });
  
  // Detect installed harnesses and pick a default model.
  const backends = detectBackends();
  const defaultModel = pickDefaultModel(backends);
  
  if (backends.length > 0) {
    console.log('Detected harnesses:');
    for (const b of backends) {
      const mark = b.name === defaultModel?.backend ? ' (default)' : '';
      console.log(`  ${b.command} → ${b.name}${mark}`);
    }
    if (defaultModel) {
      console.log(`\nDefault model: ${defaultModel.model} (via ${defaultModel.backend})`);
    }
  } else {
    console.log('No harness CLIs found on PATH. Install one of: codex, claude, droid, pi');
  }
  
  // Create config if it doesn't exist
  const configFile = Bun.file(configPath);
  if (!await configFile.exists()) {
    // If we detected a default model, write it uncommented into the config.
    let config = DEFAULT_CONFIG;
    if (defaultModel) {
      config = config.replace(
        '# MODEL="gpt-5.2"',
        `MODEL="${defaultModel.model}"`,
      );
      config = config.replace(
        '# BACKEND="codex"',
        `BACKEND="${defaultModel.backend}"`,
      );
    }
    await writeFile(configPath, config);
    console.log(`\nCreated config: ${configPath}`);
  }
  
  // Materialize the bundled (embedded) personas into the config dir. This is
  // optional — personas work out of the box from the embedded copies — but
  // writing them here makes them visible/editable as an escape hatch. We
  // never overwrite a user's existing file.
  for (const name of EMBEDDED_PERSONA_NAMES) {
    const personaDir = join(personasDir, name);
    const agentsPath = join(personaDir, 'AGENTS.md');
    await mkdir(personaDir, { recursive: true });
    const agentsFile = Bun.file(agentsPath);
    if (!await agentsFile.exists()) {
      const content = await readPersonaForInit(name);
      if (content) {
        await writeFile(agentsPath, content);
        console.log(`Created persona: ${name}`);
      }
    }
  }
  
  // Install agent skills, rendered with the detected default model so they
  // work out of the box without editing. If no model was detected, the
  // {{model}} placeholders are left intact (the user fills them in).
  console.log('');
  await handleSkills('install', [], defaultModel?.model);
  
  console.log(`\nveda initialized at ${vedaHome}`);
}
