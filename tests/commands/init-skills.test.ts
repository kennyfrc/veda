import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { handleInit } from '../../src/commands/init';
import { listSkills } from '../../src/commands/skills';

describe('veda init installs skills', () => {
	let tempHome: string;
	let origHome: string | undefined;
	let origVedaHome: string | undefined;

	beforeEach(async () => {
		origHome = process.env.HOME;
		origVedaHome = process.env.VEDA_HOME;
		tempHome = await mkdtemp(join(tmpdir(), 'veda-init-'));
		process.env.HOME = tempHome;
		process.env.VEDA_HOME = join(tempHome, '.config', 'veda');
	});

	afterEach(async () => {
		process.env.HOME = origHome;
		if (origVedaHome === undefined) delete process.env.VEDA_HOME;
		else process.env.VEDA_HOME = origVedaHome;
		await rm(tempHome, { recursive: true, force: true });
	});

	test('init creates personas AND installs all three skills', async () => {
		// silence init's console output
		const origLog = console.log;
		console.log = () => {};
		try {
			await handleInit({ session: 'default' } as any);
		} finally {
			console.log = origLog;
		}

		// personas created
		expect(existsSync(join(process.env.VEDA_HOME!, 'personas', 'navigator-plan', 'AGENTS.md'))).toBe(true);

		// skills installed to ~/.agents/skills + ~/.claude/skills symlink
		const statuses = await listSkills();
		expect(statuses).toHaveLength(3);
		for (const s of statuses) {
			expect(s.installed).toBe(true);
			expect(s.symlinkOk).toBe(true);
		}
	});
});
