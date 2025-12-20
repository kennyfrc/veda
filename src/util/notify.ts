import { spawn } from 'node:child_process';

export interface NotifyOptions {
  title: string;
  message: string;
}

/**
 * Send a system notification using macOS osascript and play a sound.
 * Fails gracefully on non-macOS platforms.
 */
export function notify(options: NotifyOptions): void {
  if (process.platform !== 'darwin') return;

  const { title, message } = options;
  const escapedTitle = title.replace(/"/g, '\\"');
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
