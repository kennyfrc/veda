import { spawn } from 'node:child_process';
import { DEFAULT_SESSION } from './paths';

// Human-readable names for backend IDs
const BACKEND_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude',
  'codex': 'Codex',
  'gemini-cli': 'Gemini',
};

export interface NotifyOptions {
  title: string;
  message: string;
  session?: string;
  backend?: string;   // Backend ID (e.g., 'codex', 'claude-code')
  model?: string;     // Model name (e.g., 'gpt-5.2', 'opus')
}

/**
 * Truncate a string to a maximum length, appending ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number = 50): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format the notification message from a prompt.
 */
export function formatNotifyMessage(prompt: string | undefined): string {
  if (!prompt) return 'Response complete';
  return truncate(prompt);
}

/**
 * Format backend ID and model into a readable display string.
 * Returns undefined if no backend is provided.
 * Examples: "Codex GPT-5.2", "Claude Opus", "Gemini gemini-3-pro-preview"
 */
export function formatBackendModel(backend?: string, model?: string): string | undefined {
  if (!backend) return undefined;
  const displayName = BACKEND_DISPLAY_NAMES[backend] ?? backend;
  if (model) {
    return `${displayName} ${model}`;
  }
  return displayName;
}

/**
 * Send a system notification using macOS osascript and play a sound.
 * Fails gracefully on non-macOS platforms.
 */
export function notify(options: NotifyOptions): void {
  if (process.platform !== 'darwin') return;

  const { title, message, session, backend, model } = options;

  // Build display title: base title + backend/model + session
  const backendModel = formatBackendModel(backend, model);
  const sessionSuffix = (session && session !== DEFAULT_SESSION) ? ` [${session}]` : '';
  const backendSuffix = backendModel ? ` - ${backendModel}` : '';
  const displayTitle = `${title}${backendSuffix}${sessionSuffix}`;

  const escapedTitle = displayTitle.replace(/"/g, '\\"');
  const escapedMessage = message.replace(/"/g, '\\"');

  const script = `display notification "${escapedMessage}" with title "${escapedTitle}"`;

  // Send notification
  spawn('osascript', ['-e', script], {
    detached: true,
    stdio: 'ignore'
  }).unref();

  // Play subtle sound (Pop.aiff as used in pi-mono coding-agent)
  spawn('afplay', ['/System/Library/Sounds/Pop.aiff'], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}
