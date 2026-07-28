import { describe, expect, test } from 'bun:test';
import { deepConfigToCliOptions } from '../../src/cli/adapter';
import type { DeepConfig } from '../../src/cli/types';

function makeDeepConfig(solver: DeepConfig['stages']['solver']): DeepConfig {
  return {
    session: 'test',
    prompt: 'task',
    k: 3,
    context: { useSelection: false, adhocFiles: [] },
    output: { format: 'text' },
    verify: { enabled: true, forced: false },
    stages: {
      solver,
      judge: { backend: 'codex', model: 'gpt-5.3-codex' },
      verifier: { backend: 'codex', model: 'gpt-5.3-codex' },
      revision: { backend: 'codex', model: 'gpt-5.3-codex' },
    },
    notify: false,
  };
}

describe('deepConfigToCliOptions — listed mode', () => {
  test('maps slots to CliOptions.solverSlots and leaves single-shape knobs unset', () => {
    const config = makeDeepConfig({
      mode: 'listed',
      slots: [
        { backend: 'codex', model: 'gpt-5.6-sol', reasoning: 'max' },
        { backend: 'pi', model: 'pi/neuralwatt/kimi-k3', reasoning: 'high' },
        { backend: 'droid', model: 'claude-fable-5', reasoning: 'medium' },
      ],
    });

    const options = deepConfigToCliOptions(config);

    expect(options.solverSlots).toEqual([
      { backend: 'codex', model: 'gpt-5.6-sol', reasoning: 'max' },
      { backend: 'pi', model: 'pi/neuralwatt/kimi-k3', reasoning: 'high' },
      { backend: 'droid', model: 'claude-fable-5', reasoning: 'medium' },
    ]);
    expect(options.solverBackend).toBeUndefined();
    expect(options.solverModel).toBeUndefined();
    expect(options.distributeSolvers).toBeUndefined();
    expect(options.solverBackends).toBeUndefined();
  });

  test('distributed mode unchanged (no solverSlots)', () => {
    const config = makeDeepConfig({
      mode: 'distributed',
      backends: ['codex', 'pi'],
      modelPerBackend: new Map([['codex', 'gpt-5.3-codex'], ['pi', 'kimi-k3']]),
    });

    const options = deepConfigToCliOptions(config);

    expect(options.solverSlots).toBeUndefined();
    expect(options.distributeSolvers).toBe(true);
    expect(options.solverBackends).toEqual(['codex', 'pi']);
  });
});
