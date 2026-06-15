import { describe, it, expect } from 'vitest';
import { migrateNotesToFans, type LegacyNote, type MigrationFan } from '../electron/notes-migration';

/**
 * The notesStore → fan-model migration must NEVER lose a note. These tests use
 * in-memory deps (no Electron) to assert each legacy note lands somewhere on the
 * fan record: either the pinned About (fan.notes) or a dated timeline note.
 */

type Harness = {
  fans: Map<string, { uniqueId: string; notes?: string; nickname?: string }>;
  interactions: { fanId: string; type: 'note'; body: string; occurredAt: number }[];
  migrated: boolean;
  deps: Parameters<typeof migrateNotesToFans>[0];
};

function harness(legacy: Record<string, LegacyNote>, seedFans: Array<{ uniqueId: string; notes?: string }> = []): Harness {
  const fans = new Map<string, { uniqueId: string; notes?: string; nickname?: string }>();
  for (const f of seedFans) fans.set(f.uniqueId, { ...f });
  const interactions: Harness['interactions'] = [];
  const state = { migrated: false };

  const deps = {
    allLegacyNotes: () => legacy,
    getFan: (uniqueId: string): MigrationFan => fans.get(uniqueId) ?? null,
    upsertFan: (p: { uniqueId: string; nickname?: string; notes?: string }) => {
      const cur = fans.get(p.uniqueId) ?? { uniqueId: p.uniqueId };
      if (p.nickname !== undefined) cur.nickname = p.nickname;
      if (p.notes !== undefined) cur.notes = p.notes;
      fans.set(p.uniqueId, cur);
      return { ok: true };
    },
    addInteraction: (p: { fanId: string; type: 'note'; body: string; occurredAt: number }) => {
      interactions.push(p);
      return { ok: true };
    },
    clearLegacy: () => { for (const k of Object.keys(legacy)) delete legacy[k]; },
    isMigrated: () => state.migrated,
    setMigrated: () => { state.migrated = true; },
  };

  return {
    get fans() { return fans; },
    get interactions() { return interactions; },
    get migrated() { return state.migrated; },
    deps,
  } as Harness;
}

describe('notesStore → fan migration', () => {
  it('moves a legacy note onto a NEW fan as the pinned About (no loss)', () => {
    const legacy = { alice: { uniqueId: 'alice', nickname: 'Alice', notes: 'Loves cat content', updatedAt: 1000 } };
    const h = harness(legacy);

    const res = migrateNotesToFans(h.deps);

    expect(res.ran).toBe(true);
    expect(res.movedToAbout).toBe(1);
    expect(h.fans.get('alice')?.notes).toBe('Loves cat content');
    // nothing lost, nothing duplicated to the timeline
    expect(h.interactions).toHaveLength(0);
  });

  it('moves a legacy note onto an EXISTING fan with empty About as the About', () => {
    const legacy = { bob: { uniqueId: 'bob', notes: 'UK timezone', updatedAt: 1000 } };
    const h = harness(legacy, [{ uniqueId: 'bob', notes: '' }]);

    const res = migrateNotesToFans(h.deps);

    expect(res.movedToAbout).toBe(1);
    expect(h.fans.get('bob')?.notes).toBe('UK timezone');
    expect(h.interactions).toHaveLength(0);
  });

  it('does NOT clobber an existing About — appends as a dated timeline note instead', () => {
    const legacy = { cara: { uniqueId: 'cara', notes: 'Second source note', updatedAt: 4242 } };
    const h = harness(legacy, [{ uniqueId: 'cara', notes: 'Hand-written About — keep me' }]);

    const res = migrateNotesToFans(h.deps);

    expect(res.appendedToTimeline).toBe(1);
    // the hand-written About is preserved untouched
    expect(h.fans.get('cara')?.notes).toBe('Hand-written About — keep me');
    // the legacy text survives as a DATED note stamped at updatedAt
    expect(h.interactions).toEqual([
      { fanId: 'cara', type: 'note', body: 'Second source note', occurredAt: 4242 },
    ]);
  });

  it('is idempotent: a second run does nothing and drains the legacy store', () => {
    const legacy = { dan: { uniqueId: 'dan', notes: 'Note', updatedAt: 1 } };
    const h = harness(legacy);

    migrateNotesToFans(h.deps);
    expect(h.migrated).toBe(true);
    expect(Object.keys(legacy)).toHaveLength(0); // drained

    const before = h.fans.get('dan')?.notes;
    const second = migrateNotesToFans(h.deps);
    expect(second.ran).toBe(false);
    expect(h.fans.get('dan')?.notes).toBe(before); // unchanged
  });

  it('skips empty notes but never errors on them', () => {
    const legacy = {
      empty: { uniqueId: 'empty', notes: '   ', updatedAt: 1 },
      real: { uniqueId: 'real', notes: 'keep', updatedAt: 2 },
    };
    const h = harness(legacy);

    const res = migrateNotesToFans(h.deps);

    expect(res.skippedEmpty).toBe(1);
    expect(res.movedToAbout).toBe(1);
    expect(h.fans.get('real')?.notes).toBe('keep');
    expect(h.fans.has('empty')).toBe(false);
  });

  it('preserves EVERY note across a mixed batch (no silent loss)', () => {
    const legacy: Record<string, LegacyNote> = {
      n1: { uniqueId: 'n1', notes: 'about-1', updatedAt: 10 },        // → About (new fan)
      n2: { uniqueId: 'n2', notes: 'about-2', updatedAt: 20 },        // → About (empty existing)
      n3: { uniqueId: 'n3', notes: 'extra-3', updatedAt: 30 },        // → timeline (About exists)
    };
    const h = harness(legacy, [{ uniqueId: 'n2', notes: '' }, { uniqueId: 'n3', notes: 'existing About' }]);

    const res = migrateNotesToFans(h.deps);

    // 3 in → 2 About + 1 timeline, 0 lost
    expect(res.total).toBe(3);
    expect(res.movedToAbout + res.appendedToTimeline).toBe(3);
    expect(res.errored).toBe(0);
    const preserved = [
      h.fans.get('n1')?.notes,
      h.fans.get('n2')?.notes,
      ...h.interactions.map((i) => i.body),
    ];
    expect(preserved).toContain('about-1');
    expect(preserved).toContain('about-2');
    expect(preserved).toContain('extra-3');
  });
});
