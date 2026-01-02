export type ModuleCategory =
  | 'analytical'
  | 'creative'
  | 'systematic'
  | 'strategic'
  | 'evaluative'
  | 'contextual'
  | 'empirical'
  | 'debugging'
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

// Default module catalog - 44 modules across 9 categories
// Sources: Polya's "How to Solve It", Hamming's "Art of Doing Science and Engineering", McKinsey frameworks,
//          Fermi estimation, TRIZ inventive principles, Meadows' leverage points, Klein's premortem
const DEFAULT_MODULES: ReasoningModule[] = [
  // === ANALYTICAL (6) ===
  {
    id: 'critical_thinking',
    category: 'analytical',
    name: 'Critical Thinking',
    prompt: 'Analyze from multiple angles: question assumptions, evaluate evidence, and identify potential biases or flaws in reasoning.',
  },
  {
    id: 'assumption_analysis',
    category: 'analytical',
    name: 'Assumption Analysis',
    prompt: 'Identify and examine the key assumptions underlying this problem. What must be true for any solution to work?',
  },
  {
    id: 'causal_analysis',
    category: 'analytical',
    name: 'Causal Analysis',
    prompt: 'Trace the causal chain: What is driving this problem? Keep asking "why" until you reach root causes.',
  },
  {
    id: 'so_what_test',
    category: 'analytical',
    name: 'So What Test',
    prompt: 'For each observation, ask "So what?" Push every insight to its actionable implication. No finding without consequence.',
  },
  {
    id: 'eighty_twenty_focus',
    category: 'analytical',
    name: '80/20 Focus',
    prompt: 'Identify the vital few factors that drive most of the outcome. Focus on high-leverage areas; deprioritize the trivial many.',
  },
  {
    id: 'limiting_case',
    category: 'analytical',
    name: 'Limiting Case Analysis',
    prompt: 'Test your answer at extreme values: What happens when key variables go to zero, infinity, or hit boundaries? Does the solution behave correctly in these limits? Use extremes to validate or catch errors.',
  },

  // === CREATIVE (6) ===
  {
    id: 'creative_thinking',
    category: 'creative',
    name: 'Creative Thinking',
    prompt: 'Generate innovative, out-of-the-box ideas. Explore unconventional solutions beyond traditional boundaries.',
  },
  {
    id: 'novel_solution',
    category: 'creative',
    name: 'First Principles',
    prompt: 'Ignore existing solutions. Rebuild the solution from first principles—what would you design if starting from scratch?',
  },
  {
    id: 'radical_rethinking',
    category: 'creative',
    name: 'Radical Rethinking',
    prompt: 'Assume the obvious solution is wrong. What completely different approaches exist? Challenge the problem framing itself.',
  },
  {
    id: 'alternative_perspectives',
    category: 'creative',
    name: 'Alternative Perspectives',
    prompt: 'View this through different lenses: How would a beginner see it? An expert in another field? A critic? A user?',
  },
  {
    id: 'invert_the_problem',
    category: 'creative',
    name: 'Invert the Problem',
    prompt: 'Flip it around: Instead of solving X, ask what would make X impossible? What is the opposite of X? Solve that instead.',
  },
  {
    id: 'thought_experiment',
    category: 'creative',
    name: 'Thought Experiment',
    prompt: 'Construct an idealized hypothetical: remove friction, assume perfect information, take a variable to an extreme. Mentally simulate the scenario step by step. What does this reveal about the real problem?',
  },

  // === SYSTEMATIC (7) ===
  {
    id: 'mece_decomposition',
    category: 'systematic',
    name: 'MECE Decomposition',
    prompt: 'Divide this problem into parts that are mutually exclusive (no overlap) and collectively exhaustive (no gaps). Cover every possibility exactly once.',
  },
  {
    id: 'issue_tree',
    category: 'systematic',
    name: 'Issue Tree',
    prompt: 'Build a logic tree: break the main question into sub-questions, each sub-question into components. Solve the leaves, then synthesize upward.',
  },
  {
    id: 'vary_the_problem',
    category: 'systematic',
    name: 'Vary the Problem',
    prompt: 'Modify the problem: make it more general, more specific, or change one constraint. Solve the variant, then transfer insights back.',
  },
  {
    id: 'systems_thinking',
    category: 'systematic',
    name: 'Systems Thinking',
    prompt: 'Map this problem within its larger system. Identify interconnections, feedback loops, second-order effects, and dependencies.',
  },
  {
    id: 'working_backward',
    category: 'systematic',
    name: 'Working Backward',
    prompt: 'Start from the desired end state. What must be true immediately before the goal is achieved? Work backward step by step to the current state.',
  },
  {
    id: 'leverage_points',
    category: 'systematic',
    name: 'Leverage Points',
    prompt: 'Where would a small intervention produce disproportionately large effects? Look past obvious parameters to underlying rules, goals, and feedback structures. Find the trim tab—the small rudder that turns the big rudder.',
  },
  {
    id: 'simplify_the_problem',
    category: 'systematic',
    name: 'Simplify the Problem',
    prompt: 'Strip away complexity layer by layer. Remove components, reduce inputs, simplify the environment. Does the problem still occur? Find the minimal reproduction.',
  },

  // === STRATEGIC (6) ===
  {
    id: 'hypothesis_first',
    category: 'strategic',
    name: 'Hypothesis First',
    prompt: 'State a clear hypothesis about the answer before deep analysis. Use it to focus reasoning, then confirm or revise based on evidence.',
  },
  {
    id: 'analogical_transfer',
    category: 'strategic',
    name: 'Analogical Transfer',
    prompt: 'Identify a similar solved problem in any domain. Extract its method or structure and adapt it to this problem.',
  },
  {
    id: 'iterative_solving',
    category: 'strategic',
    name: 'Iterative Solving',
    prompt: 'Generate multiple candidate solutions. Test each against the problem constraints. Refine the most promising one.',
  },
  {
    id: 'solution_modification',
    category: 'strategic',
    name: 'Solution Modification',
    prompt: 'Take a partial or flawed solution. What minimal modifications would fix its weaknesses while preserving its strengths?',
  },
  {
    id: 'planning',
    category: 'strategic',
    name: 'Planning',
    prompt: 'Create a structured plan before solving: define milestones, sequence steps logically, identify dependencies between steps.',
  },
  {
    id: 'contradiction_resolution',
    category: 'strategic',
    name: 'Contradiction Resolution',
    prompt: 'Name the core tradeoff: two desirable properties that appear mutually exclusive. Then refuse the tradeoff—find a way to have both by separating them in time, space, scale, or condition.',
  },
  {
    id: 'scenario_planning',
    category: 'strategic',
    name: 'Scenario Planning',
    prompt: 'Construct 2-3 plausible future scenarios based on key uncertainties. What early signals would indicate each scenario? What decisions are robust across scenarios?',
  },

  // === EVALUATIVE (5) ===
  {
    id: 'risk_assessment',
    category: 'evaluative',
    name: 'Risk Assessment',
    prompt: 'What could go wrong? Identify failure modes, edge cases, and potential unintended consequences of each approach.',
  },
  {
    id: 'tradeoff_analysis',
    category: 'evaluative',
    name: 'Tradeoff Analysis',
    prompt: 'Evaluate tradeoffs explicitly: What do you gain and lose with each option? What is the cost of being wrong?',
  },
  {
    id: 'check_completeness',
    category: 'evaluative',
    name: 'Check Completeness',
    prompt: 'Verify: Have you used all the given information? Have you addressed the entire problem? What remains unaccounted for?',
  },
  {
    id: 'long_term_implications',
    category: 'evaluative',
    name: 'Long-term Implications',
    prompt: 'Project forward: What happens over time? Will this solution scale? What maintenance or evolution will it require?',
  },
  {
    id: 'premortem',
    category: 'evaluative',
    name: 'Premortem',
    prompt: 'It is one year later and this approach has failed completely. What went wrong? Write the postmortem now. Use this "prospective hindsight" to surface risks you would otherwise overlook.',
  },

  // === CONTEXTUAL (3) ===
  {
    id: 'stakeholder_analysis',
    category: 'contextual',
    name: 'Stakeholder Analysis',
    prompt: 'Who is affected by this problem and solution? What are their needs, incentives, and potential objections?',
  },
  {
    id: 'resource_constraints',
    category: 'contextual',
    name: 'Resource & Constraints',
    prompt: 'Map available resources (time, budget, skills, tools) against constraints (technical, organizational, physical). What boundaries shape the solution space?',
  },
  {
    id: 'behavioral_factors',
    category: 'contextual',
    name: 'Behavioral Factors',
    prompt: 'What human factors affect this problem? Consider habits, incentives, cognitive biases, and social dynamics.',
  },

  // === EMPIRICAL (5) ===
  {
    id: 'experimental_design',
    category: 'empirical',
    name: 'Experimental Design',
    prompt: 'How would you test this solution? Design a concrete experiment or validation that would prove or disprove it works.',
  },
  {
    id: 'historical_analysis',
    category: 'empirical',
    name: 'Historical Analysis',
    prompt: 'What similar problems have been solved before? Extract patterns from prior solutions and their outcomes.',
  },
  {
    id: 'data_driven',
    category: 'empirical',
    name: 'Data-Driven Analysis',
    prompt: 'What data or evidence bears on this problem? Identify key metrics, analyze patterns, and let evidence guide conclusions.',
  },
  {
    id: 'fermi_estimation',
    category: 'empirical',
    name: 'Fermi Estimation',
    prompt: 'Estimate unknown quantities by decomposing into factors you can guess. What 3-5 sub-quantities multiply to give the answer? Make rough estimates for each, multiply, and sanity-check the order of magnitude.',
  },
  {
    id: 'sanity_check',
    category: 'empirical',
    name: 'Sanity Check',
    prompt: 'Before accepting any answer, verify it against known reference points. Is the order of magnitude plausible? Does it pass the "smell test" compared to similar known quantities? What would have to be true for this answer to be wrong by 10x?',
  },

  // === DEBUGGING (2) ===
  {
    id: 'binary_search_debug',
    category: 'debugging',
    name: 'Binary Search Debugging',
    prompt: 'Divide the search space in half. Which half contains the problem? Repeat until isolated. Works for code, commits, inputs, or time—anywhere you can split and test.',
  },
  {
    id: 'print_debugging',
    category: 'debugging',
    name: 'Print Debugging',
    prompt: 'Create a minimal reproduction script in /tmp that imports the relevant modules. Add logging at every stage: print inputs, intermediate state, and outputs at each transformation. Run the script headlessly and trace how data changes step by step. Look for where actual values diverge from expected. Clean up the script after.',
  },

  // === REFLECTIVE (3) ===
  {
    id: 'reflective_thinking',
    category: 'reflective',
    name: 'Reflective Thinking',
    prompt: 'Step back and examine your reasoning process. Where might you be wrong? What are you not seeing?',
  },
  {
    id: 'success_criteria',
    category: 'reflective',
    name: 'Success Criteria',
    prompt: 'Define what success looks like concretely. What specific outcomes would indicate the problem is solved?',
  },
  {
    id: 'decision_under_uncertainty',
    category: 'reflective',
    name: 'Decision Under Uncertainty',
    prompt: 'Acknowledge what is unknown. How should you decide given incomplete information? What would change your mind?',
  },
];


