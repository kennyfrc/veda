import { describe, expect, test } from 'bun:test';
import { resolveVerifyConfig } from '../../src/cli/resolve';
import { detectConflicts } from '../../src/cli/validate';
import { CliValidationError } from '../../src/cli/types';

type Flags = Parameters<typeof detectConflicts>[0];

function flags(overrides: Partial<Flags> = {}): Flags {
  return {
    session: 'default',
    files: [],
    noSel: false,
    json: false,
    deep: false,
    noVerify: false,
    forceVerify: false,
    uniform: false,
    lowCountModules: false,
    statsModule: false,
    statsCategory: false,
    statsModel: false,
    statsJudge: false,
    help: false,
    version: false,
    dryRun: false,
    noTools: false,
    ...overrides,
  };
}

describe('resolveVerifyConfig (verifier off by default)', () => {
  test('defaults to disabled (verifier + revision off)', () => {
    expect(resolveVerifyConfig(flags())).toEqual({ enabled: false });
  });

  test('--verify opts back in', () => {
    expect(resolveVerifyConfig(flags({ verify: true }))).toEqual({ enabled: true, forced: false });
  });

  test('--force-verify implies enabled + forced', () => {
    expect(resolveVerifyConfig(flags({ forceVerify: true }))).toEqual({ enabled: true, forced: true });
  });

  test('--no-verify stays disabled', () => {
    expect(resolveVerifyConfig(flags({ noVerify: true }))).toEqual({ enabled: false });
  });

  test('--verify with --force-verify enables + forces', () => {
    expect(resolveVerifyConfig(flags({ verify: true, forceVerify: true }))).toEqual({ enabled: true, forced: true });
  });

  test('--verify and --no-verify conflict', () => {
    expect(() => detectConflicts(flags({ verify: true, noVerify: true }))).toThrow(CliValidationError);
  });

  test('--no-verify and --force-verify still conflict', () => {
    expect(() => detectConflicts(flags({ noVerify: true, forceVerify: true }))).toThrow(CliValidationError);
  });

  test('--verify and --force-verify do not conflict', () => {
    expect(() => detectConflicts(flags({ verify: true, forceVerify: true }))).not.toThrow();
  });
});
