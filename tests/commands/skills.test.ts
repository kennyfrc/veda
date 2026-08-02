import { describe, expect, test, beforeEach, afterEach, beforeAll } from 'bun:test';
import { mkdtemp, rm, readFile, lstat } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	installSkill,
	uninstallSkill,
	listSkills,
	handleSkills,
	SKILL_NAMES,
	getSkillContent,
} from '../../src/commands/skills';

// These handlers read homedir(), so we point HOME at a temp dir per test.
let tempHome: string;
let origHome: string | undefined;

beforeAll(async () => {
	// Sanity: getSkillContent resolves the embedded/on-disk skill content for
	// at least one skill. If this fails, the asset imports aren't resolving.
	const content = await getSkillContent('veda-plan-implement');
	expect(content).toContain('name: veda-plan-implement');
	expect(content.length).toBeGreaterThan(100);
});

describe('veda skills install/uninstall/list', () => {
	beforeEach(async () => {
		origHome = process.env.HOME;
		tempHome = await mkdtemp(join(tmpdir(), 'veda-skills-'));
		process.env.HOME = tempHome;
	});

	afterEach(async () => {
		process.env.HOME = origHome;
		await rm(tempHome, { recursive: true, force: true });
	});

	test('installSkill writes canonical file + claude symlink for all bundled skills', async () => {
		for (const name of SKILL_NAMES) {
			const r = await installSkill(name);
			expect(r.status).toBe('installed');

			// canonical file exists with correct name frontmatter
			const skillFile = join(tempHome, '.agents', 'skills', name, 'SKILL.md');
			expect(await Bun.file(skillFile).exists()).toBe(true);
			const text = await readFile(skillFile, 'utf-8');
			expect(text).toContain(`name: ${name}`);

			// claude symlink resolves to the canonical dir
			const link = join(tempHome, '.claude', 'skills', name);
			const stat = await lstat(link);
			expect(stat.isSymbolicLink()).toBe(true);
			const linkedSkillFile = join(link, 'SKILL.md');
			expect(await Bun.file(linkedSkillFile).exists()).toBe(true);
		}
	});

	test('install is idempotent: re-running leaves one canonical copy + one symlink', async () => {
		await installSkill('veda-plan-implement');
		const r2 = await installSkill('veda-plan-implement');
		expect(r2.status).toBe('unchanged');

		// still exactly one canonical dir, one symlink
		expect(existsSync(join(tempHome, '.agents', 'skills', 'veda-plan-implement', 'SKILL.md'))).toBe(true);
		const link = join(tempHome, '.claude', 'skills', 'veda-plan-implement');
		expect((await lstat(link)).isSymbolicLink()).toBe(true);
	});

	test('install updates content if the embedded source changed', async () => {
		await installSkill('veda-worker');
		// tamper with the canonical file
		const skillFile = join(tempHome, '.agents', 'skills', 'veda-worker', 'SKILL.md');
		await Bun.write(skillFile, 'stale content');

		const r2 = await installSkill('veda-worker');
		expect(r2.status).toBe('updated');
		const text = await readFile(skillFile, 'utf-8');
		expect(text).not.toContain('stale content');
		expect(text).toContain('name: veda-worker');
	});

	test('uninstallSkill removes canonical dir + claude symlink', async () => {
		await installSkill('veda-plan-implement');
		const r = await uninstallSkill('veda-plan-implement');
		expect(r.removed).toBe(true);
		expect(existsSync(join(tempHome, '.agents', 'skills', 'veda-plan-implement'))).toBe(false);
		expect(existsSync(join(tempHome, '.claude', 'skills', 'veda-plan-implement'))).toBe(false);
	});

	test('uninstallSkill on a missing skill is a no-op (removed=false)', async () => {
		const r = await uninstallSkill('veda-plan-implement');
		expect(r.removed).toBe(false);
	});

	test('uninstall does NOT clobber a user-owned real directory at the claude path', async () => {
		await installSkill('veda-plan-implement');
		// Replace the symlink with a real, non-empty directory the user owns.
		const link = join(tempHome, '.claude', 'skills', 'veda-plan-implement');
		await rm(link, { force: true });
		const { mkdir, writeFile } = await import('fs/promises');
		await mkdir(join(link, 'sub'), { recursive: true });
		await writeFile(join(link, 'mine.md'), 'user content');

		// uninstall should remove the canonical agents dir but refuse to touch
		// the non-empty user dir.
		const r = await uninstallSkill('veda-plan-implement');
		expect(r.removed).toBe(true); // canonical dir removed
		expect(existsSync(link)).toBe(true); // user dir preserved
		expect(await Bun.file(join(link, 'mine.md')).text()).toBe('user content');
	});

	test('listSkills reports installed + symlink health after install', async () => {
		for (const name of SKILL_NAMES) await installSkill(name);
		const statuses = await listSkills();
		expect(statuses).toHaveLength(SKILL_NAMES.length);
		for (const s of statuses) {
			expect(s.installed).toBe(true);
			expect(s.symlinkOk).toBe(true);
		}
	});

	test('listSkills reports not-installed before install', async () => {
		const statuses = await listSkills();
		for (const s of statuses) {
			expect(s.installed).toBe(false);
		}
	});

	test('handleSkills install then list via the command handler', async () => {
		// capture console
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...a: any[]) => { logs.push(a.join(' ')); };
		try {
			await handleSkills('install', []);
			await handleSkills('list', []);
		} finally {
			console.log = origLog;
		}
		expect(logs.join('\n')).toContain('veda-plan-implement');
		expect(logs.join('\n')).toMatch(/installed|Done/);
	});

	test('handleSkills with unknown subcommand exits non-zero', async () => {
		const origExit = process.exit;
		let exitCode: number | undefined;
		// @ts-expect-error override
		process.exit = (code?: number) => { exitCode = code; throw new Error('exit'); };
		try {
			await expect(handleSkills('bogus', [])).rejects.toThrow();
		} finally {
			process.exit = origExit;
		}
		expect(exitCode).toBe(1);
	});
});
