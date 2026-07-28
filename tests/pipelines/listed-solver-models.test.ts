import { describe, expect, test } from 'bun:test';
import {
  planSolverModules,
  buildSolverMembers,
  type SolverOptions,
} from '../../src/pipelines/deep-think';
import { SOLVER_SYSTEM_PROMPT } from '../../src/pipelines/prompts';
import { getModuleById } from '../../src/core/modules';

const P = 'Design a rate limiter';

function makeSolver(overrides: Partial<SolverOptions>): SolverOptions {
  return {
    k: 3,
    backends: ['codex'],
    backendModels: new Map([['codex', 'gpt-5.3-codex']]),
    reasoning: 'high',
    sandbox: 'read-only',
    cwd: process.cwd(),
    ...overrides,
  };
}

describe('listed mode — uniform prompt', () => {
  const slots = [
    { backend: 'codex', model: 'gpt-5.6-sol', reasoning: 'max' as const },
    { backend: 'pi', model: 'pi/neuralwatt/kimi-k3', reasoning: 'high' as const },
    { backend: 'droid', model: 'claude-fable-5', reasoning: 'medium' as const },
  ];

  test('planReturnsNoModulesWhenUniform', () => {
    const solver = makeSolver({ slots, uniformPrompt: true });
    const planned = planSolverModules(solver);
    expect(planned).toEqual([undefined, undefined, undefined]);
  });

  test('every member gets the byte-identical SOLVER_SYSTEM_PROMPT (Invariant 1)', () => {
    const solver = makeSolver({ slots, uniformPrompt: true });
    const { members } = buildSolverMembers(P, solver, planSolverModules(solver));

    expect(members).toHaveLength(3);
    for (const m of members) {
      // No module injection: the exact plain prompt, and no Reasoning Approach section
      expect(m.request.systemPrompt).toBe(SOLVER_SYSTEM_PROMPT);
      expect(m.request.systemPrompt).not.toContain('Reasoning Approach');
      // Same user task for everyone
      expect(m.request.prompt).toBe(P);
    }
    // All three system prompts are literally the same string object
    expect(new Set(members.map(m => m.request.systemPrompt)).size).toBe(1);
  });

  test('per-slot backend/model/reasoning flow into the request; memberIds carry uniform/none', () => {
    const solver = makeSolver({ slots, uniformPrompt: true });
    const { members, metas } = buildSolverMembers(P, solver, planSolverModules(solver));

    expect(members.map(m => m.request.backend)).toEqual(['codex', 'pi', 'droid']);
    expect(members.map(m => m.request.model)).toEqual(['gpt-5.6-sol', 'pi/neuralwatt/kimi-k3', 'claude-fable-5']);
    expect(members.map(m => m.request.reasoning)).toEqual(['max', 'high', 'medium']);

    for (const m of members) {
      expect(m.id).toContain('-uniform/none');
    }
    expect(new Set(members.map(m => m.id)).size).toBe(3);
    expect(metas.map(m => m.module)).toEqual(['uniform/none', 'uniform/none', 'uniform/none']);
  });

  test('duplicate backends with distinct models stay distinct (sol + gpt both codex)', () => {
    const dupSlots = [
      { backend: 'codex', model: 'gpt-5.6-sol' },
      { backend: 'codex', model: 'gpt-5.3-codex' },
    ];
    const solver = makeSolver({ k: 2, slots: dupSlots, uniformPrompt: true });
    const { members } = buildSolverMembers(P, solver, planSolverModules(solver));

    expect(members.map(m => m.request.backend)).toEqual(['codex', 'codex']);
    expect(members.map(m => m.request.model)).toEqual(['gpt-5.6-sol', 'gpt-5.3-codex']);
    expect(members[0].id).not.toBe(members[1].id);
  });
});

describe('listed mode — zipped modules', () => {
  test('module i pairs with slot i positionally', () => {
    const slots = [
      { backend: 'codex', model: 'gpt-5.6-sol' },
      { backend: 'pi', model: 'pi/neuralwatt/kimi-k3' },
    ];
    const specifiers = ['analytical/causal_analysis', 'systematic/systems_thinking'];
    const solver = makeSolver({ k: 2, slots, modules: specifiers });
    const planned = planSolverModules(solver);

    expect(planned.map(m => m?.id)).toEqual(['causal_analysis', 'systems_thinking']);

    const { members } = buildSolverMembers(P, solver, planned);
    expect(members[0].request.systemPrompt).toContain(getModuleById('causal_analysis')!.prompt);
    expect(members[1].request.systemPrompt).toContain(getModuleById('systems_thinking')!.prompt);
    expect(members[0].id).toContain('analytical/causal_analysis');
    expect(members[1].id).toContain('systematic/systems_thinking');
    // Backends/models still come from slots
    expect(members.map(m => m.request.backend)).toEqual(['codex', 'pi']);
  });
});

describe('legacy module mode — unchanged', () => {
  test('no slots: round-robin backends and module-injected prompts', () => {
    const solver = makeSolver({
      backends: ['codex', 'pi'],
      backendModels: new Map([['codex', 'gpt-5.6'], ['pi', 'kimi-k3']]),
      modules: ['analytical/causal_analysis', 'empirical/fermi_estimation'],
    });
    const planned = planSolverModules(solver);
    const { members, metas } = buildSolverMembers(P, solver, planned);

    expect(members[0].request.backend).toBe('codex');
    expect(members[1].request.backend).toBe('pi');
    expect(members[0].request.model).toBe('gpt-5.6');
    expect(members[1].request.model).toBe('kimi-k3');
    expect(members[0].request.systemPrompt).toContain('Reasoning Approach');
    expect(members[1].request.systemPrompt).toContain('Reasoning Approach');
    expect(metas[0].module).toBe('analytical/causal_analysis');
    expect(metas[1].module).toBe('empirical/fermi_estimation');
  });
});
