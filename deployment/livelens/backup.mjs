import { DatabaseSync, backup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, openSync, closeSync, fsyncSync, writeSync, readSync, linkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('LLBACKUP1\n');
const helper = fileURLToPath(new URL('./backup_archive.py', import.meta.url));
function keyBytes(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('backup_key_must_be_32_byte_base64url');
  const bytes = Buffer.from(key, 'base64url'); if (bytes.length !== 32) throw new Error('invalid_backup_key'); return bytes;
}
function archive(args) {
  const result = spawnSync('python3', [helper, ...args], { encoding: 'utf8', timeout: 300_000, maxBuffer: 1024 ** 2 });
  if (result.status !== 0) throw new Error('backup_archive_verification_failed');
  return JSON.parse(result.stdout);
}
async function hash(path) { const digest = createHash('sha256'); for await (const part of createReadStream(path)) digest.update(part); return digest.digest('hex'); }
function inactive(db) {
  for (const table of ['recording_jobs', 'speech_jobs']) if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE state NOT IN('completed','stopped','failed') LIMIT 1`).get()) throw new Error('stop_active_and_pending_jobs_before_backup');
  }
}

/** Consistent SQLite snapshot and verified local media, sealed with AES-256-GCM. */
export async function createBackup({ databasePath, mediaRoot, outputPath, key }) {
  const secret = keyBytes(key), output = resolve(outputPath);
  if (existsSync(output)) throw new Error('backup_destination_exists');
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(tmpdir(), 'livelens-backup-')), partial = output + '.partial-' + randomBytes(6).toString('hex');
  let db;
  try {
    db = new DatabaseSync(resolve(databasePath), { readOnly: true }); inactive(db);
    const snapshot = join(temp, 'intelligence.sqlite'); await backup(db, snapshot); db.close(); db = null;
    const packed = join(temp, 'snapshot.tar'); const verification = archive(['pack', snapshot, resolve(mediaRoot), packed]);
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(MAGIC);
    const fd = openSync(partial, 'wx', 0o600); writeSync(fd, MAGIC); writeSync(fd, iv); closeSync(fd);
    await pipeline(createReadStream(packed), cipher, createWriteStream(partial, { flags: 'a', mode: 0o600 }));
    const append = openSync(partial, 'a'); writeSync(append, cipher.getAuthTag()); fsyncSync(append); closeSync(append);
    linkSync(partial, output); rmSync(partial);
    return { schemaVersion: 1, encryption: 'AES-256-GCM', bytes: statSync(output).size, sha256: await hash(output), mediaVerified: verification.mediaVerified, restoreRequiredToProveRecovery: true };
  } finally { db?.close(); secret.fill(0); rmSync(temp, { recursive: true, force: true }); rmSync(partial, { force: true }); }
}

/** Restore only to a new directory. Authentication precedes archive extraction. */
export async function restoreBackup({ inputPath, destination, key }) {
  const secret = keyBytes(key), input = resolve(inputPath), target = resolve(destination);
  if (existsSync(target)) throw new Error('restore_destination_must_not_exist');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(dirname(target), '.livelens-restore-'));
  try {
    const size = statSync(input).size, header = Buffer.alloc(MAGIC.length + 12), fd = openSync(input, 'r'), tag = Buffer.alloc(16);
    try {
      readSync(fd, header, 0, header.length, 0);
      if (size < MAGIC.length + 12 + 16 || !header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('invalid_backup_header');
      readSync(fd, tag, 0, 16, size - 16);
    } finally { closeSync(fd); }
    const decipher = createDecipheriv('aes-256-gcm', secret, header.subarray(MAGIC.length)); decipher.setAAD(MAGIC); decipher.setAuthTag(tag);
    const packed = join(temp, 'snapshot.tar');
    try { await pipeline(createReadStream(input, { start: MAGIC.length + 12, end: size - 17 }), decipher, createWriteStream(packed, { flags: 'wx', mode: 0o600 })); }
    catch { throw new Error('backup_authentication_failed'); }
    const extracted = join(temp, 'verified'); const verification = archive(['unpack', packed, extracted]);
    renameSync(extracted, target);
    return { schemaVersion: 1, restored: true, mediaVerified: verification.mediaVerified, databaseIntegrity: verification.databaseIntegrity, encryptedBackupSha256: await hash(input) };
  } finally { secret.fill(0); rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, first, second, third] = process.argv.slice(2);
  try {
    const result = operation === 'create' ? await createBackup({ databasePath: first, mediaRoot: second, outputPath: third, key: process.env.LIVELENS_BACKUP_KEY })
      : operation === 'restore' ? await restoreBackup({ inputPath: first, destination: second, key: process.env.LIVELENS_BACKUP_KEY }) : (() => { throw new Error('use_create_database_media_output_or_restore_backup_new_directory'); })();
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message?.match(/^[a-z0-9_]+$/)?.[0] ?? 'backup_operation_failed'); process.exitCode = 1; }
}
