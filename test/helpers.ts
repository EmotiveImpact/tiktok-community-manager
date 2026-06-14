import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { vi } from 'vitest';

/**
 * Fixed temp base for the whole test run. fans.ts (via paths.ts) will create
 * `<TEST_BASE>/LikeTapperMac/fans/...`. We wipe the LikeTapperMac subtree
 * between tests so every test starts from a clean filesystem.
 *
 * NOTE: this constant is referenced inside the hoisted vi.mock('electron')
 * factory below, so it must be defined before the mock — vi.mock is hoisted to
 * the top of the file at transform time, but it closes over module-scope
 * bindings by reference, and `TEST_BASE` is initialised before any test body
 * runs, which is sufficient.
 */
export const TEST_BASE = path.join(os.tmpdir(), 'tcm-vitest');

/**
 * Mock the `electron` module so importing fans.ts -> paths.ts doesn't try to
 * load the real Electron runtime (unavailable under node/vitest). Only
 * `app.getPath` is used by paths.ts; we route every path lookup to TEST_BASE.
 */
vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => TEST_BASE,
  },
}));

/** Absolute path to <TEST_BASE>/LikeTapperMac (what appDocumentsDir returns). */
export function appDir(): string {
  return path.join(TEST_BASE, 'LikeTapperMac');
}

/** Absolute path to the fans data dir. */
export function fansDataDir(): string {
  return path.join(appDir(), 'fans');
}

/** Remove the LikeTapperMac subtree so the next load starts fresh on disk. */
export function wipeDataDir(): void {
  fs.rmSync(appDir(), { recursive: true, force: true });
}

/** Raw read of the persisted fans.json (after a flush). */
export function readFansFile(): any {
  return JSON.parse(fs.readFileSync(path.join(fansDataDir(), 'fans.json'), 'utf8'));
}

/** Write a raw fans.json (used to seed legacy / versioned formats). */
export function writeFansFile(contents: unknown): void {
  fs.mkdirSync(fansDataDir(), { recursive: true });
  fs.writeFileSync(path.join(fansDataDir(), 'fans.json'), JSON.stringify(contents));
}
