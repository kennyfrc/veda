/**
 * Validate a parsed ProgramDesign against the protocol's invariants.
 *
 * Pure: ProgramDesign in, ValidateResult out, no I/O. All checks are
 * deterministic — a design either satisfies them or it does not.
 *
 * Invariants (Navigator-aligned):
 * 1. Every <signature file=> and <type file=> declared in <layout>.
 * 2. Every <callstack step ref=> resolves to a declared signature.
 * 3. <invariants> non-empty whenever <signatures> is non-empty.
 * 4. No duplicate <signature name=> (ambiguous <step ref=>).
 * 5. No duplicate <type name=>.
 * 6. No duplicate <file path=> in <layout>.
 * 7. A file cannot be both <used> and <omitted> in <context>.
 * 8. A file in <layout> cannot appear in <omitted> (contradictory).
 * 9. <callstack> must have at least one <step>.
 * 10. Layout paths must be repo-relative (no absolute, no ..).
 */
import type { ProgramDesign, ValidateResult, ValidationError } from './types';

/** Check for repo-relative path (no absolute, no traversal). */
function isRepoRelative(p: string): boolean {
  if (p.startsWith('/')) return false;
  if (p.includes('..')) return false;
  return true;
}

/**
 * Run every invariant check. Returns ok:false with the full error list
 * (never short-circuits) so the designer sees all problems at once.
 */
export function validateDesign(design: ProgramDesign): ValidateResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Index declared files by path for O(1) lookup.
  const declaredFiles = new Set(design.layout.map(f => f.path));

  // 6. Duplicate <file path=> in <layout>.
  const layoutPathCounts = new Map<string, number>();
  for (const f of design.layout) {
    layoutPathCounts.set(f.path, (layoutPathCounts.get(f.path) ?? 0) + 1);
  }
  for (const [path, count] of layoutPathCounts) {
    if (count > 1) {
      errors.push({
        kind: 'layout',
        message: `duplicate file path "${path}" in <layout>`,
      });
    }
  }

  // 10. Path hygiene: layout paths must be repo-relative.
  for (const f of design.layout) {
    if (!isRepoRelative(f.path)) {
      errors.push({
        kind: 'layout',
        message: `file path "${f.path}" must be repo-relative (no absolute paths, no ..)`,
      });
    }
  }

  // 1a. Every <signature file=> must be declared in <layout>.
  for (const sig of design.signatures) {
    if (!declaredFiles.has(sig.file)) {
      errors.push({
        kind: 'signature',
        message: `signature "${sig.name}" references file "${sig.file}" not declared in <layout>`,
      });
    }
  }

  // 1b. Every <type file=> must be declared in <layout>.
  for (const t of design.types) {
    if (!declaredFiles.has(t.file)) {
      errors.push({
        kind: 'type',
        message: `type "${t.name}" references file "${t.file}" not declared in <layout>`,
      });
    }
  }

  // 4. Duplicate <signature name=> (ambiguous step refs).
  const sigNameCounts = new Map<string, number>();
  for (const s of design.signatures) {
    sigNameCounts.set(s.name, (sigNameCounts.get(s.name) ?? 0) + 1);
  }
  for (const [name, count] of sigNameCounts) {
    if (count > 1) {
      errors.push({
        kind: 'signature',
        message: `duplicate signature name "${name}" — callstack <step ref=> would be ambiguous`,
      });
    }
  }

  // 5. Duplicate <type name=>.
  const typeNameCounts = new Map<string, number>();
  for (const t of design.types) {
    typeNameCounts.set(t.name, (typeNameCounts.get(t.name) ?? 0) + 1);
  }
  for (const [name, count] of typeNameCounts) {
    if (count > 1) {
      errors.push({
        kind: 'type',
        message: `duplicate type name "${name}"`,
      });
    }
  }

  // 2. Every <callstack step ref=> must resolve to a declared signature.
  const signatureNames = new Set(design.signatures.map(s => s.name));
  for (const cs of design.callstacks) {
    // 9. <callstack> must have at least one <step>.
    if (cs.steps.length === 0) {
      errors.push({
        kind: 'callstack',
        message: `callstack "${cs.name}" has no <step> elements`,
      });
    }
    for (const step of cs.steps) {
      if (!signatureNames.has(step.ref)) {
        errors.push({
          kind: 'callstack',
          message: `callstack "${cs.name}" step ref="${step.ref}" does not resolve to any declared <signature>`,
        });
      }
    }
  }

  // 3. <invariants> non-empty whenever <signatures> is non-empty.
  // (Blunt rule replaces the unverifiable "declares state" heuristic.)
  if (design.signatures.length > 0 && design.invariants.length === 0) {
    errors.push({
      kind: 'invariants',
      message: 'design declares signatures but has no <invariants> — every contract-bearing design requires at least one invariant',
    });
  }

  // 7. A file cannot be both <used> and <omitted> in <context>.
  const usedFiles = new Set(design.context.filter(c => c.reason === undefined).map(c => c.file));
  const omittedFiles = new Set(design.context.filter(c => c.reason !== undefined).map(c => c.file));
  for (const f of usedFiles) {
    if (omittedFiles.has(f)) {
      errors.push({
        kind: 'context',
        message: `file "${f}" appears in both <used> and <omitted> — contradictory`,
      });
    }
  }

  // 8. A file in <layout> cannot appear in <omitted>.
  for (const f of declaredFiles) {
    if (omittedFiles.has(f)) {
      errors.push({
        kind: 'context',
        message: `file "${f}" is declared in <layout> but marked <omitted> — contradictory`,
      });
    }
  }

  // Warnings (non-fatal).
  if (design.layout.length === 0) {
    warnings.push('no files declared in <layout> — the caller will have nothing to anchor on');
  }
  if (design.signatures.length === 0) {
    warnings.push('no <signature> elements — the design describes no concrete contracts to implement');
  }

  return { ok: errors.length === 0, errors, warnings };
}
