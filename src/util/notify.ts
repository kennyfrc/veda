import { spawn } from 'node:child_process';
import { DEFAULT_SESSION } from './paths';

export interface NotifyOptions {
  title: string;
  message: string;
  session?: string;
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
 * Send a system notification using macOS osascript and play a sound.
 * Fails gracefully on non-macOS platforms.
 */
export function notify(options: NotifyOptions): void {
  if (process.platform !== 'darwin') return;

  const { title, message, session } = options;

  // Format title: Append session if it's not the default one
  const displayTitle = (session && session !== DEFAULT_SESSION)
    ? `${title} [${session}]`
    : title;

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
