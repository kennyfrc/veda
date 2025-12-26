import { describe, test, expect } from 'bun:test';
import {
  selectModules,
  REASONING_MODULES,
  ALL_CATEGORIES,
  MODULES_BY_CATEGORY,
  MODULE_BY_ID,
  createModuleRegistry,
  DEFAULT_REGISTRY,
} from '../../src/core/modules';

describe('Reasoning Modules', () => {
  describe('catalog', () => {
    test('has 32 modules (8 categories × 4)', () => {
      expect(REASONING_MODULES.length).toBe(32);
    });

    test('has 8 categories', () => {
      expect(ALL_CATEGORIES.length).toBe(8);
    });

    test('each category has 4 modules', () => {
      for (const cat of ALL_CATEGORIES) {
        expect(MODULES_BY_CATEGORY[cat].length).toBe(4);
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
        modules: ['critical_thinking', 'step_by_step'],
      });
      
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('critical_thinking');
      expect(result[1].id).toBe('step_by_step');
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
    expect(registry.modules.length).toBe(32);
    expect(registry.allCategories.length).toBe(8);
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
    expect(DEFAULT_REGISTRY.modules).toHaveLength(32);
    expect(DEFAULT_REGISTRY.allCategories).toHaveLength(8);

    // Verify backward compatibility aliases work
    expect(REASONING_MODULES).toBe(DEFAULT_REGISTRY.modules);
    expect(MODULES_BY_CATEGORY).toBe(DEFAULT_REGISTRY.byCategory);
    expect(MODULE_BY_ID).toBe(DEFAULT_REGISTRY.byId);
  });
});
