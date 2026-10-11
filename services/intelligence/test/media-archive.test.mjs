import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash, createHmac } from "node:crypto";
import { EvidenceStore } from "../src/store.mjs";
import { Recorder, hashFile } from "../src/recorder.mjs";
import { MediaArchive } from "../src/media-archive.mjs";
import { Governance } from "../src/governance.mjs";
import { ARCHIVE_USAGE_LIMITS } from "../src/archive-usage.mjs";
import {
  FilesystemObjectStorage,
  S3ObjectStorage,
  EncryptedObjectStorage,
} from "../../../deployment/livelens/object-storage.mjs";

const locked = resolve(
  import.meta.dirname,
  "../../../node_modules/ffmpeg-static/ffmpeg",
);
const ffmpeg =
  process.env.LIVELENS_FFMPEG_PATH ??
  (existsSync(locked) ? locked : "/usr/bin/ffmpeg");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, bytes) => createHmac("sha256", key).update(bytes).digest();
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "livelens-media-archive-")),
    db = join(dir, "evidence.sqlite");
  let store = new EvidenceStore(db);
  store.createSession("alpha", {
    id: "fixture",
    platform: "fixture",
    title: "Generated archive media fixture",
    sourceUrl: "https://example.invalid/archive-fixture",
    startedAtMs: 1000,
  });
  const input = join(dir, "input.mp4");
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:size=160x90:rate=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    input,
  ]);
  const config = {
    mediaRoot: join(dir, "media"),
    ffmpeg,
    sources: [
      {
        id: "fixture",
        workspace: "alpha",
        sessionId: "fixture",
        kind: "file",
        input,
      },
    ],
  };
  let recorder = new Recorder({ store, ...config });
  recorder.create("alpha", {
    id: "recorded",
    sessionId: "fixture",
    sourceId: "fixture",
    maxDurationSeconds: 10,
    segmentSeconds: 2,
  });
  store.db
    .prepare(
      "UPDATE recording_jobs SET state='completed',attempts=1,attempt_started=1000 WHERE workspace='alpha' AND id='recorded'",
    )
    .run();
  const segments = [];
  for (let i = 0; i < 2; i++) {
    const directory = recorder.directory("alpha", "recorded", 1),
      filename = `segment-0000${i}.mp4`,
      path = join(directory, filename);
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${i ? "blue" : "red"}:size=160x90:rate=10`,
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      path,
    ]);
    const bytes = readFileSync(path),
      id = `a1-segment-0000${i}`,
      hash = await hashFile(path);
    store.db
      .prepare("INSERT INTO media_segments VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        "alpha",
        "recorded",
        id,
        1,
        1000 + i * 2000,
        2000,
        bytes.length,
        hash,
        path.slice(recorder.root.length + 1),
      );
    segments.push({ id, path, bytes, sha256: hash });
  }
  const workers = [];
  const f = {
    dir,
    db,
    config,
    segments,
    get store() {
      return store;
    },
    get recorder() {
      return recorder;
    },
    worker(storage, options = {}) {
      const archive = new MediaArchive({
        store,
        recorder,
        storage,
        ...options,
      });
      workers.push(archive);
      return archive;
    },
    async reopen() {
      for (const worker of workers) await worker.close();
      await recorder.close();
      store.close();
      store = new EvidenceStore(db);
      recorder = new Recorder({ store, ...config });
    },
  };
  t.after(async () => {
    for (const worker of workers) await worker.close();
    await recorder.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return f;
}

test("archive admission reserves encrypted media before upload and deduplicates shared immutable objects", async (t) => {
  const f = await fixture(t);
  const owner = { workspace: "alpha", subject: "owner" };
  let governance = new Governance({
    store: f.store,
    recorder: f.recorder,
    members: [{ ...owner, role: "owner" }],
  });
  const storage = new EncryptedObjectStorage(
    new FilesystemObjectStorage(join(f.dir, "quota-objects")),
    Buffer.alloc(32, 8),
  );
  let archive = f.worker(storage);
  let admissions = 0;
  const bindAdmission = () => {
    archive.admission = (workspace, additions) => {
      assert.equal(f.store.db.isTransaction, true);
      admissions++;
      return governance.checkQuota(workspace, additions);
    };
  };
  bindAdmission();
  const localBytes = f.segments.reduce(
    (n, segment) => n + segment.bytes.length,
    0,
  );
  governance.setLimits(
    "alpha",
    {
      maxStorageBytes: localBytes + 1,
      reason: "Exercise pre-upload admission",
    },
    owner,
  );
  const input = {
    id: "one",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
  };
  assert.throws(
    () => archive.create("alpha", input),
    /workspace_quota_exceeded/,
  );
  assert.equal(archive.list("alpha").length, 0);
  assert.equal(existsSync(join(f.dir, "quota-objects")), true);
  governance.setLimits(
    "alpha",
    { maxStorageBytes: 1_000_000, reason: "Allow explicit export" },
    owner,
  );
  archive.create("alpha", input);
  const row = f.store.db
    .prepare("SELECT manifest FROM media_archives WHERE workspace=? AND id=?")
    .get("alpha", "one");
  const objectBytes =
    localBytes +
    f.segments.length * ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes;
  const manifestBytes =
    Buffer.byteLength(row.manifest) +
    ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes;
  let usage = governance.usage("alpha");
  assert.equal(usage.localStorageBytes, localBytes);
  assert.equal(usage.storageBytes, localBytes);
  assert.equal(usage.reservedStorageBytes, objectBytes + manifestBytes);
  assert.equal(usage.pendingJobs, 1);
  assert.equal(usage.archivedObjectKeys, 3);
  assert.equal(usage.billedAmount, null);
  const exactBudget = usage.storageBytes + usage.reservedStorageBytes;
  governance.setLimits(
    "alpha",
    { maxStorageBytes: exactBudget, reason: "Reserve exactly one export" },
    owner,
  );
  assert.equal(governance.checkQuota("alpha").allowed, true);
  const beforeRetry = admissions;
  assert.equal(archive.create("alpha", input).id, "one");
  assert.equal(admissions, beforeRetry);
  assert.throws(
    () => archive.create("alpha", { ...input, id: "two" }),
    /workspace_quota_exceeded/,
  );
  assert.equal(archive.list("alpha").length, 1);
  assert.equal(governance.usage("beta").storageBytes, 0);
  assert.equal(governance.usage("beta").reservedStorageBytes, 0);
  assert.equal(governance.usage("beta").pendingJobs, 0);
  assert.throws(() => archive.create("beta", input), /job_not_found/);
  await f.reopen();
  governance = new Governance({ store: f.store, recorder: f.recorder });
  archive = f.worker(storage);
  bindAdmission();
  assert.equal(
    governance.usage("alpha").reservedStorageBytes,
    objectBytes + manifestBytes,
  );
  await archive.tick();
  usage = governance.usage("alpha");
  assert.equal(usage.archivedStorageBytes, objectBytes + manifestBytes);
  assert.equal(usage.storageBytes, exactBudget);
  assert.equal(usage.reservedStorageBytes, 0);
  assert.equal(usage.pendingJobs, 0);
  governance.setLimits(
    "alpha",
    {
      maxStorageBytes: exactBudget + 20_000,
      reason: "Allow a second snapshot manifest",
    },
    owner,
  );
  archive.create("alpha", { ...input, id: "two" });
  const secondManifest = f.store.db
    .prepare("SELECT manifest FROM media_archives WHERE workspace=? AND id=?")
    .get("alpha", "two").manifest;
  const secondManifestBytes =
    Buffer.byteLength(secondManifest) +
    ARCHIVE_USAGE_LIMITS.encryptionOverheadBytes;
  usage = governance.usage("alpha");
  assert.equal(usage.storageBytes, exactBudget);
  assert.equal(usage.reservedStorageBytes, secondManifestBytes);
  assert.equal(usage.archivedObjectKeys, 4);
  await archive.tick();
  usage = governance.usage("alpha");
  assert.equal(usage.storageBytes, exactBudget + secondManifestBytes);
  assert.equal(usage.reservedStorageBytes, 0);
  assert.equal(usage.archivedObjectKeys, 4);
});

test("pending archive and restore jobs consume the same workspace job quota idempotently", async (t) => {
  const f = await fixture(t),
    owner = { workspace: "alpha", subject: "owner" };
  const governance = new Governance({
    store: f.store,
    recorder: f.recorder,
    members: [{ ...owner, role: "owner" }],
    limits: { maxPendingJobs: 1 },
  });
  const archive = f.worker(
    new FilesystemObjectStorage(join(f.dir, "pending-objects")),
  );
  let admissions = 0;
  archive.admission = (workspace, additions) => {
    admissions++;
    return governance.checkQuota(workspace, additions);
  };
  const input = {
    id: "one",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
  };
  archive.create("alpha", input);
  assert.equal(governance.usage("alpha").pendingJobs, 1);
  assert.throws(
    () => archive.create("alpha", { ...input, id: "two" }),
    /workspace_quota_exceeded/,
  );
  const beforeRetry = admissions;
  archive.create("alpha", input);
  assert.equal(admissions, beforeRetry);
  await archive.tick();
  assert.equal(governance.usage("alpha").pendingJobs, 0);
  archive.restore("alpha", "one");
  assert.equal(governance.usage("alpha").pendingJobs, 1);
  const beforeRestoreRetry = admissions;
  archive.restore("alpha", "one");
  assert.equal(admissions, beforeRestoreRetry);
  assert.throws(
    () => archive.create("alpha", { ...input, id: "two" }),
    /workspace_quota_exceeded/,
  );
  assert.equal(archive.list("alpha").length, 1);
  await archive.tick();
  assert.equal(archive.job("alpha", "one").restore.state, "completed");
  assert.equal(governance.usage("alpha").pendingJobs, 0);
});

test("failed uncertain object writes retain their durable storage reservation across restart", async (t) => {
  const f = await fixture(t),
    owner = { workspace: "alpha", subject: "owner" };
  let governance = new Governance({
    store: f.store,
    recorder: f.recorder,
    members: [{ ...owner, role: "owner" }],
  });
  const backing = new FilesystemObjectStorage(join(f.dir, "uncertain-objects"));
  const storage = {
    async put(workspace, key, bytes) {
      await backing.put(workspace, key, bytes);
      throw new Error("lost write acknowledgement");
    },
    get: (...args) => backing.get(...args),
  };
  let archive = f.worker(storage);
  archive.admission = (workspace, additions) =>
    governance.checkQuota(workspace, additions);
  const input = {
    id: "uncertain",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
    maxAttempts: 1,
  };
  archive.create("alpha", input);
  const reserved = governance.usage("alpha").reservedStorageBytes;
  const budget = governance.usage("alpha").storageBytes + reserved;
  governance.setLimits(
    "alpha",
    { maxStorageBytes: budget, reason: "Keep uncertainty accounted for" },
    owner,
  );
  await archive.tick();
  assert.equal(archive.job("alpha", "uncertain").state, "failed");
  assert.equal(governance.usage("alpha").reservedStorageBytes, reserved);
  assert.equal(governance.usage("alpha").pendingJobs, 0);
  await f.reopen();
  governance = new Governance({ store: f.store, recorder: f.recorder });
  archive = f.worker(storage);
  archive.admission = (workspace, additions) =>
    governance.checkQuota(workspace, additions);
  assert.equal(governance.usage("alpha").reservedStorageBytes, reserved);
  assert.throws(
    () => archive.create("alpha", { ...input, id: "another" }),
    /workspace_quota_exceeded/,
  );
  assert.equal(archive.list("alpha").length, 1);
});

test("verified encrypted object archive survives database restart and explicitly restores missing or damaged media", async (t) => {
  const f = await fixture(t),
    backing = new FilesystemObjectStorage(join(f.dir, "objects")),
    storage = new EncryptedObjectStorage(backing, Buffer.alloc(32, 7));
  let archive = f.worker(storage);
  const input = {
    id: "archive",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
  };
  const queued = archive.create("alpha", input);
  assert.equal(queued.state, "queued");
  assert.equal(queued.coverage, "verified-segments-at-explicit-snapshot");
  assert.deepEqual(archive.create("alpha", input), queued);
  assert.throws(
    () => archive.create("alpha", { ...input, maxDurationSeconds: 12 }),
    /media_archive_identity_conflict/,
  );
  assert.throws(
    () =>
      archive.create("alpha", {
        ...input,
        storageUrl: "https://arbitrary.invalid",
      }),
    /unknown_field/,
  );
  assert.throws(
    () => archive.job("beta", "archive"),
    /media_archive_not_found/,
  );
  await archive.tick();
  const receipt = archive.job("alpha", "archive");
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.storage.verifiedReadback, true);
  assert.ok(receipt.segments.every((s) => s.state === "verified"));
  assert.equal(JSON.stringify(receipt).includes("objectKey"), false);
  assert.equal(JSON.stringify(receipt).includes("https:"), false);
  const manifest = JSON.parse(
    f.store.db
      .prepare(
        "SELECT manifest FROM media_archives WHERE workspace='alpha' AND id='archive'",
      )
      .get().manifest,
  );
  const sealed = await backing.get("alpha", manifest.segments[0].objectKey);
  assert.equal(sealed.subarray(0, 6).toString(), "LLOBJ1");
  assert.notDeepEqual(sealed, f.segments[0].bytes);
  await f.reopen();
  archive = f.worker(storage);
  rmSync(f.segments[0].path);
  writeFileSync(f.segments[1].path, "damaged local media");
  await assert.rejects(
    () => f.recorder.media("alpha", "recorded", f.segments[0].id),
    /media_unavailable/,
  );
  await assert.rejects(
    () => f.recorder.media("alpha", "recorded", f.segments[1].id),
    /media_integrity_failed/,
  );
  assert.equal(archive.restore("alpha", "archive").restore.state, "queued");
  assert.equal(archive.restore("alpha", "archive").restore.state, "queued");
  await archive.tick();
  assert.equal(archive.job("alpha", "archive").restore.state, "completed");
  for (const segment of f.segments)
    assert.equal(
      (await f.recorder.media("alpha", "recorded", segment.id)).sha256,
      segment.sha256,
    );
});

test("outbox readback failure never claims archive completion; persisted retry resumes with unchanged snapshot", async (t) => {
  const f = await fixture(t),
    backing = new FilesystemObjectStorage(join(f.dir, "objects"));
  let fail = true,
    now = 10_000;
  const storage = {
    put: async (...args) => {
      if (fail) {
        fail = false;
        throw new Error("private bucket URL must never escape");
      }
      return backing.put(...args);
    },
    get: (...args) => backing.get(...args),
  };
  let archive = f.worker(storage, { now: () => now });
  archive.create("alpha", {
    id: "retry",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
  });
  await archive.tick();
  let receipt = archive.job("alpha", "retry");
  assert.equal(receipt.state, "retrying");
  assert.equal(receipt.error, "object_storage_unavailable");
  assert.equal(receipt.attempts, 1);
  const snapshotHash = receipt.manifestSha256;
  await f.reopen();
  now += 600;
  archive = f.worker(storage, { now: () => now });
  await archive.tick();
  receipt = archive.job("alpha", "retry");
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.attempts, 2);
  assert.equal(receipt.manifestSha256, snapshotHash);
});

test("archive corruption refuses restore and preserves original media damage rather than silently replacing it", async (t) => {
  const f = await fixture(t),
    backing = new FilesystemObjectStorage(join(f.dir, "objects")),
    archive = f.worker(backing);
  archive.create("alpha", {
    id: "integrity",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
    maxAttempts: 1,
  });
  await archive.tick();
  const manifest = JSON.parse(
    f.store.db
      .prepare("SELECT manifest FROM media_archives WHERE id='integrity'")
      .get().manifest,
  );
  await backing.put(
    "alpha",
    manifest.segments[0].objectKey,
    Buffer.from("corrupt archive object"),
  );
  writeFileSync(f.segments[0].path, "known local damage");
  archive.restore("alpha", "integrity");
  await archive.tick();
  const receipt = archive.job("alpha", "integrity");
  assert.equal(receipt.restore.state, "failed");
  assert.equal(receipt.restore.error, "archive_object_integrity_failed");
  assert.equal(readFileSync(f.segments[0].path, "utf8"), "known local damage");
  await assert.rejects(
    () => f.recorder.media("alpha", "recorded", f.segments[0].id),
    /media_integrity_failed/,
  );
});

test("object namespace, expired worker recovery and bounds remain workspace-isolated", async (t) => {
  const f = await fixture(t),
    backing = new FilesystemObjectStorage(join(f.dir, "objects"));
  let now = 1000;
  const archive = f.worker(backing, { now: () => now });
  archive.create("alpha", {
    id: "interrupted",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
  });
  f.store.db
    .prepare(
      "UPDATE media_archives SET state='uploading',attempts=1 WHERE id='interrupted'",
    )
    .run();
  f.store.db
    .prepare("INSERT INTO media_archive_leases VALUES(?,?,?,?)")
    .run("alpha", "interrupted", "dead-fixture-owner", 0);
  await archive.tick();
  assert.equal(archive.job("alpha", "interrupted").state, "completed");
  assert.equal(archive.job("alpha", "interrupted").attempts, 2);
  const manifest = JSON.parse(
    f.store.db
      .prepare("SELECT manifest FROM media_archives WHERE id='interrupted'")
      .get().manifest,
  );
  await assert.rejects(() =>
    backing.get("beta", manifest.segments[0].objectKey),
  );
  assert.throws(
    () =>
      archive.create("alpha", {
        recordingJobId: "recorded",
        maxDurationSeconds: 601,
      }),
    /invalid_media_archive_bounds/,
  );
  archive.create("alpha", {
    id: "expired",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
  });
  now += 10_001;
  await archive.tick();
  assert.equal(archive.job("alpha", "expired").state, "failed");
  assert.equal(
    archive.job("alpha", "expired").error,
    "media_archive_deadline_exceeded",
  );
});

test("actual HTTP S3 Signature V4 fixture stores private media, verifies readback and restores original replay bytes", async (t) => {
  const f = await fixture(t),
    objects = new Map();
  let requests = 0;
  const access = "LOCAL_FIXTURE_KEY",
    secret = "local-fixture-secret-only",
    region = "fixture-region";
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks),
        auth = String(req.headers.authorization ?? "");
      const match =
        /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]+)$/.exec(
          auth,
        );
      assert.ok(match);
      assert.equal(match[1], access);
      assert.equal(req.headers["x-amz-content-sha256"], sha(bytes));
      const names = match[3].split(";"),
        headers = names
          .map((name) => name + ":" + String(req.headers[name]).trim() + "\n")
          .join("");
      const canonical = [
          req.method,
          req.url,
          "",
          headers,
          match[3],
          sha(bytes),
        ].join("\n"),
        date = String(req.headers["x-amz-date"]).slice(0, 8);
      const signing = hmac(
        hmac(hmac(hmac("AWS4" + secret, date), region), "s3"),
        "aws4_request",
      );
      assert.equal(
        match[4],
        hmac(
          signing,
          [
            "AWS4-HMAC-SHA256",
            req.headers["x-amz-date"],
            match[2],
            sha(canonical),
          ].join("\n"),
        ).toString("hex"),
      );
      requests++;
      if (req.method === "PUT") {
        objects.set(req.url, bytes);
        res.writeHead(200);
        res.end();
      } else if (req.method === "GET" && objects.has(req.url)) {
        res.writeHead(200, { "Content-Length": objects.get(req.url).length });
        res.end(objects.get(req.url));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch {
      res.writeHead(403);
      res.end("Fixture signature rejected");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const storage = new S3ObjectStorage({
    endpoint: "http://127.0.0.1:" + server.address().port,
    bucket: "local-fixture",
    region,
    accessKeyId: access,
    secretAccessKey: secret,
  });
  const archive = f.worker(storage);
  archive.create("alpha", {
    id: "http-archive",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
    maxAttempts: 1,
  });
  await archive.tick();
  assert.equal(archive.job("alpha", "http-archive").state, "completed");
  assert.equal(objects.size, 3);
  assert.ok(
    [...objects.keys()].every((key) => key.startsWith("/local-fixture/alpha/")),
  );
  rmSync(f.segments[0].path);
  archive.restore("alpha", "http-archive");
  await archive.tick();
  assert.equal(archive.job("alpha", "http-archive").restore.state, "completed");
  assert.equal(
    (await f.recorder.media("alpha", "recorded", f.segments[0].id)).sha256,
    f.segments[0].sha256,
  );
  assert.ok(requests >= 9);
});
