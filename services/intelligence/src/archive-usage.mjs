import { Fault, digest, ident } from "./validation.mjs";

export const ARCHIVE_USAGE_LIMITS = Object.freeze({
  maxArchives: 1000,
  maxObjectKeys: 20_000,
  pageSize: 32,
  // Runtime archives use the LLOBJ1 header, 12-byte IV and 16-byte GCM tag.
  encryptionOverheadBytes: 34,
});

/** Logical encrypted footprint, including uncertain writes; this is not a provider bill. */
export function archiveStorageUsage(db, workspace, candidate) {
  ident(workspace);
  const inventory = new Map();
  let archives = 0,
    offset = 0,
    pendingJobs = 0;
  const add = (key, bytes, verified) => {
    if (
      typeof key !== "string" ||
      !key ||
      key.length > 1024 ||
      !Number.isSafeInteger(bytes) ||
      bytes < ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes
    )
      throw new Fault("archive_usage_invalid", 409);
    const previous = inventory.get(key);
    if (previous && previous.bytes !== bytes)
      throw new Fault("archive_object_identity_conflict", 409);
    if (!previous && inventory.size >= ARCHIVE_USAGE_LIMITS.maxObjectKeys)
      throw new Fault("archive_usage_capacity", 409);
    inventory.set(key, {
      bytes,
      verified: verified || previous?.verified === true,
    });
    return !previous;
  };
  while (true) {
    const rows = db
      .prepare(
        "SELECT id,state,restore_state,manifest,manifest_sha256,object_key FROM media_archives WHERE workspace=? ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(workspace, ARCHIVE_USAGE_LIMITS.pageSize, offset);
    if (!rows.length) break;
    archives += rows.length;
    if (archives > ARCHIVE_USAGE_LIMITS.maxArchives)
      throw new Fault("archive_usage_capacity", 409);
    const receipts = db
      .prepare(
        `SELECT archive_id,segment_id,state FROM media_archive_segments WHERE workspace=? AND archive_id IN (${rows.map(() => "?").join(",")})`,
      )
      .all(workspace, ...rows.map((row) => row.id));
    const verified = new Set(
      receipts
        .filter((row) => row.state === "verified")
        .map((row) => `${row.archive_id}:${row.segment_id}`),
    );
    for (const row of rows) {
      if (
        typeof row.manifest !== "string" ||
        Buffer.byteLength(row.manifest) > 1024 ** 2 ||
        digest(row.manifest) !== row.manifest_sha256
      )
        throw new Fault("archive_manifest_integrity_failed", 409);
      let manifest;
      try {
        manifest = JSON.parse(row.manifest);
      } catch {
        throw new Fault("archive_manifest_integrity_failed", 409);
      }
      if (
        manifest.workspace !== workspace ||
        manifest.archiveId !== row.id ||
        !Array.isArray(manifest.segments) ||
        manifest.segments.length > 2000
      )
        throw new Fault("archive_manifest_integrity_failed", 409);
      for (const segment of manifest.segments)
        add(
          segment.objectKey,
          segment.bytes + ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes,
          verified.has(`${row.id}:${segment.id}`),
        );
      add(
        row.object_key,
        Buffer.byteLength(row.manifest) +
          ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes,
        row.state === "completed",
      );
      if (
        ["queued", "uploading", "retrying"].includes(row.state) ||
        ["queued", "restoring", "retrying"].includes(row.restore_state)
      )
        pendingJobs++;
    }
    offset += rows.length;
  }
  let archivedStorageBytes = 0,
    reservedStorageBytes = 0;
  for (const item of inventory.values()) {
    if (item.verified) archivedStorageBytes += item.bytes;
    else reservedStorageBytes += item.bytes;
  }
  let additionalStorageBytes = 0;
  if (candidate) {
    if (archives >= ARCHIVE_USAGE_LIMITS.maxArchives)
      throw new Fault("archive_usage_capacity", 409);
    for (const segment of candidate.segments) {
      const bytes =
        segment.bytes + ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes;
      if (add(segment.objectKey, bytes, false)) additionalStorageBytes += bytes;
    }
    const bytes =
      Buffer.byteLength(candidate.encoded) +
      ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes;
    if (inventory.has(candidate.objectKey))
      throw new Fault("archive_object_identity_conflict", 409);
    add(candidate.objectKey, bytes, false);
    additionalStorageBytes += bytes;
  }
  return {
    archivedStorageBytes,
    reservedStorageBytes,
    pendingJobs,
    additionalStorageBytes,
    uniqueObjectKeys: inventory.size,
    archives,
    measurement: "logical-encrypted-objects-and-reservations",
    providerBilledAmount: null,
  };
}