// Fixed ontology - 9 categories for solver diversity
export const ALL_CATEGORIES: ModuleCategory[] = [
  'analytical',
  'creative',
  'systematic',
  'strategic',
  'evaluative',
  'contextual',
  'empirical',
  'debugging',
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
 * Look up a module by ID from the default registry.
 * Used for reconstructing module prompts on resume.
 * Returns undefined if module not found (e.g., if module catalog changed between runs).
 */
export function getModuleById(id: string): ReasoningModule | undefined {
  return DEFAULT_REGISTRY.byId[id];
}

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


/**
 * Select reasoning modules for the ensemble.
 * 
 * Module specifiers support three formats:
 * - `category/module_id` - exact module (e.g., "analytical/so_what_test")
 * - `category` - random module from category (e.g., "analytical")
 * - `module_id` - exact module by ID (legacy, e.g., "so_what_test")
 * 
 * Examples:
 *   modules: ['analytical/so_what_test', 'creative', 'systematic/mece_decomposition']
 *   modules: ['analytical', 'creative', 'systematic'] // random from each
 *   modules: ['so_what_test', 'invert_the_problem']   // legacy exact IDs
 */
export function selectModules(options: SelectModulesOptions): ReasoningModule[] {
  const { k, categories, modules, registry = DEFAULT_REGISTRY } = options;

  // Validate k
  if (k < 1 || k > 8) {
    throw new Error(`k must be between 1 and 8, got ${k}`);
  }

  // Case 1: Module specifiers provided (supports category/module format)
  if (modules && modules.length > 0) {
    return selectFromSpecifiers(modules, registry);
  }

  // Case 2: Categories specified (legacy, random module from each)
  if (categories && categories.length > 0) {
    return selectFromCategories(k, categories, registry);
  }

  // Case 3: Default - sample k categories, 1 module each
  return selectDefault(k, registry);
}

/**
 * Legacy module ID aliases - map old IDs to new ones for backward compatibility.
 */
const LEGACY_MODULE_ALIASES: Record<string, string> = {
  // Renamed modules
  'step_by_step': 'issue_tree',
  'problem_decomposition': 'mece_decomposition',
  'core_issue': 'so_what_test',
  'simplification': 'vary_the_problem',
  'typical_solutions': 'analogical_transfer',
  'obstacle_identification': 'risk_assessment',
  // Merged modules
  'constraints': 'resource_constraints',
  'resource_analysis': 'resource_constraints',
  'data_analysis': 'data_driven',
  'progress_measurement': 'success_criteria',
  'success_metrics': 'success_criteria',
  'decision_making': 'decision_under_uncertainty',
  'collaborative_thinking': 'alternative_perspectives',
};

/**
 * Parse a module specifier into category and optional module ID.
 * Formats:
 * - "category/module_id" → { category, moduleId }
 * - "category" (if valid category) → { category, moduleId: undefined }
 * - "module_id" (legacy) → { category: undefined, moduleId }
 */
function parseModuleSpecifier(
  specifier: string,
  registry: ModuleRegistry
): { category?: ModuleCategory; moduleId?: string } {
  const normalized = specifier.toLowerCase().trim().replace(/-/g, '_');
  
  // Check for category/module format
  if (normalized.includes('/')) {
    // Reject multiple slashes
    const slashCount = (normalized.match(/\//g) || []).length;
    if (slashCount > 1) {
      throw new Error(
        `Invalid specifier '${specifier}': too many slashes. ` +
        `Use format 'category/module_id' or 'category' or 'module_id'.`
      );
    }
    
    const [catPart, modPart] = normalized.split('/', 2);
    const category = catPart.trim() as ModuleCategory;
    const moduleId = modPart.trim();
    
    if (!registry.allCategories.includes(category)) {
      throw new Error(
        `Unknown category '${catPart}' in specifier '${specifier}'. ` +
        `Available: ${registry.allCategories.join(', ')}`
      );
    }
    
    // Check for empty module ID (e.g., "analytical/")
    if (!moduleId) {
      throw new Error(
        `Missing module_id in specifier '${specifier}'. ` +
        `Use 'category/module_id' for exact module or just 'category' for random selection.`
      );
    }
    
    // Apply legacy alias if needed
    const resolvedModuleId = LEGACY_MODULE_ALIASES[moduleId] ?? moduleId;
    
    return { category, moduleId: resolvedModuleId };
  }
  
  // Check if it's a valid category name (random selection from category)
  if (registry.allCategories.includes(normalized as ModuleCategory)) {
    return { category: normalized as ModuleCategory, moduleId: undefined };
  }
  
  // Apply legacy alias if needed
  const resolvedId = LEGACY_MODULE_ALIASES[normalized] ?? normalized;
  
  // Assume it's a legacy module ID
  return { category: undefined, moduleId: resolvedId };
}

function selectFromSpecifiers(specifiers: string[], registry: ModuleRegistry): ReasoningModule[] {
  const result: ReasoningModule[] = [];
  const seenCategories = new Set<ModuleCategory>();

  for (const specifier of specifiers) {
    const { category, moduleId } = parseModuleSpecifier(specifier, registry);
    
    let module: ReasoningModule | undefined;
    
    if (category && moduleId) {
      // Exact: category/module_id format
      module = registry.byId[moduleId];
      if (!module) {
        throw new Error(
          `Unknown module '${moduleId}' in category '${category}'. ` +
          `Available in ${category}: ${registry.byCategory[category].map(m => m.id).join(', ')}`
        );
      }
      if (module.category !== category) {
        throw new Error(
          `Module '${moduleId}' belongs to '${module.category}', not '${category}'`
        );
      }
    } else if (category) {
      // Random from category
      const categoryModules = registry.byCategory[category];
      if (!categoryModules || categoryModules.length === 0) {
        throw new Error(`No modules available in category '${category}'`);
      }
      const randomIndex = Math.floor(Math.random() * categoryModules.length);
      module = categoryModules[randomIndex];
    } else if (moduleId) {
      // Legacy: just module ID
      module = registry.byId[moduleId];
      if (!module) {
        throw new Error(
          `Unknown module: ${moduleId}. Available: ${Object.keys(registry.byId).join(', ')}`
        );
      }
    }
    
    if (!module) {
      throw new Error(`Invalid module specifier: ${specifier}`);
    }
    
    // Check for duplicate categories
    if (seenCategories.has(module.category)) {
      throw new Error(
        `Duplicate category '${module.category}'. Each solver must use a different category. ` +
        `Conflict at specifier: ${specifier}`
      );
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
