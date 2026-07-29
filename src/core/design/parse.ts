/**
 * Minimal, dependency-free parser for the program-design XML subset.
 *
 * The format is constrained: one <program> root with a fixed set of child
 * element kinds (intent, layout, context, types, signatures, callstacks,
 * invariants). Element bodies are plain text (no nested XML beyond the
 * known child structure), and attributes are simple key="value" pairs on
 * the known elements. This is enough to avoid a new dependency.
 *
 * The parser is pure: string in, ParseResult out, no I/O.
 */
import type {
  ProgramDesign,
  ParseResult,
  DesignFile,
  DesignContextEntry,
  DesignType,
  DesignSignature,
  DesignParam,
  DesignCallstack,
  DesignCallstackStep,
  DesignInvariant,
} from './types';

/** Match the outermost <program ...>...</program> block (last one wins). */
const PROGRAM_RE = /<program\b([^>]*)>([\s\S]*?)<\/program>/gi;

/** Extract a single attribute value: name="value" or name='value'. */
function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  return m ? (m[2] ?? m[3] ?? '') : undefined;
}

/** Find all matches of a child element, handling both paired and self-closing forms. */
function children(xml: string, tag: string): { attrs: string; body: string }[] {
  const out: { attrs: string; body: string }[] = [];
  // Paired: <tag ...>body</tag>
  const paired = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = paired.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? '', body: m[2] ?? '' });
  }
  // Self-closing: <tag .../> (not already captured by paired)
  const selfClose = new RegExp(`<${tag}\\b([^>]*?)/>`, 'gi');
  while ((m = selfClose.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? '', body: '' });
  }
  return out;
}

/** Find all self-closing children with attributes: <tag .../>. */
function selfClosing(xml: string, tag: string): { attrs: string }[] {
  const re = new RegExp(`<${tag}\\b([^>]*?)/>`, 'gi');
  const out: { attrs: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? '' });
  }
  return out;
}

/** Trim a block's body and collapse internal blank lines. */
function clean(body: string): string {
  return body.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim();
}

function parseLayout(xml: string): DesignFile[] {
  const layoutBlock = xml.match(/<layout\b[^>]*>([\s\S]*?)<\/layout>/i);
  if (!layoutBlock) return [];
  return selfClosing(layoutBlock[1], 'file').map(f => ({
    path: attr(f.attrs, 'path') ?? '',
    role: attr(f.attrs, 'role'),
  })).filter(f => f.path);
}

function parseContext(xml: string): DesignContextEntry[] {
  const ctxBlock = xml.match(/<context\b[^>]*>([\s\S]*?)<\/context>/i);
  if (!ctxBlock) return [];
  const used = selfClosing(ctxBlock[1], 'used').map(u => ({
    file: attr(u.attrs, 'file') ?? '',
  })).filter(e => e.file);
  const omitted = selfClosing(ctxBlock[1], 'omitted').map(o => ({
    file: attr(o.attrs, 'file') ?? '',
    reason: attr(o.attrs, 'reason'),
  })).filter(e => e.file);
  return [...used, ...omitted];
}

function parseTypes(xml: string): DesignType[] {
  return children(xml, 'type').map(t => ({
    name: attr(t.attrs, 'name') ?? '',
    file: attr(t.attrs, 'file') ?? '',
    body: clean(t.body),
  })).filter(t => t.name && t.file);
}

function parseSignatures(xml: string): DesignSignature[] {
  return children(xml, 'signature').map(s => {
    const contract = s.body.match(/<contract\b[^>]*>([\s\S]*?)<\/contract>/i);
    const params: DesignParam[] = children(s.body, 'param').map(p => ({
      name: attr(p.attrs, 'name') ?? '',
      type: attr(p.attrs, 'type') ?? '',
    })).filter(p => p.name);
    const ret = s.body.match(/<returns\b([^>]*)>([\s\S]*?)<\/returns>/i);
    const returns = ret
      ? { type: attr(ret[1], 'type') ?? '', description: clean(ret[2]) || undefined }
      : undefined;
    return {
      name: attr(s.attrs, 'name') ?? '',
      file: attr(s.attrs, 'file') ?? '',
      kind: attr(s.attrs, 'kind') ?? 'function',
      contract: contract ? clean(contract[1]) : undefined,
      params,
      returns,
    };
  }).filter(s => s.name && s.file);
}

function parseCallstacks(xml: string): DesignCallstack[] {
  return children(xml, 'callstack').map(cs => ({
    name: attr(cs.attrs, 'name') ?? '',
    steps: selfClosing(cs.body, 'step').map(st => ({
      ref: attr(st.attrs, 'ref') ?? '',
    })).filter((st: DesignCallstackStep) => st.ref),
  })).filter(cs => cs.name);
}

function parseInvariants(xml: string): DesignInvariant[] {
  return children(xml, 'invariant').map(inv => ({
    text: clean(inv.body),
  })).filter(inv => inv.text);
}

/**
 * Extract and parse a <program> block from a navigator-design response.
 * Returns the last <program> block if multiple are present (the designer
 * may emit draft attempts before the final one). Pure; no I/O.
 */
export function parseProgramDesign(response: string): ParseResult {
  const matches = [...response.matchAll(PROGRAM_RE)];
  if (matches.length === 0) {
    return { ok: false, reason: 'no-program-block' };
  }
  const last = matches[matches.length - 1];
  const programTag = last[1] ?? '';
  const body = last[2] ?? '';

  const name = attr(programTag, 'name') ?? '';
  const task = attr(programTag, 'task') ?? '';

  const intentMatch = body.match(/<intent\b[^>]*>([\s\S]*?)<\/intent>/i);
  if (!intentMatch) {
    return { ok: false, reason: 'malformed', detail: 'missing <intent> element' };
  }

  const design: ProgramDesign = {
    name,
    task,
    intent: clean(intentMatch[1]),
    layout: parseLayout(body),
    context: parseContext(body),
    types: parseTypes(body),
    signatures: parseSignatures(body),
    callstacks: parseCallstacks(body),
    invariants: parseInvariants(body),
  };

  return { ok: true, xml: last[0], design };
}
