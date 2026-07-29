import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { getVedaHome, getPersonasDir, getConfigPath } from '../util/paths';
import { handleSkills } from './skills';
import { EMBEDDED_PERSONA_NAMES, readPersonaForInit } from '../agent/persona';
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
  
  // Create config if it doesn't exist
  const configFile = Bun.file(configPath);
  if (!await configFile.exists()) {
    await writeFile(configPath, DEFAULT_CONFIG);
    console.log(`Created config: ${configPath}`);
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
  
  // Install agent skills (veda-plan, veda-plan-and-implement, veda-deep-plan,
  // veda-design-implement-review, veda-review) into ~/.agents/skills/ +
  // ~/.claude/skills/ so pi, Codex CLI, and Claude Code discover them.
  // Same logic as `veda skills install`.
  console.log('');
  await handleSkills('install', []);
  
  console.log(`\nveda initialized at ${vedaHome}`);
}
