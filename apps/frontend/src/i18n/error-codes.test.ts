import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import admin from './locales/en/admin.json';
import errors from './locales/en/errors.json';

// The repository's root: Vitest runs from apps/frontend.
const root = resolve(process.cwd(), '../..');
const sources = ['apps/backend/src', 'packages/contracts/src'].map((dir) => join(root, dir));

/** Every `.ts` file under a folder, tests left out. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return /\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name) ? [path] : [];
  });
}

// A domain code (ADR 0001): what an exception or a schema issue carries to the client.
const CODE = /(?:Exception\(\s*|message:\s*|code:\s*)['"]([a-z][a-z_]*(?:\.[a-z][a-z_]*)+)['"]/g;

function translated(code: string): boolean {
  // The doctor's lines (`doctor.redis_ok`) are said by the administration, not as errors.
  let node: unknown = code.startsWith('doctor.') ? admin : errors;
  for (const part of code.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

/**
 * A code the server can send and the client cannot say shows as "An error
 * occurred." — the author learns nothing. Every code raised in the backend or
 * the shared contracts must have its English text (the parity test then
 * carries it to every language). Skipped where the sources are not mounted.
 */
describe('server error codes', () => {
  it.skipIf(!sources.every(existsSync))('each one has an English text', () => {
    const codes = new Set<string>();
    for (const file of sources.flatMap(tsFiles)) {
      for (const match of readFileSync(file, 'utf8').matchAll(CODE)) codes.add(match[1]);
    }
    expect(codes.size).toBeGreaterThan(50);
    // A counted message is said in its plural forms (`quiz.incomplete_other`).
    const said = (c: string) => translated(c) || translated(`${c}_other`);
    expect([...codes].filter((c) => !said(c)).sort()).toEqual([]);
  });
});
