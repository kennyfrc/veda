/**
 * veda skills — install/uninstall/list the bundled Veda agent skills.
 *
 * Veda ships five Agent Skills (veda-plan, veda-plan-implement, veda-plan-implement-review,
 * veda-worker, ...) that teach coding agents how to collaborate with the
 * Navigator / Verifier models via the `veda` CLI.
 *
 * `install` materializes the bundled SKILL.md files into the cross-agent
 * discovery directories:
 *   - ~/.agents/skills/<name>/SKILL.md   (read globally by pi + OpenAI Codex)
 *   - ~/.claude/skills/<name>            (symlink → ~/.agents/skills/<name>,
 *                                         read by Claude Code, which follows symlinks)
 *
 * The skill source is resolved at runtime by getSkillContent():
 *   1. disk: when running from an npm package / dev tree (skills/ shipped in
 *      the package), read the .md from disk relative to this module.
 *   2. embedded: when running from a `bun build --compile`d binary, read the
 *      .md baked in as a build-time asset import.
 */

import { mkdir, writeFile, rm, readdir, readlink, symlink, lstat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { getAgentSkillsDir, getClaudeSkillsDir, getHomeDir } from '../util/paths';
import { pickDefaultModel } from '../agent/detect';

// =============================================================================
// Skill registry
// =============================================================================

export const SKILL_NAMES = ['veda-plan', 'veda-plan-implement', 'veda-plan-implement-review', 'veda-deep-plan', 'veda-worker'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

// Embedded asset imports. Under `bun build --compile` these are baked into the
// binary; under `bun run`/npm they resolve to the on-disk source files. Either
// way Bun.file(...).text() yields the content at runtime.
import vedaPlanSkill from '../../.agents/skills/veda-plan/SKILL.md' with { type: 'file' };
import vedaPlanImplSkill from '../../.agents/skills/veda-plan-implement/SKILL.md' with { type: 'file' };
import vedaPlanImplReviewSkill from '../../.agents/skills/veda-plan-implement-review/SKILL.md' with { type: 'file' };
import vedaDeepPlanSkill from '../../.agents/skills/veda-deep-plan/SKILL.md' with { type: 'file' };
import vedaWorkerSkill from '../../.agents/skills/veda-worker/SKILL.md' with { type: 'file' };
import vedaOnboardingDoc from '../../docs/veda.md' with { type: 'file' };

const EMBEDDED_SKILL_PATHS: Record<SkillName, string> = {
	'veda-plan': vedaPlanSkill,
	'veda-plan-implement': vedaPlanImplSkill,
	'veda-plan-implement-review': vedaPlanImplReviewSkill,
	'veda-deep-plan': vedaDeepPlanSkill,
	'veda-worker': vedaWorkerSkill,
};

/**
 * Resolve and read a skill's SKILL.md content.
 *
 * Tries the on-disk source first (dev / npm-package distribution), then falls
 * back to the embedded build-time asset (compiled binary). One resolver, both
 * distribution shapes.
 *
 * The returned content may contain `{{model}}` placeholders. Call
 * `renderSkill()` to substitute the detected default model before writing.
 */
export async function getSkillContent(name: SkillName): Promise<string> {
	// 1. On-disk source: <this module>/../../.agents/skills/<name>/SKILL.md
	//    Present in dev and when shipped as an npm package that includes skills/.
	const diskPath = join(dirname(__filename), '..', '..', '.agents', 'skills', name, 'SKILL.md');
	const diskFile = Bun.file(diskPath);
	if (await diskFile.exists()) {
		return await diskFile.text();
	}

	// 2. Embedded asset (compiled binary). The import path is resolved at build
	//    time; Bun.file() reads the baked-in content at runtime.
	const embedded = Bun.file(EMBEDDED_SKILL_PATHS[name]);
	return await embedded.text();
}

/**
 * Render a skill template by replacing `{{model}}` with the given model name.
 * If no model is provided, the placeholders are left intact (useful for
 * inspecting the raw template).
 */
export function renderSkill(content: string, model?: string): string {
	if (!model) return content;
	return content.replaceAll('{{model}}', model);
}

// =============================================================================
// Install / uninstall / list
// =============================================================================

export interface InstallResult {
	skill: SkillName;
	agentsDir: string;   // ~/.agents/skills/<name>
	claudeLink: string;  // ~/.claude/skills/<name>
	status: 'installed' | 'updated' | 'unchanged';
}

/**
 * Install one skill: write the canonical SKILL.md into ~/.agents/skills/<name>
 * and symlink ~/.claude/skills/<name> → that canonical dir.
 *
 * Idempotent: re-running leaves exactly one canonical copy + one symlink per
 * skill. Overwrites the file if its content changed; re-creates the symlink if
 * missing or pointing elsewhere.
 */
export async function installSkill(name: SkillName, model?: string): Promise<InstallResult> {
	const content = renderSkill(await getSkillContent(name), model);

	const agentsSkillsRoot = getAgentSkillsDir();
	const claudeSkillsRoot = getClaudeSkillsDir();
	const skillDir = join(agentsSkillsRoot, name);
	const skillFile = join(skillDir, 'SKILL.md');
	const claudeLink = join(claudeSkillsRoot, name);

	// 1. Write canonical file
	await mkdir(skillDir, { recursive: true });
	const existing = await Bun.file(skillFile).text().catch(() => null);
	const changed = existing !== content;
	if (changed) {
		await writeFile(skillFile, content, 'utf-8');
	}

	// 2. Ensure ~/.claude/skills/<name> symlinks to the canonical dir.
	//    Remove anything (broken link, stale link, or stray file/dir) first.
	await ensureSymlink(claudeLink, skillDir);

	return {
		skill: name,
		agentsDir: skillDir,
		claudeLink,
		status: existing === null ? 'installed' : changed ? 'updated' : 'unchanged',
	};
}

/**
 * Remove one skill: delete the canonical dir and the ~/.claude symlink.
 * Only removes the symlink if it points at our canonical dir (won't clobber a
 * user's own directory of the same name).
 */
export async function uninstallSkill(name: SkillName): Promise<{ removed: boolean; reason?: string }> {
	const skillDir = join(getAgentSkillsDir(), name);
	const claudeLink = join(getClaudeSkillsDir(), name);
	let removed = false;

	// Canonical dir
	if (existsSync(skillDir)) {
		await rm(skillDir, { recursive: true, force: true });
		removed = true;
	}

	// Claude symlink — only if it's a symlink (not a real dir the user owns)
	// and points at our canonical path.
	try {
		const stat = await lstat(claudeLink);
		if (stat.isSymbolicLink()) {
			const target = await readlink(claudeLink);
			const resolvedTarget = resolve(dirname(claudeLink), target);
			if (resolvedTarget === resolve(skillDir)) {
				await rm(claudeLink, { force: true });
				removed = true;
			}
		}
	} catch {
		// link doesn't exist — fine
	}

	return { removed };
}

export interface SkillStatus {
	skill: SkillName;
	agentsFile: string;          // ~/.agents/skills/<name>/SKILL.md
	claudeLink: string;          // ~/.claude/skills/<name>
	installed: boolean;          // agentsFile exists with expected content
	symlinkOk: boolean;          // claudeLink is a symlink resolving to a reachable SKILL.md
	embeddedContentHash: string; // first line of `name:` for sanity
}

export async function listSkills(): Promise<SkillStatus[]> {
	const results: SkillStatus[] = [];
	for (const name of SKILL_NAMES) {
		const skillFile = join(getAgentSkillsDir(), name, 'SKILL.md');
		const claudeLink = join(getClaudeSkillsDir(), name);

		let installed = false;
		let symlinkOk = false;
		let nameLine = '';

		// Check canonical file
		const file = Bun.file(skillFile);
		if (await file.exists()) {
			const text = await file.text();
			const m = text.match(/^name:\s*(.+?)\s*$/m);
			nameLine = m?.[1] ?? '';
			installed = nameLine === name;
		}

		// Check symlink resolves to a reachable SKILL.md
		try {
			const linked = Bun.file(join(claudeLink, 'SKILL.md'));
			if (await linked.exists()) {
				symlinkOk = true;
			}
		} catch {
			symlinkOk = false;
		}

		results.push({ skill: name, agentsFile: skillFile, claudeLink, installed, symlinkOk, embeddedContentHash: nameLine });
	}
	return results;
}

// =============================================================================
// Helper: idempotent symlink
// =============================================================================

async function ensureSymlink(linkPath: string, targetDir: string): Promise<void> {
	// Resolve target to absolute
	const absTarget = resolve(targetDir);

	// If something exists at linkPath, inspect it.
	try {
		const stat = await lstat(linkPath);
		if (stat.isSymbolicLink()) {
			const current = resolve(dirname(linkPath), await readlink(linkPath));
			if (current === absTarget) return;          // already correct
			await rm(linkPath, { force: true });         // points elsewhere → replace
		} else {
			// A real file/dir exists. Don't clobber silently — remove only if empty.
			// For safety, remove a dir only if it's empty.
			if (stat.isDirectory()) {
				const entries = await readdir(linkPath).catch(() => []);
				if (entries.length === 0) {
					await rm(linkPath, { recursive: true, force: true });
				} else {
					throw new Error(
						`Refusing to overwrite non-empty directory at ${linkPath}. ` +
						`Remove it manually if you want veda to manage this symlink.`
					);
				}
			} else {
				await rm(linkPath, { force: true });
			}
		}
	} catch (e: any) {
		if (e.code !== 'ENOENT') throw e;
		// doesn't exist — proceed to create
	}

	await mkdir(dirname(linkPath), { recursive: true });
	await symlink(absTarget, linkPath, 'dir');
}

// =============================================================================
// Command handler
// =============================================================================

export async function handleSkills(
	subcommand: string | undefined,
	_args: string[],
	model?: string,
): Promise<void> {
	switch (subcommand) {
		case 'install': {
			// If no model was passed, detect it so skills render with a real
			// default instead of leaving literal {{model}} placeholders.
			// (veda init passes the model explicitly; `veda skills install`
			// run standalone would otherwise install unrendered skills.)
			const resolvedModel = model ?? pickDefaultModel()?.model;
			let installed = 0, updated = 0, unchanged = 0;
			for (const name of SKILL_NAMES) {
				const r = await installSkill(name, resolvedModel);
				if (r.status === 'installed') installed++;
				else if (r.status === 'updated') updated++;
				else unchanged++;
				const mark = r.status === 'installed' ? '+' : r.status === 'updated' ? '~' : '=';
				console.log(`  ${mark} ${name}  →  ${r.agentsDir}`);
			}
			console.log(`\nDone: ${installed} installed, ${updated} updated, ${unchanged} unchanged.`);
			console.log(`Skills available to pi, Codex CLI, and Claude Code.`);

			// Sync the onboarding doc to ~/.pi/agent/docs/veda.md (the skills'
			// "Onboard yourself" reminder points there). Imported as an embedded
			// asset so the compiled binary can install it without a repo on disk.
			const vedaDocContent = await Bun.file(vedaOnboardingDoc).text().catch(() => null);
			if (vedaDocContent !== null) {
				const piDocsDir = join(getHomeDir(), '.pi', 'agent', 'docs');
				await mkdir(piDocsDir, { recursive: true });
				const existingDoc = await Bun.file(join(piDocsDir, 'veda.md')).text().catch(() => null);
				if (existingDoc !== vedaDocContent) {
					await writeFile(join(piDocsDir, 'veda.md'), vedaDocContent, 'utf-8');
					console.log(`  ~ veda.md  →  ${join(piDocsDir, 'veda.md')}`);
				} else {
					console.log(`  = veda.md  →  ${join(piDocsDir, 'veda.md')} (unchanged)`);
				}
			}

			const agentsRoot = getAgentSkillsDir();
			const claudeRoot = getClaudeSkillsDir();
			if (!existsSync(join(getHomeDir(), '.pi')) && !existsSync(join(getHomeDir(), '.codex')) && !existsSync(join(getHomeDir(), '.claude'))) {
				console.log(`\nNote: no agent home dirs detected yet. The skills are installed at:`);
				console.log(`  ${agentsRoot}   (pi + Codex read here globally)`);
				console.log(`  ${claudeRoot}   (symlinks; Claude Code reads here)`);
			}
			return;
		}

		case 'uninstall':
		case 'rm':
		case 'remove': {
			let removed = 0;
			for (const name of SKILL_NAMES) {
				const r = await uninstallSkill(name);
				if (r.removed) {
					removed++;
					console.log(`  - ${name}`);
				}
			}
			console.log(`\nRemoved ${removed} skill(s).`);
			return;
		}

		case 'ls':
		case 'list': {
			const statuses = await listSkills();
			if (statuses.length === 0) {
				console.log('No skills.');
				return;
			}
			console.log('Veda skills:\n');
			for (const s of statuses) {
				const mark = s.installed && s.symlinkOk ? '✓' : s.installed ? '~' : '✗';
				const detail = s.installed
					? s.symlinkOk
						? 'installed (agents + claude link ok)'
						: 'installed but claude link broken'
					: 'not installed';
				console.log(`  ${mark} ${s.skill.padEnd(28)} ${detail}`);
			}
			console.log(`\nCanonical dir: ${getAgentSkillsDir()}`);
			console.log(`Claude links:  ${getClaudeSkillsDir()}`);
			return;
		}

		default:
			console.error('Usage: veda skills <install|uninstall|list>');
			process.exit(1);
	}
}
