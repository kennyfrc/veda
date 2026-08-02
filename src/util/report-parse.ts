/**
 * Parser for the worker_report handoff protocol.
 *
 * The worker persona's final message MUST end with exactly one
 * <worker_report>...</worker_report> block implementing Factory's subagent
 * handoff contract (status, salient_summary, what_was_implemented,
 * what_was_left_undone, verification, tests, discovered_issues, needs).
 *
 * This module extracts and parses that block leniently — XML delimiters are
 * model-reliable, so we find the last <worker_report> and parse fields from
 * it. Missing/invalid required fields surface as warnings; an absent or
 * malformed block is a protocol failure (the runner exits non-zero).
 *
 * Pure: string in, result out, no I/O. Persistence lives in run.ts via
 * saveWorkerReport().
 */

export type WorkerReportStatus = 'completed' | 'failed' | 'blocked';

/** Manual-QA probe surfaces the worker may cite as evidence (design contract). */
export type VerificationTool = 'cdp' | 'xtui' | 'tmux' | 'scratch';

const KNOWN_VERIFICATION_TOOLS: ReadonlySet<string> = new Set(['cdp', 'xtui', 'tmux', 'scratch']);

/** Narrow a raw tool string to the union, or undefined if unknown. */
export function isVerificationTool(tool: string): tool is VerificationTool {
  return KNOWN_VERIFICATION_TOOLS.has(tool);
}

export interface WorkerVerificationCommand {
  ran: string;
  exit?: number;
  observation?: string;
}

export interface WorkerEvidence {
  /** The probe surface as the worker named it. Unknown values are preserved
   *  but surfaced as a warning — see isVerificationTool() for the contract. */
  tool: string;
  surface: string;
  observation: string;
  artifacts: string[];
}

export interface WorkerTests {
  added: string;
  updated: string;
  coverage?: string;
}

/** Issue severity per the protocol: blocking or non_blocking. */
export type WorkerIssueSeverity = 'blocking' | 'non_blocking';

/** Narrow a raw severity string to the union, or undefined if invalid. */
export function isWorkerIssueSeverity(s: string): s is WorkerIssueSeverity {
  return s === 'blocking' || s === 'non_blocking';
}

export interface WorkerDiscoveredIssue {
  /** Stored honestly as the worker wrote it; guard isWorkerIssueSeverity() +
   *  a warning surface values outside the blocking|non_blocking contract. */
  severity: string;
  description: string;
  suggestedFix?: string;
}

export interface WorkerVerification {
  /** Commands run against the suite/typecheck/build — evidence triples. */
  commandsRun: WorkerVerificationCommand[];
  /** Manual-QA probes against a real running surface (cdp/xtui/tmux/scratch). */
  evidence: WorkerEvidence[];
}

/** The parsed worker report, using Factory's camelCase field vocabulary. */
export interface WorkerReport {
  status: WorkerReportStatus;
  salientSummary: string;
  whatWasImplemented: string;
  whatWasLeftUndone: string;
  verification: WorkerVerification;
  tests?: WorkerTests;
  discoveredIssues: WorkerDiscoveredIssue[];
  needs?: string;
}

export type WorkerReportParseResult =
  | { ok: true; block: string; report: WorkerReport; warnings: string[] }
  | {
      ok: false;
      reason: 'no-block' | 'malformed';
      detail?: string;
      /** Tail of the response, printed to stderr for diagnosis. */
      tail: string;
    };

/** Match a complete <worker_report>...</worker_report> block (last one wins). */
const WORKER_REPORT_RE = /<worker_report\b[^>]*>([\s\S]*?)<\/worker_report>/gi;

/** Decode the minimal XML entity set we use. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Trim a block's body, collapse blank lines, decode entities. */
function clean(body: string): string {
  return decodeEntities(
    body.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim()
  );
}

/** Extract a single attribute value: name="value" or name='value'. */
function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined;
}

interface TaggedBody {
  attrs: string;
  body: string;
}

/** Find all paired <tag ...>body</tag> children. */
function children(xml: string, tag: string): TaggedBody[] {
  const out: TaggedBody[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? '', body: m[2] ?? '' });
  }
  return out;
}

/** The body of the first <tag>...</tag> child of xml, or undefined. */
function childBlock(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : undefined;
}

/** The cleaned text of the first <tag>...</tag> child, or undefined. */
function childText(xml: string, tag: string): string | undefined {
  const b = childBlock(xml, tag);
  return b === undefined ? undefined : clean(b);
}

/**
 * Split `artifacts: <paths>` lines out of an evidence body.
 * Visual claims are not evidence without their artifact; the paths travel
 * as a list in the persisted report.
 */
function splitArtifacts(body: string): { body: string; artifacts: string[] } {
  const kept: string[] = [];
  const artifacts: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^artifacts:\s*(.+)$/i);
    if (m) {
      for (const p of m[1].split(/[\s,]+/)) {
        if (p) artifacts.push(p);
      }
    } else {
      kept.push(line);
    }
  }
  return { body: kept.join('\n'), artifacts };
}

/** Trailing lines of a response, for the protocol-error diagnostics. */
function lastLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(-n).join('\n');
}

/**
 * Extract and parse the last complete <worker_report> block from a worker
 * response. Pure; no I/O.
 */
