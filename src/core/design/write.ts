/**
 * Write a validated program design to /tmp for the caller to consume.
 *
 * This is the ONLY I/O layer in the design pipeline. The parser and
 * validator are pure; this module takes their output and materializes
 * it as files the caller (pi, a human, another agent) can read.
 *
 * Output layout: /tmp/veda/<session>/{design.xml, design.json, design.report}
 * /tmp is ephemeral by design — the caller can copy design.xml into the
 * repo to persist it, or re-run the designer to regenerate.
 */
import { join } from 'path';
import { getSessionDir } from '../../util/paths';
import type { ProgramDesign, ValidateResult } from './types';

export interface DesignOutputPaths {
  xml: string;
  json: string;
  report: string;
  dir: string;
}

/** Resolve the session directory for design artifacts. */
export function designOutputDir(session: string): string {
  // Use the session dir (same as selection/, thread.json) — survives reboots,
  // makes reviewer auto-attach trivial, avoids /tmp staleness.
  // (Navigator finding: getSessionDir is the right home, not /tmp.)
  return getSessionDir(session);
}

/** Serialize a ProgramDesign to the XML form (re-emit from parsed structure). */
export function designToXml(design: ProgramDesign): string {
  const lines: string[] = [];
  lines.push(`<program name="${esc(design.name)}" task="${esc(design.task)}">`);

  lines.push(`  <intent>${esc(design.intent)}</intent>`);

  if (design.layout.length > 0) {
    lines.push('  <layout>');
    for (const f of design.layout) {
      const role = f.role ? ` role="${esc(f.role)}"` : '';
      lines.push(`    <file path="${esc(f.path)}"${role}/>`);
    }
    lines.push('  </layout>');
  }

  if (design.context.length > 0) {
    lines.push('  <context>');
    for (const c of design.context) {
      if (c.reason !== undefined) {
        lines.push(`    <omitted file="${esc(c.file)}" reason="${esc(c.reason)}"/>`);
      } else {
        lines.push(`    <used file="${esc(c.file)}"/>`);
      }
    }
    lines.push('  </context>');
  }

  if (design.types.length > 0) {
    lines.push('  <types>');
    for (const t of design.types) {
      lines.push(`    <type name="${esc(t.name)}" file="${esc(t.file)}">`);
      lines.push(indent(t.body, '      '));
      lines.push('    </type>');
    }
    lines.push('  </types>');
  }

  if (design.signatures.length > 0) {
    lines.push('  <signatures>');
    for (const s of design.signatures) {
      lines.push(`    <signature name="${esc(s.name)}" file="${esc(s.file)}" kind="${esc(s.kind)}">`);
      if (s.contract) {
        lines.push(`      <contract>${esc(s.contract)}</contract>`);
      }
      for (const p of s.params) {
        lines.push(`      <param name="${esc(p.name)}" type="${esc(p.type)}"/>`);
      }
      if (s.returns) {
        const desc = s.returns.description ? `>${esc(s.returns.description)}</returns>` : '/>';
        lines.push(`      <returns type="${esc(s.returns.type)}"${desc}`);
      }
      lines.push('    </signature>');
    }
    lines.push('  </signatures>');
  }

  if (design.callstacks.length > 0) {
    lines.push('  <callstacks>');
    for (const cs of design.callstacks) {
      lines.push(`    <callstack name="${esc(cs.name)}">`);
      for (const step of cs.steps) {
        lines.push(`      <step ref="${esc(step.ref)}"/>`);
      }
      lines.push('    </callstack>');
    }
    lines.push('  </callstacks>');
  }

  if (design.invariants.length > 0) {
    lines.push('  <invariants>');
    for (const inv of design.invariants) {
      lines.push(`    <invariant>${esc(inv.text)}</invariant>`);
    }
    lines.push('  </invariants>');
  }

  lines.push('</program>');
  return lines.join('\n');
}

/** Serialize a ProgramDesign to a JSON string (pretty-printed). */
export function designToJson(design: ProgramDesign): string {
  return JSON.stringify(design, null, 2);
}

/** Build a human-readable report: validation status + summary. */
export function designToReport(design: ProgramDesign, validation: ValidateResult): string {
  const lines: string[] = [];
  lines.push(`# Program Design Report`);
  lines.push(`name: ${design.name}`);
  lines.push(`task: ${design.task}`);
  lines.push(`validation: ${validation.ok ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`- layout files: ${design.layout.length}`);
  lines.push(`- context entries: ${design.context.length}`);
  lines.push(`- types: ${design.types.length}`);
  lines.push(`- signatures: ${design.signatures.length}`);
  lines.push(`- callstacks: ${design.callstacks.length}`);
  lines.push(`- invariants: ${design.invariants.length}`);

  if (validation.errors.length > 0) {
    lines.push('');
    lines.push(`## Errors (${validation.errors.length})`);
    for (const e of validation.errors) {
      lines.push(`- [${e.kind}] ${e.message}`);
    }
  }
  if (validation.warnings.length > 0) {
    lines.push('');
    lines.push(`## Warnings (${validation.warnings.length})`);
    for (const w of validation.warnings) {
      lines.push(`- ${w}`);
    }
  }
  return lines.join('\n');
}

/** Write all design artifacts to /tmp. Returns the paths. */
export async function writeDesign(
  design: ProgramDesign,
  validation: ValidateResult,
  session: string
): Promise<DesignOutputPaths> {
  const dir = designOutputDir(session);
  const paths: DesignOutputPaths = {
    dir,
    xml: join(dir, 'design.xml'),
    json: join(dir, 'design.json'),
    report: join(dir, 'design.report'),
  };

  const { mkdir, writeFile } = await import('fs/promises');
  await mkdir(dir, { recursive: true });

  await writeFile(paths.xml, designToXml(design), 'utf-8');
  await writeFile(paths.json, designToJson(design), 'utf-8');
  await writeFile(paths.report, designToReport(design, validation), 'utf-8');

  return paths;
}

/** Escape XML attribute/text values. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Indent a multi-line block. */
function indent(text: string, pad: string): string {
  return text.split('\n').map(l => pad + l).join('\n');
}
