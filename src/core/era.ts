/**
 * Era: content-addressable versioning for the module catalog.
 * When any module prompt changes, the era ID changes automatically.
 */

import { createHash } from 'crypto';
import type { ReasoningModule } from './modules';
import { DEFAULT_REGISTRY } from './modules';
import type { EraRef } from '../stats/pairwise-types';

function normalizePrompt(prompt: string): string {
  return prompt
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/** Sorted by (category, id) for order independence; whitespace-normalized. */
export function computeCatalogDigest(modules: ReasoningModule[]): string {
  const sorted = [...modules].sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.id.localeCompare(b.id);
  });

  const canonical = sorted.map(m => ({
    id: m.id,
    category: m.category,
    name: m.name,
    prompt: normalizePrompt(m.prompt),
  }));

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function deriveEraId(digest: string): string {
  return `m_${digest.slice(0, 12)}`;
}

export function getCurrentEra(): EraRef {
  const catalogDigest = computeCatalogDigest(DEFAULT_REGISTRY.modules);
  return { id: deriveEraId(catalogDigest), catalogDigest };
}

export function isCurrentEra(eraId: string): boolean {
  return eraId === getCurrentEra().id;
}

export function isEraNamespaced(key: string): boolean {
  return /@m_[a-f0-9]{12}$/.test(key);
}

export function extractEraFromKey(key: string): string | undefined {
  const match = key.match(/@(m_[a-f0-9]{12})$/);
  return match ? match[1] : undefined;
}

export function stripEraSuffix(key: string): string {
  return key.replace(/@m_[a-f0-9]{12}$/, '');
}

export function addEraSuffix(key: string, eraId: string): string {
  return `${key}@${eraId}`;
}