export function parseWorkerReport(response: string): WorkerReportParseResult {
  // Invariant: exactly one <worker_report> opening tag and one closing tag.
  // Count them across the whole response first — the lenient extraction regex
  // cannot distinguish nested/stray openers, so a count mismatch must fail.
  const openTags = (response.match(/<worker_report\b/gi) ?? []).length;
  const closeTags = (response.match(/<\/worker_report\s*>/gi) ?? []).length;

  if (openTags === 0 && closeTags === 0) {
    return { ok: false, reason: 'no-block', tail: lastLines(response, 40) };
  }
  if (openTags !== 1 || closeTags !== 1) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `expected exactly one <worker_report> pair, found ${openTags} opening and ${closeTags} closing tag(s)`,
      tail: lastLines(response, 40),
    };
  }

  const matches = [...response.matchAll(WORKER_REPORT_RE)];

  if (matches.length !== 1) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `found ${matches.length} <worker_report> blocks; exactly one is required`,
      tail: lastLines(response, 40),
    };
  }

  const last = matches[0];
  const block = last[0];
  const body = last[1] ?? '';
  const warnings: string[] = [];

  // Invariant: nothing may follow the block.
  const afterIndex = (last.index ?? 0) + block.length;
  if (response.slice(afterIndex).trim().length > 0) {
    return {
      ok: false,
      reason: 'malformed',
      detail: 'content follows the <worker_report> block; nothing may follow it',
      tail: lastLines(response.slice(afterIndex), 40),
    };
  }

  const statusRaw = childText(body, 'status');
  let status: WorkerReportStatus;
  if (statusRaw === 'completed' || statusRaw === 'failed' || statusRaw === 'blocked') {
    status = statusRaw;
  } else {
    status = 'failed';
    warnings.push(statusRaw ? `invalid <status> "${statusRaw}"` : 'missing <status>');
  }

  const salientSummary = childText(body, 'salient_summary') ?? '';
  const whatWasImplemented = childText(body, 'what_was_implemented') ?? '';
  const whatWasLeftUndone = childText(body, 'what_was_left_undone') ?? '';
  const needs = childText(body, 'needs');

  if (!salientSummary) warnings.push('missing <salient_summary>');
  if (!whatWasImplemented) warnings.push('missing <what_was_implemented>');
  if (!whatWasLeftUndone) warnings.push('missing <what_was_left_undone>');

  const verificationBlock = childBlock(body, 'verification') ?? '';
  if (!childBlock(body, 'verification')) {
    warnings.push('missing <verification>');
  }
  const commandsRun = children(verificationBlock, 'command').map(c => {
    const ran = attr(c.attrs, 'ran') ?? '';
    const exitRaw = attr(c.attrs, 'exit');
    let exit: number | undefined;
    if (exitRaw !== undefined) {
      const trimmed = exitRaw.trim();
      if (/^-?\d+$/.test(trimmed)) {
        exit = parseInt(trimmed, 10);
      } else {
        // Strict integer shape only — parseInt would accept '1oops'/'1.5'.
        warnings.push(`verification <command> has invalid exit value "${exitRaw}"`);
      }
    }
    if (!ran) warnings.push('verification <command> missing ran attribute');
    return {
      ran,
      exit,
      observation: clean(c.body) || undefined,
    };
  });

  const evidence = children(verificationBlock, 'evidence').map(e => {
    const tool = attr(e.attrs, 'tool') ?? '';
    const surface = attr(e.attrs, 'surface') ?? '';
    if (!tool) warnings.push('evidence entry missing tool attribute');
    else if (!isVerificationTool(tool)) {
      warnings.push(`evidence tool "${tool}" is not a known probe surface (cdp|xtui|tmux|scratch)`);
    }
    if (!surface) warnings.push('evidence entry missing surface attribute');
    const { body: obsBody, artifacts } = splitArtifacts(e.body);
    const observation = decodeEntities(obsBody).trim();
    if (!observation) warnings.push('evidence entry has empty observation');
    return { tool, surface, observation, artifacts };
  });

  const testsBlock = childBlock(body, 'tests');
  let tests: WorkerTests | undefined;
  if (testsBlock !== undefined) {
    const added = childText(testsBlock, 'added') ?? '';
    const updated = childText(testsBlock, 'updated') ?? '';
    const coverage = childText(testsBlock, 'coverage');
    tests = { added, updated, ...(coverage !== undefined ? { coverage } : {}) };
  }

  const issuesBlock = childBlock(body, 'discovered_issues');
  if (!issuesBlock) {
    warnings.push('missing <discovered_issues>');
  }
  const discoveredIssues = issuesBlock !== undefined
    ? children(issuesBlock, 'issue').map(i => {
        const rawBody = i.body;
        const suggestedFix = childText(rawBody, 'suggested_fix');
        const descBody = suggestedFix !== undefined
          ? rawBody.replace(/<suggested_fix\b[^>]*>[\s\S]*?<\/suggested_fix>/i, '')
          : rawBody;
        const severity = attr(i.attrs, 'severity') ?? '';
        if (!severity) warnings.push('issue missing severity attribute');
        else if (!isWorkerIssueSeverity(severity)) {
          warnings.push(`issue has invalid severity "${severity}" (blocking|non_blocking)`);
        }
        return {
          severity,
          description: clean(descBody) || '',
          ...(suggestedFix !== undefined ? { suggestedFix } : {}),
        };
      })
    : [];

  if (status === 'blocked' && !needs) {
    warnings.push('status is blocked but <needs> is empty');
  }

  const report: WorkerReport = {
    status,
    salientSummary,
    whatWasImplemented,
    whatWasLeftUndone,
    verification: { commandsRun, evidence },
    ...(tests ? { tests } : {}),
    discoveredIssues,
    ...(needs ? { needs } : {}),
  };

  return { ok: true, block, report, warnings };
}

/** Extract only the last complete <worker_report> block (for stdout echo). */
export function extractWorkerReportBlock(response: string): string | undefined {
  const matches = [...response.matchAll(WORKER_REPORT_RE)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][0];
}

