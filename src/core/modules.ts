export type ModuleCategory =
  | 'analytical'
  | 'creative'
  | 'systematic'
  | 'strategic'
  | 'evaluative'
  | 'contextual'
  | 'empirical'
  | 'reflective';

export interface ReasoningModule {
  id: string;
  category: ModuleCategory;
  name: string;
  prompt: string;
}

export interface ModuleRegistry {
  modules: ReasoningModule[];
  byId: Record<string, ReasoningModule>;
  byCategory: Record<ModuleCategory, ReasoningModule[]>;
  allCategories: ModuleCategory[];
}

export interface SelectModulesOptions {
  k: number;
  categories?: string[];
  modules?: string[];
  registry?: ModuleRegistry; // Optional custom registry
}

// Default module catalog - 32 modules across 8 categories
const DEFAULT_MODULES: ReasoningModule[] = [
  {
    id: 'critical_thinking',
    category: 'analytical',
    name: 'Critical Thinking',
    prompt: 'Use critical thinking: Analyze from different perspectives, question assumptions, evaluate evidence, and identify potential biases or flaws in reasoning.',
  },
  {
    id: 'assumption_analysis',
    category: 'analytical',
    name: 'Assumption Analysis',
    prompt: 'Identify and examine the key assumptions underlying this problem. What must be true for this to work?',
  },
  {
    id: 'causal_analysis',
    category: 'analytical',
    name: 'Causal Analysis',
    prompt: 'Analyze the underlying causes and factors contributing to this problem. What is driving this?',
  },
  {
    id: 'core_issue',
    category: 'analytical',
    name: 'Core Issue Identification',
    prompt: 'Cut through complexity to identify the core issue that needs to be addressed. What is the real problem here?',
  },

  {
    id: 'creative_thinking',
    category: 'creative',
    name: 'Creative Thinking',
    prompt: 'Use creative thinking: Generate innovative, out-of-the-box ideas. Explore unconventional solutions beyond traditional boundaries.',
  },
  {
    id: 'novel_solution',
    category: 'creative',
    name: 'Novel Solution',
    prompt: 'Ignoring any existing solutions, create an entirely new approach to this problem from first principles.',
  },
  {
    id: 'radical_rethinking',
    category: 'creative',
    name: 'Radical Rethinking',
    prompt: 'Imagine the obvious solution is completely wrong. What other ways are there to think about this problem?',
  },
  {
    id: 'alternative_perspectives',
    category: 'creative',
    name: 'Alternative Perspectives',
    prompt: 'Consider alternative perspectives and viewpoints. How would different stakeholders or experts see this problem?',
  },

  {
    id: 'problem_decomposition',
    category: 'systematic',
    name: 'Problem Decomposition',
    prompt: 'Break down this problem into smaller, more manageable parts. Solve each part systematically.',
  },
  {
    id: 'step_by_step',
    category: 'systematic',
    name: 'Step by Step',
    prompt: 'Think step by step, showing your reasoning clearly at each stage.',
  },
  {
    id: 'simplification',
    category: 'systematic',
    name: 'Simplification',
    prompt: 'How can this problem be simplified to make it easier to solve? Remove unnecessary complexity.',
  },
  {
    id: 'systems_thinking',
    category: 'systematic',
    name: 'Systems Thinking',
    prompt: 'Consider this problem as part of a larger system. Identify interconnections, feedback loops, and dependencies.',
  },

  {
    id: 'iterative_solving',
    category: 'strategic',
    name: 'Iterative Solving',
    prompt: 'Generate multiple solution ideas, then apply them one by one to see which makes progress.',
  },
  {
    id: 'typical_solutions',
    category: 'strategic',
    name: 'Typical Solutions',
    prompt: 'What solutions are typically produced for this kind of problem? Start from established patterns.',
  },
  {
    id: 'solution_modification',
    category: 'strategic',
    name: 'Solution Modification',
    prompt: 'Given what you know about this problem type, what is the best way to modify or improve an initial solution?',
  },
  {
    id: 'planning',
    category: 'strategic',
    name: 'Planning',
    prompt: 'Create a step-by-step plan before implementing. Structure your approach with clear milestones.',
  },

  {
    id: 'risk_assessment',
    category: 'evaluative',
    name: 'Risk Assessment',
    prompt: 'What are the potential risks and drawbacks of each solution? What could go wrong?',
  },
  {
    id: 'obstacle_identification',
    category: 'evaluative',
    name: 'Obstacle Identification',
    prompt: 'What obstacles or challenges might arise in solving this problem? Plan for them.',
  },
  {
    id: 'tradeoff_analysis',
    category: 'evaluative',
    name: 'Tradeoff Analysis',
    prompt: 'Evaluate the tradeoffs between different approaches. What do you gain and lose with each option?',
  },
  {
    id: 'long_term_implications',
    category: 'evaluative',
    name: 'Long-term Implications',
    prompt: 'Consider the long-term implications of this problem and its solutions. What happens over time?',
  },

  {
    id: 'stakeholder_analysis',
    category: 'contextual',
    name: 'Stakeholder Analysis',
    prompt: 'Who is affected by this problem? What are their perspectives and needs?',
  },
  {
    id: 'resource_analysis',
    category: 'contextual',
    name: 'Resource Analysis',
    prompt: 'What resources (time, money, people, technology) are needed? What constraints exist?',
  },
  {
    id: 'constraints',
    category: 'contextual',
    name: 'Constraints',
    prompt: 'What physical, technical, or organizational constraints apply to this problem?',
  },
  {
    id: 'behavioral_factors',
    category: 'contextual',
    name: 'Behavioral Factors',
    prompt: 'Are there human behavioral factors (social, cultural, psychological) that affect this problem?',
  },

  {
    id: 'experimental_design',
    category: 'empirical',
    name: 'Experimental Design',
    prompt: 'How could you devise an experiment or test to validate your solution?',
  },
  {
    id: 'historical_analysis',
    category: 'empirical',
    name: 'Historical Analysis',
    prompt: 'Have similar solutions been tried before? What were the outcomes and lessons learned?',
  },
  {
    id: 'data_analysis',
    category: 'empirical',
    name: 'Data Analysis',
    prompt: 'What data or evidence can provide insights? How should it be analyzed?',
  },
  {
    id: 'progress_measurement',
    category: 'empirical',
    name: 'Progress Measurement',
    prompt: 'How can progress toward solving this problem be measured? What metrics matter?',
  },

  {
    id: 'reflective_thinking',
    category: 'reflective',
    name: 'Reflective Thinking',
    prompt: 'Step back and examine your own reasoning. What biases or assumptions might be influencing your approach?',
  },
  {
    id: 'success_metrics',
    category: 'reflective',
    name: 'Success Metrics',
    prompt: 'How will you know if the solution is successful? Define clear success criteria.',
  },
  {
    id: 'decision_making',
    category: 'reflective',
    name: 'Decision Making',
    prompt: 'This involves decision-making under uncertainty. How should you handle competing objectives?',
  },
  {
    id: 'collaborative_thinking',
    category: 'reflective',
    name: 'Collaborative Thinking',
    prompt: 'Consider diverse perspectives and expertise. What would different experts contribute?',
  },
];


