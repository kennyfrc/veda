/**
 * Backend registry for managing available backends.
 */

import type { Backend, BackendFactory } from './types';

const backends = new Map<string, BackendFactory>();

/**
 * Register a backend factory.
 */
export function registerBackend(name: string, factory: BackendFactory): void {
  backends.set(name, factory);
}

/**
 * Get a backend by name.
 */
export function getBackend(name: string): Backend {
  const factory = backends.get(name);
  if (!factory) {
    throw new Error(`Unknown backend: ${name}. Available: ${[...backends.keys()].join(', ')}`);
  }
  return factory();
}

/**
 * Check if a backend is registered.
 */
export function hasBackend(name: string): boolean {
  return backends.has(name);
}

/**
 * List all registered backend names.
 */
export function listBackends(): string[] {
  return [...backends.keys()];
}

/**
 * Get all available backends (those that are installed).
 */
export async function getAvailableBackends(): Promise<string[]> {
  const available: string[] = [];
  
  for (const name of backends.keys()) {
    try {
      const backend = getBackend(name);
      if (await backend.isAvailable()) {
        available.push(name);
      }
    } catch {
      // Skip backends that fail to instantiate
    }
  }
  
  return available;
}
