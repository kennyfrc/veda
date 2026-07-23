/**
 * Ambient module declarations for non-TS assets imported with Bun's
 * `with { type: 'file' }` import attribute.
 *
 * Bun's `import path from './file.md' with { type: 'file' }` yields the file
 * path as a string at runtime; `Bun.file(path).text()` then reads the content.
 * (bun-types ships declarations for *.txt, *.yaml, etc. but not *.md.)
 *
 * Under `bun build --compile` the content is baked into the binary; under
 * `bun run` / npm the path resolves to the on-disk source file. Either way the
 * imported value is a string path.
 */
declare module '*.md' {
	const path: string;
	export default path;
}
