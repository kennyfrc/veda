import { describe, test, expect } from 'bun:test';
import {
  selectModules,
  REASONING_MODULES,
  ALL_CATEGORIES,
  MODULES_BY_CATEGORY,
  MODULE_BY_ID,
} from '../../src/primitives/self-discover';

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
