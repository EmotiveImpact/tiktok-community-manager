import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './helpers'; // registers the hoisted electron mock for the whole file
import { wipeDataDir, writeFansFile, readFansFile } from './helpers';

/**
 * These tests exercise the DISK read paths, so each one seeds a raw fans.json
 * and then imports a FRESH copy of fans.ts (via vi.resetModules + dynamic
 * import) to force loadFans() to actually read the file rather than return the
 * cached in-memory map. The electron mock registered in helpers.ts stays in
 * effect across resetModules, so paths.ts still resolves to the temp dir.
 */
async function freshFans() {
  vi.resetModules();
  return await import('../electron/fans');
}

beforeEach(() => {
  wipeDataDir();
});
afterEach(() => {
  wipeDataDir();
});

describe('fans.json read paths', () => {
  it('reads back the versioned envelope { version: 1, fans: {} }', async () => {
    writeFansFile({
      version: 1,
      fans: {
        alice: {
          uniqueId: 'alice',
          nickname: 'Alice',
          firstSeenAt: 1,
          lastSeenAt: 2,
          totalDiamonds: 1500,
          giftCount: 4,
          tags: ['vip'],
          notes: 'note',
          birthday: '03-14',
        },
      },
    });

    const fans = await freshFans();
    const a = fans.getFan('alice')!;
    expect(a).toBeTruthy();
    expect(a.totalDiamonds).toBe(1500);
    expect(a.tags).toEqual(['vip']);
    expect(a.birthday).toBe('03-14');
    expect(a.tier).toBe('VIP');
    expect(fans.fanCount()).toBe(1);
  });

  it('loads a legacy bare-map fans.json (uniqueId -> Fan, no envelope)', async () => {
    writeFansFile({
      bob: {
        uniqueId: 'bob',
        nickname: 'Bob',
        firstSeenAt: 1,
        lastSeenAt: 2,
        totalDiamonds: 12000,
        giftCount: 9,
        tags: ['whale'],
        notes: '',
      },
    });

    const fans = await freshFans();
    const b = fans.getFan('bob')!;
    expect(b).toBeTruthy();
    expect(b.totalDiamonds).toBe(12000);
    expect(b.tier).toBe('Whale');
    expect(fans.fanCount()).toBe(1);
  });

  it('backfills missing array/number defaults on a partial legacy record', async () => {
    // Legacy record lacking tags/notes/totalDiamonds/giftCount.
    writeFansFile({
      carol: { uniqueId: 'carol', nickname: 'Carol', firstSeenAt: 1, lastSeenAt: 2 },
    });
    const fans = await freshFans();
    const c = fans.getFan('carol')!;
    expect(c.tags).toEqual([]);
    expect(c.notes).toBe('');
    expect(c.totalDiamonds).toBe(0);
    expect(c.giftCount).toBe(0);
    expect(c.tier).toBe('New');
  });

  it('treats a corrupt / unreadable fans.json as a fresh install (no throw)', async () => {
    // Write genuinely invalid JSON to hit loadFans()'s catch path.
    const { fansDataDir } = await import('./helpers');
    const fsmod = await import('node:fs');
    const pathmod = await import('node:path');
    fsmod.mkdirSync(fansDataDir(), { recursive: true });
    fsmod.writeFileSync(pathmod.join(fansDataDir(), 'fans.json'), '{ not json');

    const fans = await freshFans();
    expect(() => fans.fanCount()).not.toThrow();
    expect(fans.fanCount()).toBe(0);
  });

  it('persists new data as a versioned envelope on flush', async () => {
    const fans = await freshFans();
    fans.upsertFan({ uniqueId: 'dave', totalDiamonds: 50 });
    fans.flush();

    const raw = readFansFile();
    expect(raw.version).toBe(1);
    expect(raw.fans).toBeTruthy();
    expect(raw.fans.dave).toBeTruthy();
    expect(raw.fans.dave.uniqueId).toBe('dave');
    // Round-trip: a fresh module re-reads what we just wrote.
    const fans2 = await freshFans();
    expect(fans2.getFan('dave')!.totalDiamonds).toBe(50);
  });
});
