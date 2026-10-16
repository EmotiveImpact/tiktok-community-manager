import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackup, restoreBackup } from '../../../deployment/livelens/backup.mjs';

test('backup refuses unresolved filesystem-bound cleanup and restores completed history', async t => {
  const root = mkdtempSync(join(tmpdir(), 'livelens-backup-cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = join(root, 'evidence.sqlite'), mediaRoot = join(root, 'media');
  mkdirSync(mediaRoot);
  const db = new DatabaseSync(databasePath);
  t.after(() => db.close());
  db.exec('CREATE TABLE retention_cleanup(id TEXT PRIMARY KEY,state TEXT NOT NULL)');
  db.prepare('INSERT INTO retention_cleanup VALUES(?,?)').run('original-host-task', 'pending');
  const key = randomBytes(32).toString('base64url'), outputPath = join(root, 'backup.llbackup');
  for (const state of ['pending', 'failed']) {
    db.prepare('UPDATE retention_cleanup SET state=?').run(state);
    await assert.rejects(createBackup({ databasePath, mediaRoot, outputPath, key }), /finish_retention_cleanup_before_backup/);
    assert.equal(existsSync(outputPath), false);
    assert.equal(readdirSync(root).some(name => name.includes('.partial-')), false);
  }
  db.prepare("UPDATE retention_cleanup SET state='completed'").run();
  const created = await createBackup({ databasePath, mediaRoot, outputPath, key });
  assert.equal(created.restoreRequiredToProveRecovery, true);
  const destination = join(root, 'recovered');
  const restored = await restoreBackup({ inputPath: outputPath, destination, key });
  assert.equal(restored.databaseIntegrity, 'ok');
  const recovered = new DatabaseSync(join(destination, 'intelligence.sqlite'), { readOnly: true });
  try { assert.equal(recovered.prepare('SELECT state FROM retention_cleanup WHERE id=?').get('original-host-task').state, 'completed'); }
  finally { recovered.close(); }
});