// Fixed ontology - 8 categories for solver diversity
export const ALL_CATEGORIES: ModuleCategory[] = [
  'analytical',
  'creative',
  'systematic',
  'strategic',
  'evaluative',
  'contextual',
  'empirical',
  'reflective',
];

/**
 * Create a module registry from a list of custom modules (optional).
 * Defaults to DEFAULT_MODULES if no modules provided.
 * Validates: unique IDs, valid categories.
 */
export function createModuleRegistry(customModules?: ReasoningModule[]): ModuleRegistry {
  const modules = customModules ? [...customModules] : [...DEFAULT_MODULES];

  // Normalize IDs
  for (const module of modules) {
    module.id = normalizeId(module.id);
  }

  // Validate integrity
  validateModuleIntegrity(modules);

  // Derive lookups
  const byId: Record<string, ReasoningModule> = {};
  const byCategory: Record<ModuleCategory, ReasoningModule[]> = {} as any;

  for (const cat of ALL_CATEGORIES) {
    byCategory[cat] = [];
  }

  for (const module of modules) {
    byId[module.id] = module;
    if (!byCategory[module.category]) {
      byCategory[module.category] = [];
    }
    byCategory[module.category].push(module);
  }

  return {
    modules,
    byId,
    byCategory,
    allCategories: ALL_CATEGORIES,
  };
}

/**
 * Default registry singleton - uses DEFAULT_MODULES
 */
export const DEFAULT_REGISTRY: ModuleRegistry = createModuleRegistry();

/**
 * Backward compatibility exports (aliases to default registry)
 */
export const REASONING_MODULES = DEFAULT_REGISTRY.modules;
export const MODULES_BY_CATEGORY = DEFAULT_REGISTRY.byCategory;
export const MODULE_BY_ID = DEFAULT_REGISTRY.byId;

/**
 * Validate module integrity: unique IDs, valid categories
 */
function validateModuleIntegrity(modules: ReasoningModule[]): void {
  const ids = new Set<string>();
  const knownCategories = new Set(ALL_CATEGORIES);

  for (const module of modules) {
    // Check unique ID
    if (ids.has(module.id)) {
      throw new Error(`Duplicate module ID: ${module.id}`);
    }
    ids.add(module.id);

    // Check valid category
    if (!knownCategories.has(module.category)) {
      throw new Error(
        `Invalid category '${module.category}' for module '${module.id}'. ` +
        `Available: ${ALL_CATEGORIES.join(', ')}`
      );
    }
  }
}


