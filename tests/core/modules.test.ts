import { describe, test, expect } from 'bun:test';
import {
  selectModules,
  REASONING_MODULES,
  ALL_CATEGORIES,
  MODULES_BY_CATEGORY,
  MODULE_BY_ID,
  createModuleRegistry,
  DEFAULT_REGISTRY,
  getModuleById,
} from '../../src/core/modules';

describe('Reasoning Modules', () => {
  describe('catalog', () => {
    test('has 43 modules across 9 categories', () => {
      expect(REASONING_MODULES.length).toBe(43);
    });

    test('has 9 categories', () => {
      expect(ALL_CATEGORIES.length).toBe(9);
    });

    test('each category has 2-7 modules', () => {
      for (const cat of ALL_CATEGORIES) {
        const count = MODULES_BY_CATEGORY[cat].length;
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count).toBeLessThanOrEqual(7);
      }
    });

    test('all modules have required fields', () => {
      for (const m of REASONING_MODULES) {
        expect(m.id).toBeTruthy();
        expect(m.category).toBeTruthy();
        expect(m.name).toBeTruthy();
        expect(m.prompt).toBeTruthy();
        expect(ALL_CATEGORIES).toContain(m.category);
      }
    });

    test('module IDs are unique', () => {
      const ids = REASONING_MODULES.map(m => m.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    test('new physics/estimation modules exist', () => {
      expect(MODULE_BY_ID['fermi_estimation']).toBeDefined();
      expect(MODULE_BY_ID['fermi_estimation'].category).toBe('empirical');
      
      expect(MODULE_BY_ID['limiting_case']).toBeDefined();
      expect(MODULE_BY_ID['limiting_case'].category).toBe('analytical');
      
      expect(MODULE_BY_ID['thought_experiment']).toBeDefined();
      expect(MODULE_BY_ID['thought_experiment'].category).toBe('creative');
    });

    test('new strategic/systems modules exist', () => {
      expect(MODULE_BY_ID['premortem']).toBeDefined();
      expect(MODULE_BY_ID['premortem'].category).toBe('evaluative');
      
      expect(MODULE_BY_ID['leverage_points']).toBeDefined();
      expect(MODULE_BY_ID['leverage_points'].category).toBe('systematic');
      
      expect(MODULE_BY_ID['contradiction_resolution']).toBeDefined();
      expect(MODULE_BY_ID['contradiction_resolution'].category).toBe('strategic');
    });

    test('debugging modules exist in debugging category', () => {
      expect(MODULE_BY_ID['binary_search_debug']).toBeDefined();
      expect(MODULE_BY_ID['binary_search_debug'].category).toBe('debugging');
      
      expect(MODULE_BY_ID['print_debugging']).toBeDefined();
      expect(MODULE_BY_ID['print_debugging'].category).toBe('debugging');
      
      expect(MODULE_BY_ID['simplify_the_problem']).toBeDefined();
      expect(MODULE_BY_ID['simplify_the_problem'].category).toBe('systematic');
    });

    test('scenario_planning module exists', () => {
      expect(MODULE_BY_ID['scenario_planning']).toBeDefined();
      expect(MODULE_BY_ID['scenario_planning'].category).toBe('strategic');
    });
  });

  describe('selectModules', () => {
    test('default: k modules from k categories', () => {
      const result = selectModules({ k: 3 });
      expect(result.length).toBe(3);
      
      // Each from different category
      const categories = new Set(result.map(m => m.category));
      expect(categories.size).toBe(3);
    });

    test('k=8 uses all categories', () => {
      const result = selectModules({ k: 8 });
      expect(result.length).toBe(8);
      
      const categories = new Set(result.map(m => m.category));
      expect(categories.size).toBe(8);
    });

    test('exact modules: uses specified modules', () => {
      const result = selectModules({
        k: 5, // ignored
        modules: ['critical_thinking', 'issue_tree'],
      });
      
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('critical_thinking');
      expect(result[1].id).toBe('issue_tree');
    });

    test('exact modules: errors on unknown module', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['unknown_module'],
      })).toThrow(/Unknown module/);
    });

    test('exact modules: errors on duplicate category', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['critical_thinking', 'assumption_analysis'], // both analytical
      })).toThrow(/Duplicate category/);
    });

    test('category/module format: exact module selection', () => {
      const result = selectModules({
        k: 3,
        modules: ['analytical/so_what_test', 'creative/invert_the_problem'],
      });
      
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('so_what_test');
      expect(result[0].category).toBe('analytical');
      expect(result[1].id).toBe('invert_the_problem');
      expect(result[1].category).toBe('creative');
    });

    test('category/module format: random from category', () => {
      const result = selectModules({
        k: 3,
        modules: ['analytical', 'creative', 'systematic'],
      });
      
      expect(result.length).toBe(3);
      expect(result.some(m => m.category === 'analytical')).toBe(true);
      expect(result.some(m => m.category === 'creative')).toBe(true);
      expect(result.some(m => m.category === 'systematic')).toBe(true);
    });

    test('category/module format: mixed exact and random', () => {
      const result = selectModules({
        k: 3,
        modules: ['analytical/so_what_test', 'creative', 'systematic/mece_decomposition'],
      });
      
      expect(result.length).toBe(3);
      expect(result[0].id).toBe('so_what_test');
      expect(result[1].category).toBe('creative'); // random from creative
      expect(result[2].id).toBe('mece_decomposition');
    });

    test('category/module format: errors on wrong category', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['analytical/invert_the_problem'], // invert_the_problem is creative
      })).toThrow(/belongs to 'creative', not 'analytical'/);
    });

    test('category/module format: errors on unknown category', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['unknown_category/some_module'],
      })).toThrow(/Unknown category 'unknown_category'/);
    });

    test('category/module format: errors on unknown module in category', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['analytical/unknown_module'],
      })).toThrow(/Unknown module 'unknown_module' in category 'analytical'/);
    });

    test('category/module format: errors on empty module_id', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['analytical/'],
      })).toThrow(/Missing module_id in specifier/);
    });

    test('category/module format: errors on multiple slashes', () => {
      expect(() => selectModules({
        k: 1,
        modules: ['analytical/so_what_test/extra'],
      })).toThrow(/too many slashes/);
    });

    test('legacy module IDs are aliased to new IDs', () => {
      // step_by_step was renamed to issue_tree
      const result = selectModules({
        k: 1,
        modules: ['step_by_step'],
      });
      expect(result[0].id).toBe('issue_tree');
    });

    test('legacy module IDs work with category/id format', () => {
      // problem_decomposition was renamed to mece_decomposition
      const result = selectModules({
        k: 1,
        modules: ['systematic/problem_decomposition'],
      });
      expect(result[0].id).toBe('mece_decomposition');
    });

    test('categories: distributes k across specified categories', () => {
      const result = selectModules({
        k: 4,
        categories: ['analytical', 'creative'],
      });
      
      expect(result.length).toBe(4);
      
      const analyticalCount = result.filter(m => m.category === 'analytical').length;
      const creativeCount = result.filter(m => m.category === 'creative').length;
      expect(analyticalCount).toBe(2);
      expect(creativeCount).toBe(2);
    });

    test('categories: single category with k > 1', () => {
      const result = selectModules({
        k: 3,
        categories: ['systematic'],
      });
      
      expect(result.length).toBe(3);
      expect(result.every(m => m.category === 'systematic')).toBe(true);
      
      // All different modules
      const ids = new Set(result.map(m => m.id));
      expect(ids.size).toBe(3);
    });

    test('errors on k > 8', () => {
      expect(() => selectModules({ k: 9 })).toThrow(/must be between 1 and 8/);
    });

    test('errors on k < 1', () => {
      expect(() => selectModules({ k: 0 })).toThrow(/must be between 1 and 8/);
    });

    test('errors on unknown category', () => {
      expect(() => selectModules({
        k: 1,
        categories: ['unknown_category'],
      })).toThrow(/Unknown category/);
    });

    test('normalizes IDs (lowercase, underscore)', () => {
      const result = selectModules({
        k: 1,
        modules: ['Critical-Thinking'], // mixed case, hyphen
      });
      expect(result[0].id).toBe('critical_thinking');
    });
  });
});

