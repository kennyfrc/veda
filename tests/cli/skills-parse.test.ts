import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { parseAndValidate, CliValidationError } from '../../src/cli/index';

describe('skills command parsing', () => {
	const originalEnv = process.env.VEDA_SESSION;
	beforeEach(() => { delete process.env.VEDA_SESSION; });
	afterEach(() => { if (originalEnv) process.env.VEDA_SESSION = originalEnv; });

	test('skills install → { command: skills, subcommand: install }', async () => {
		const input = await parseAndValidate(['node', 'veda', 'skills', 'install']);
		expect(input.command).toBe('skills');
		if (input.command !== 'skills') return; // narrow for TS
		expect(input.subcommand).toBe('install');
	});

	test('skills list → subcommand: list', async () => {
		const input = await parseAndValidate(['node', 'veda', 'skills', 'list']);
		expect(input.command).toBe('skills');
		if (input.command !== 'skills') return;
		expect(input.subcommand).toBe('list');
	});

	test('skills uninstall → subcommand: uninstall', async () => {
		const input = await parseAndValidate(['node', 'veda', 'skills', 'uninstall']);
		expect(input.command).toBe('skills');
		if (input.command !== 'skills') return;
		expect(input.subcommand).toBe('uninstall');
	});

	test('skills with no subcommand → UNKNOWN_COMMAND error', async () => {
		expect(parseAndValidate(['node', 'veda', 'skills'])).rejects.toThrow(CliValidationError);
	});

	test('skills with unknown subcommand → UNKNOWN_COMMAND error', async () => {
		expect(parseAndValidate(['node', 'veda', 'skills', 'bogus'])).rejects.toThrow(CliValidationError);
	});

	test('skills install silently ignores inapplicable flags (matches sel/init pattern)', async () => {
		// skills, like sel/init/personas, returns before validateApplicability,
		// so --deep is ignored rather than rejected.
		const input = await parseAndValidate(['node', 'veda', 'skills', 'install', '--deep']);
		expect(input.command).toBe('skills');
	});
});
