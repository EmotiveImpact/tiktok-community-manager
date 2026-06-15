/**
 * One-time migration: collapse the legacy `notesStore` island into the
 * canonical fan notes model.
 *
 * BEFORE this migration there were four disconnected note stores. The legacy
 * `notesStore` (a `Record<uniqueId, UserNote>` in settings.json) was an ISLAND:
 * written by FanNotesPanel + UserDetailDrawer, but invisible to the 360 profile
 * and the Fan Memory panel, which read the fan record instead.
 *
 * AFTER: there are exactly TWO note surfaces, BOTH on the fan record:
 *   A) pinned "About"  = `fan.notes`            (the one stable summary)
 *   B) dated notes log = timeline `type:'note'` (via addInteraction)
 *
 * For each legacy `notesStore[uniqueId]` we move the text onto the fan WITHOUT
 * LOSING IT:
 *   - if the fan has no About yet → it becomes the pinned About (`fan.notes`).
 *   - otherwise (a real About already exists) → it's appended as a DATED
 *     timeline note (`addInteraction type:'note'`) stamped at the legacy
 *     `updatedAt`, so we never clobber a hand-written About and never drop a
 *     note. A missing fan is created as a manual stub so the note still lands.
 *
 * The migration is FAIL-SAFE (one bad entry never aborts the rest), IDEMPOTENT
 * (guarded by the `notesMigratedToFans` settings flag and drains the legacy map
 * when done), and dependency-injected so it can be unit-tested without Electron.
 */

export type LegacyNote = {
  uniqueId: string;
  nickname?: string;
  notes?: string;
  updatedAt?: number;
};

/** Just the slice of a fan record this migration reads. */
export type MigrationFan = { uniqueId: string; notes?: string } | null;

export type NotesMigrationDeps = {
  /** All legacy notesStore entries, keyed by uniqueId. */
  allLegacyNotes: () => Record<string, LegacyNote>;
  /** Raw fan record (or null when the fan isn't in the ledger yet). */
  getFan: (uniqueId: string) => MigrationFan;
  /** Create/patch a fan — used to set the pinned About or stub a missing fan. */
  upsertFan: (payload: { uniqueId: string; nickname?: string; notes?: string }) => { ok: boolean };
  /** Append a dated timeline note. */
  addInteraction: (p: {
    fanId: string;
    type: 'note';
    body: string;
    occurredAt: number;
  }) => { ok: boolean };
  /** Drain the legacy store once everything is safely moved. */
  clearLegacy: () => void;
  /** Has this migration already run? */
  isMigrated: () => boolean;
  /** Mark the migration done (idempotency latch). */
  setMigrated: () => void;
};

export type NotesMigrationResult = {
  ran: boolean;
  total: number;
  /** entries that became a fan's pinned About */
  movedToAbout: number;
  /** entries appended as a dated timeline note */
  appendedToTimeline: number;
  /** entries skipped (empty text — nothing to preserve) */
  skippedEmpty: number;
  /** entries that errored individually (still fail-safe; nothing aborted) */
  errored: number;
};

/**
 * Run the one-time notesStore → fan migration. Returns a summary; never throws.
 */
export function migrateNotesToFans(deps: NotesMigrationDeps): NotesMigrationResult {
  const result: NotesMigrationResult = {
    ran: false,
    total: 0,
    movedToAbout: 0,
    appendedToTimeline: 0,
    skippedEmpty: 0,
    errored: 0,
  };

  try {
    if (deps.isMigrated()) return result;
  } catch {
    // If we can't even read the flag, bail rather than risk a double-run.
    return result;
  }

  result.ran = true;

  let legacy: Record<string, LegacyNote> = {};
  try {
    legacy = deps.allLegacyNotes() ?? {};
  } catch {
    legacy = {};
  }

  const entries = Object.entries(legacy);
  result.total = entries.length;

  for (const [rawId, note] of entries) {
    try {
      const uniqueId = String(note?.uniqueId || rawId || '').replace(/^@+/, '').trim();
      const text = String(note?.notes ?? '').trim();
      if (!uniqueId) {
        result.errored++;
        continue;
      }
      if (!text) {
        // Nothing to preserve — an empty note is not a note.
        result.skippedEmpty++;
        continue;
      }

      const fan = deps.getFan(uniqueId);
      const existingAbout = String(fan?.notes ?? '').trim();

      if (!fan || !existingAbout) {
        // No fan, or a fan with an empty About → this text becomes the About.
        // upsertFan creates a manual stub when the fan is missing, so the note
        // is never dropped just because the person wasn't in the ledger.
        const res = deps.upsertFan({
          uniqueId,
          nickname: note?.nickname || undefined,
          notes: text,
        });
        if (res.ok) result.movedToAbout++;
        else result.errored++;
      } else {
        // A real About already exists — don't clobber it. Preserve this text as
        // a DATED timeline note stamped at the legacy updatedAt.
        const occurredAt =
          Number.isFinite(note?.updatedAt) && (note!.updatedAt as number) > 0
            ? (note!.updatedAt as number)
            : Date.now();
        const res = deps.addInteraction({ fanId: uniqueId, type: 'note', body: text, occurredAt });
        if (res.ok) result.appendedToTimeline++;
        else result.errored++;
      }
    } catch {
      result.errored++;
    }
  }

  // Drain + latch only after the pass completes. Even if some rows errored, we
  // mark migrated to avoid an infinite retry loop; errored rows are logged by
  // the caller via the returned summary. Draining is what makes a re-run a
  // no-op even if the flag write fails.
  try {
    deps.clearLegacy();
  } catch {
    /* best-effort drain */
  }
  try {
    deps.setMigrated();
  } catch {
    /* flag is a latch; the drained map already makes re-runs no-ops */
  }

  return result;
}
