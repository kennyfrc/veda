/**
 * Reads content from stdin if available and not a TTY.
 * Returns undefined if no input is detected or if running in interactive mode.
 */
export async function readStdin(): Promise<string | undefined> {
  // Check if stdin is a TTY. If it is, we're in interactive mode and shouldn't read.
  if (process.stdin.isTTY) {
    return undefined;
  }

  try {
    const text = await Bun.stdin.text();
    // Return undefined if empty to avoid appending newlines unnecessarily
    return text.trim().length > 0 ? text : undefined;
  } catch {
    // Ignore errors reading stdin (e.g. if closed or not available)
    return undefined;
  }
}