export function selectModules(options: SelectModulesOptions): ReasoningModule[] {
  const { k, categories, modules, registry = DEFAULT_REGISTRY } = options;

  // Validate k
  if (k < 1 || k > 8) {
    throw new Error(`k must be between 1 and 8, got ${k}`);
  }

  // Case 1: Exact modules specified
  if (modules && modules.length > 0) {
    return selectExactModules(modules, registry);
  }

  // Case 2: Categories specified
  if (categories && categories.length > 0) {
    return selectFromCategories(k, categories, registry);
  }

  // Case 3: Default - sample k categories, 1 module each
  return selectDefault(k, registry);
}

function selectExactModules(moduleIds: string[], registry: ModuleRegistry): ReasoningModule[] {
  const normalized = moduleIds.map(normalizeId);
  const result: ReasoningModule[] = [];
  const seenCategories = new Set<ModuleCategory>();

  for (const id of normalized) {
    const module = registry.byId[id];
    if (!module) {
      throw new Error(
        `Unknown module: ${id}. Available: ${Object.keys(registry.byId).join(', ')}. ` +
        `Note: Custom modules must be provided via createModuleRegistry()`
      );
    }
    if (seenCategories.has(module.category)) {
      throw new Error(`Duplicate category: ${module.category}. Each solver must use a different category.`);
    }
    seenCategories.add(module.category);
    result.push(module);
  }

  if (result.length > 8) {
    throw new Error(`Too many modules: ${result.length}. Maximum is 8 (one per category).`);
  }

  return result;
}

function selectFromCategories(k: number, categoryNames: string[], registry: ModuleRegistry): ReasoningModule[] {
  const normalized = categoryNames.map(normalizeId) as ModuleCategory[];

  // Validate categories and canonicalize (dedupe, preserve order)
  const validatedCategories = validateAndCanonicalizeCategories(normalized, registry.allCategories);

  // Check we have enough categories
  const maxAvailable = validatedCategories.reduce((sum, cat) => {
    return sum + (registry.byCategory[cat]?.length ?? 0);
  }, 0);

  if (k > maxAvailable) {
    throw new Error(
      `Cannot select ${k} modules from ${validatedCategories.length} categories (max ${maxAvailable})`
    );
  }

  // Determine counts per category (round-robin distribution)
  const categoryCounts = distributeKAcrossCategories(k, validatedCategories, registry);

  // Sample modules from each category based on counts
  const result: ReasoningModule[] = [];
  for (const [cat, count] of categoryCounts) {
    const categoryModules = registry.byCategory[cat];
    if (categoryModules && categoryModules.length > 0) {
      const selected = randomSample(categoryModules, count);
      result.push(...selected);
    }
  }

  return shuffle(result);
}

function selectDefault(k: number, registry: ModuleRegistry): ReasoningModule[] {
  // Sample k categories, 1 module from each
  const selectedCategories = randomSample(registry.allCategories, k);

  return selectedCategories.map(cat => {
    const modules = registry.byCategory[cat];
    const randomIndex = Math.floor(Math.random() * modules.length);
    return modules[randomIndex];
  });
}

/**
 * Validate and canonicalize category names:
 * - Validate all categories are known
 * - Remove duplicates (keep first occurrence)
 * - Preserve user order
 */
function validateAndCanonicalizeCategories(
  categories: ModuleCategory[],
  allCategories: ModuleCategory[]
): ModuleCategory[] {
  const knownSet = new Set(allCategories);
  const result: ModuleCategory[] = [];

  for (const cat of categories) {
    if (!knownSet.has(cat)) {
      throw new Error(
        `Unknown category: ${cat}. Available: ${allCategories.join(', ')}`
      );
    }
    if (!result.includes(cat)) {
      result.push(cat);
    }
  }

  return result;
}

/**
 * Distribute k across categories using round-robin.
 * Returns Map<category, count>.
 */
function distributeKAcrossCategories(
  k: number,
  categories: ModuleCategory[],
  registry: ModuleRegistry
): Map<ModuleCategory, number> {
  const counts = new Map<ModuleCategory, number>();

  // Initialize all counts to 0
  for (const cat of categories) {
    counts.set(cat, 0);
  }

  // Round-robin assignment, respecting category availability
  let remaining = k;
  while (remaining > 0) {
    for (const cat of categories) {
      if (remaining === 0) break;
      const count = counts.get(cat)!;
      const available = registry.byCategory[cat]?.length ?? 0;
      if (count < available) {
        counts.set(cat, count + 1);
        remaining--;
      }
    }
  }

  return counts;
}


function normalizeId(id: string): string {
  return id.toLowerCase().trim().replace(/-/g, '_');
}

function randomSample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  
  return result;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
