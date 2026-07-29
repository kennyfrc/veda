#!/usr/bin/env bun
/**
 * veda — CLI entry point for npm global install.
 *
 * This wrapper lets `npm install -g veda-ts` create a `veda` command
 * without a separate build step. Bun runs TypeScript directly, so we
 * just delegate to the real entry point.
 */
import '../src/index.ts';
