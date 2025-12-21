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

export interface SelectModulesOptions {
  k: number;              // Max 8
  categories?: string[];  // Sample from these
  modules?: string[];     // Exact IDs (overrides k/categories)
}

export const REASONING_MODULES: ReasoningModule[] = [
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

export const MODULES_BY_CATEGORY: Record<ModuleCategory, ReasoningModule[]> = 
  ALL_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = REASONING_MODULES.filter(m => m.category === cat);
    return acc;
  }, {} as Record<ModuleCategory, ReasoningModule[]>);

export const MODULE_BY_ID: Record<string, ReasoningModule> =
  REASONING_MODULES.reduce((acc, m) => {
    acc[m.id] = m;
    return acc;
  }, {} as Record<string, ReasoningModule>);


export function selectModules(options: SelectModulesOptions): ReasoningModule[] {
  const { k, categories, modules } = options;

  // Validate k
  if (k < 1 || k > 8) {
    throw new Error(`k must be between 1 and 8, got ${k}`);
  }

  // Case 1: Exact modules specified
  if (modules && modules.length > 0) {
    return selectExactModules(modules);
  }

  // Case 2: Categories specified
  if (categories && categories.length > 0) {
    return selectFromCategories(k, categories);
  }

  // Case 3: Default - sample k categories, 1 module each
  return selectDefault(k);
}

function selectExactModules(moduleIds: string[]): ReasoningModule[] {
  const normalized = moduleIds.map(normalizeId);
  const result: ReasoningModule[] = [];
  const seenCategories = new Set<ModuleCategory>();

  for (const id of normalized) {
    const module = MODULE_BY_ID[id];
    if (!module) {
      throw new Error(`Unknown module: ${id}. Available: ${Object.keys(MODULE_BY_ID).join(', ')}`);
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

function selectFromCategories(k: number, categoryNames: string[]): ReasoningModule[] {
  const normalized = categoryNames.map(normalizeId) as ModuleCategory[];
  
  // Validate categories
  for (const cat of normalized) {
    if (!ALL_CATEGORIES.includes(cat)) {
      throw new Error(`Unknown category: ${cat}. Available: ${ALL_CATEGORIES.join(', ')}`);
    }
  }

  // Check we have enough categories
  const uniqueCategories = [...new Set(normalized)];
  if (k > uniqueCategories.length * 4) {
    // Can't get k modules from these categories
    const maxAvailable = uniqueCategories.length * 4;
    throw new Error(`Cannot select ${k} modules from ${uniqueCategories.length} categories (max ${maxAvailable})`);
  }

  // Distribute k across categories
  const result: ReasoningModule[] = [];
  const categoryCounts = new Map<ModuleCategory, number>();

  // Initialize counts
  for (const cat of uniqueCategories) {
    categoryCounts.set(cat, 0);
  }

  // Round-robin assignment
  let remaining = k;
  while (remaining > 0) {
    for (const cat of uniqueCategories) {
      if (remaining === 0) break;
      const count = categoryCounts.get(cat)!;
      const available = MODULES_BY_CATEGORY[cat].length;
      if (count < available) {
        categoryCounts.set(cat, count + 1);
        remaining--;
      }
    }
  }

  // Select random modules from each category
  for (const [cat, count] of categoryCounts) {
    const categoryModules = MODULES_BY_CATEGORY[cat];
    const selected = randomSample(categoryModules, count);
    result.push(...selected);
  }

  return shuffle(result);
}

function selectDefault(k: number): ReasoningModule[] {
  // Sample k categories, 1 module from each
  const selectedCategories = randomSample(ALL_CATEGORIES, k);
  
  return selectedCategories.map(cat => {
    const modules = MODULES_BY_CATEGORY[cat];
    return modules[Math.floor(Math.random() * modules.length)];
  });
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
