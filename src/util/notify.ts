import { spawn } from 'node:child_process';

const BACKEND_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude',
  'codex': 'Codex',
  'droid': 'Droid',
  'jdc': 'Jetdraft Coder',
};

const SYSTEM_SOUND_DIR = '/System/Library/Sounds';
const DEFAULT_NOTIFY_SOUND = 'Purr';

export interface NotifyOptions {
  title: string;
  message: string;
  subtitle?: string;
  backend?: string;
  model?: string;
  sound?: string;
}

export function truncate(str: string, maxLength: number = 50): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function formatNotifyMessage(prompt: string | undefined): string {
  if (!prompt) return 'Response complete';
  return truncate(prompt);
}

/**
 * Format backend ID and model into a readable display string.
 * Returns undefined if no backend is provided.
 * Examples: "Codex GPT-5.2", "Claude Opus", "Droid glm-5.2"
 */
export function formatBackendModel(backend?: string, model?: string): string | undefined {
  if (!backend) return undefined;
  const displayName = BACKEND_DISPLAY_NAMES[backend] ?? backend;
  if (model) {
    return `${displayName} ${model}`;
  }
  return displayName;
}

export function resolveNotifySoundPath(sound?: string): string | null {
  const trimmed = sound?.trim();
  if (!trimmed) {
    return `${SYSTEM_SOUND_DIR}/${DEFAULT_NOTIFY_SOUND}.aiff`;
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === 'none' || lowered === 'off' || lowered === 'silent') {
    return null;
  }

  if (trimmed.includes('/')) {
    return trimmed;
  }

  const fileName = trimmed.endsWith('.aiff') ? trimmed : `${trimmed}.aiff`;
  return `${SYSTEM_SOUND_DIR}/${fileName}`;
}

/**
 * Send a system notification using macOS osascript and play a sound.
 * Fails gracefully on non-macOS platforms.
 */
export function notify(options: NotifyOptions): void {
  if (process.platform !== 'darwin') return;

  const { title, message, subtitle, backend, model, sound } = options;

  // Build display title: base title + backend/model
  const backendModel = formatBackendModel(backend, model);
  const backendSuffix = backendModel ? ` - ${backendModel}` : '';
  const displayTitle = `${title}${backendSuffix}`;

  const escapedTitle = displayTitle.replace(/"/g, '\\"');
  const escapedMessage = message.replace(/"/g, '\\"');

  // Build subtitle if provided
  const subtitlePart = subtitle ? ` subtitle "${subtitle.replace(/"/g, '\\"')}"` : '';

  const script = `display notification "${escapedMessage}" with title "${escapedTitle}"${subtitlePart}`;
  const soundPath = resolveNotifySoundPath(sound);

  // Send notification
  spawn('osascript', ['-e', script], {
    detached: true,
    stdio: 'ignore'
  }).unref();

  // Play notification sound (default: Purr)
  if (soundPath) {
    spawn('afplay', [soundPath], {
      detached: true,
      stdio: 'ignore'
    }).unref();
  }
}
