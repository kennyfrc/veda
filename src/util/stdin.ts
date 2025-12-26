export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  try {
    const text = await Bun.stdin.text();
    return text.trim().length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}