describe('ModuleRegistry (additive design)', () => {
  test('creates default registry from DEFAULT_MODULES', () => {
    const registry = createModuleRegistry();
    expect(registry.modules.length).toBe(43);
    expect(registry.allCategories.length).toBe(9);
  });

  test('creates custom registry with injected modules', () => {
    const customModules = [
      {
        id: 'custom_module',
        category: 'analytical' as const,
        name: 'Custom Module',
        prompt: 'This is a custom module',
      },
    ];

    const registry = createModuleRegistry(customModules);
    expect(registry.modules).toHaveLength(1);
    expect(registry.byId['custom_module']).toBeDefined();
    expect(registry.byCategory['analytical']).toHaveLength(1);
  });

  test('creates custom registry combining default and custom', () => {
    const customModules = [
      ...selectModules({ k: 2 }).slice(0, 2), // Take 2 default modules
      {
        id: 'my_custom_module',
        category: 'creative' as const,
        name: 'My Custom',
        prompt: 'Custom prompt',
      },
    ];

    const registry = createModuleRegistry(customModules);
    expect(registry.modules).toHaveLength(3);
    expect(registry.byId['my_custom_module']).toBeDefined();
  });

  test('normalizes IDs in custom registry', () => {
    const customModules = [
      {
        id: 'Custom-Module-ID', // mixed case and hyphen
        category: 'systematic' as const,
        name: 'Custom',
        prompt: 'Prompt',
      },
    ];

    const registry = createModuleRegistry(customModules);
    expect(registry.modules[0].id).toBe('custom_module_id');
    expect(registry.byId['custom_module_id']).toBeDefined();
  });

  test('selectModules can use custom registry', () => {
    const customModules = [
      {
        id: 'custom_one',
        category: 'analytical' as const,
        name: 'Custom One',
        prompt: 'Prompt one',
      },
      {
        id: 'custom_two',
        category: 'creative' as const,
        name: 'Custom Two',
        prompt: 'Prompt two',
      },
    ];

    const registry = createModuleRegistry(customModules);

    // Should select from custom registry
    const result = selectModules({
      k: 1,
      modules: ['custom_one'],
      registry,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('custom_one');
  });

  test('allows extending existing modules', () => {
    // Start with default modules, add a custom one in a new category
    const existingModules = selectModules({ k: 8 }); // One from each category
    const customModules = [
      ...existingModules,
      {
        id: 'additional_analytical',
        category: 'analytical' as const,
        name: 'Additional Analytical',
        prompt: 'Another analytical module',
      },
    ];

    const registry = createModuleRegistry(customModules);
    expect(registry.byCategory['analytical']).toHaveLength(2); // Original 1 + custom 1
  });

  test('throws on duplicate module IDs in custom registry', () => {
    const customModules = [
      {
        id: 'duplicate_id',
        category: 'analytical' as const,
        name: 'First',
        prompt: 'First',
      },
      {
        id: 'duplicate_id', // Same ID
        category: 'creative' as const,
        name: 'Second',
        prompt: 'Second',
      },
    ];

    expect(() => createModuleRegistry(customModules)).toThrow('Duplicate module ID: duplicate_id');
  });

  test('throws on invalid category in custom module', () => {
    const customModules = [
      {
        id: 'bad_category',
        category: 'invalid_category' as const,
        name: 'Bad',
        prompt: 'Prompt',
      },
    ];

    expect(() => createModuleRegistry(customModules)).toThrow("Invalid category 'invalid_category'");
  });

  test('DEFAULT_REGISTRY is a singleton using DEFAULT_MODULES', () => {
    expect(DEFAULT_REGISTRY.modules).toHaveLength(43);
    expect(DEFAULT_REGISTRY.allCategories).toHaveLength(9);

    // Verify backward compatibility aliases work
    expect(REASONING_MODULES).toBe(DEFAULT_REGISTRY.modules);
    expect(MODULES_BY_CATEGORY).toBe(DEFAULT_REGISTRY.byCategory);
    expect(MODULE_BY_ID).toBe(DEFAULT_REGISTRY.byId);
  });
});

describe('getModuleById', () => {
  test('returns module when found', () => {
    const module = getModuleById('critical_thinking');
    expect(module).toBeDefined();
    expect(module?.id).toBe('critical_thinking');
    expect(module?.category).toBe('analytical');
    expect(module?.prompt).toBeTruthy();
  });

  test('returns undefined when not found', () => {
    const module = getModuleById('nonexistent_module');
    expect(module).toBeUndefined();
  });

  test('is case-sensitive (normalized IDs are lowercase)', () => {
    // Module IDs in registry are normalized to lowercase
    const lower = getModuleById('critical_thinking');
    expect(lower).toBeDefined();
    
    // Mixed case won't match
    const mixed = getModuleById('Critical_Thinking');
    expect(mixed).toBeUndefined();
  });
});
