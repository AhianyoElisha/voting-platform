import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests for pure `src/lib` modules.
 *
 * Covers the rules CLAUDE.md asks to be pinned by tests: vote counting,
 * payment handling, tenant scoping and nominee-code lookup, mostly against the
 * in-memory Appwrite fake in `src/lib/__tests__/fake-appwrite.ts`.
 *
 * Deliberately node-environment and scoped to `src/lib` — this is not a
 * component-testing setup, and adding one is a separate decision.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
