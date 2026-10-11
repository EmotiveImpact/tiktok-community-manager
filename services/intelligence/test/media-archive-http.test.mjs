import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EvidenceStore } from "../src/store.mjs";
import { Recorder } from "../src/recorder.mjs";
import { MediaArchive } from "../src/media-archive.mjs";
import { Governance } from "../src/governance.mjs";
import { objectStorageFromEnvironment } from "../src/storage-config.mjs";
import { Fault } from "../src/validation.mjs";
import { createIntelligenceServer, SCOPES } from "../src/server.mjs";
import {
  FilesystemObjectStorage,
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
async function until(check, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Actual recorder fixture did not complete within its bound");
}
async function fixture(t, { record = false, configured = true, speech } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "livelens-media-archive-http-"));
  const store = new EvidenceStore(join(directory, "evidence.sqlite"));
  let recorder, mediaArchive, server;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await mediaArchive?.close();
    await recorder?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  for (const workspace of ["alpha", "beta"])
    store.createSession(workspace, {
      id: "fixture",
      platform: "fixture",
      title: "Generated archive HTTP fixture",
      sourceUrl: "https://example.invalid/archive-http",
      startedAtMs: 1000,
    });
  const input = join(directory, "fixture.mp4");
  if (record)
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=10",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);
  const backing = new FilesystemObjectStorage(
    join(directory, "private-objects"),
  );
  const encryptionKey = Buffer.alloc(32, 23);
  if (configured) {
    recorder = new Recorder({
      store,
      ffmpeg,
      mediaRoot: join(directory, "media"),
      sources: record
        ? [
            {
              id: "source",
              workspace: "alpha",
              sessionId: "fixture",
              kind: "file",
              input,
            },
          ]
        : [],
    });
    if (record) {
      recorder.create("alpha", {
        id: "recorded",
        sessionId: "fixture",
        sourceId: "source",
        maxDurationSeconds: 15,
        segmentSeconds: 2,
      });
      recorder.start();
      await until(() => {
        const job = recorder.job("alpha", "recorded");
        if (job.state === "failed")
          throw new Error("Actual FFmpeg fixture failed: " + job.error);
        return job.state === "completed";
      });
      assert.ok(recorder.job("alpha", "recorded").segments.length >= 2);
    }
    mediaArchive = new MediaArchive({
      store,
      recorder,
      storage: new EncryptedObjectStorage(backing, encryptionKey),
    });
  }
  const keys = [
    {
      token: "1".repeat(40),
      workspace: "alpha",
      subject: "operator",
      scopes: SCOPES,
    },
    {
      token: "2".repeat(40),
      workspace: "beta",
      subject: "operator",
      scopes: SCOPES,
    },
    {
      token: "3".repeat(40),
      workspace: "alpha",
      subject: "viewer",
      scopes: SCOPES,
    },
    {
      token: "4".repeat(40),
      workspace: "alpha",
      subject: "reader",
      scopes: ["recordings:read"],
    },
    {
      token: "5".repeat(40),
      workspace: "alpha",
      subject: "writer",
      scopes: ["recordings:write"],
    },
    {
      token: "6".repeat(40),
      workspace: "alpha",
      subject: "revoked",
      scopes: SCOPES,
    },
  ];
  const governance = new Governance({
    store,
    recorder,
    members: keys.map((key) => ({
      workspace: key.workspace,
      subject: key.subject,
      role:
        key.subject === "operator"
          ? "owner"
          : key.subject === "viewer"
            ? "viewer"
            : key.subject === "revoked"
              ? "revoked"
              : "analyst",
    })),
  });
  server = createIntelligenceServer({
    store,
    keys,
    recorder,
    mediaArchive,
    governance,
    speech,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (
    path,
    { token = keys[0].token, method = "GET", body, headers = {} } = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return {
    directory,
    store,
    recorder,
    mediaArchive,
    backing,
    encryptionKey,
    keys,
    call,
  };
}

function publicReceipt(receipt, f) {
  const json = JSON.stringify(receipt);
  assert.ok(!json.includes("objectKey"));
  assert.ok(!json.includes("object_key"));
  assert.ok(!json.includes("localPath"));
  assert.ok(!json.includes(f.directory));
  assert.ok(!json.includes(f.encryptionKey.toString("base64url")));
  assert.ok(!json.includes("private-objects"));
  assert.ok(!json.includes("file://"));
}

test("actual HTTP encrypted archive receipts and explicit restore recover missing and damaged verified FFmpeg media", async (t) => {
  const f = await fixture(t, { record: true });
  const recording = f.recorder.job("alpha", "recorded");
  const originals = await Promise.all(
    recording.segments.map(async (segment) => {
      const media = await f.recorder.media("alpha", "recorded", segment.id);
      return {
        id: segment.id,
        path: media.path,
        bytes: readFileSync(media.path),
        sha256: segment.sha256,
      };
    }),
  );
  const value = {
    id: "archive",
    recordingJobId: "recorded",
    maxDurationSeconds: 10,
    maxAttempts: 1,
  };
  const created = await f.call("/v1/media-archives", {
    method: "POST",
    body: value,
  });
  assert.equal(created.status, 201);
  const queued = await created.json();
  assert.equal(queued.state, "queued");
  publicReceipt(queued, f);
  const retry = await f.call("/v1/media-archives", {
    method: "POST",
    body: value,
  });
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).manifestSha256, queued.manifestSha256);
  await f.mediaArchive.tick();
  const received = await f.call("/v1/media-archives/archive");
  assert.equal(received.status, 200);
  const receipt = await received.json();
  const configuredCaps = await (await f.call("/v1/capabilities")).json();
  assert.ok(configuredCaps.enabled.includes("verified-media-archive"));
  assert.equal(configuredCaps.workers.mediaArchive.enabled, true);
  // Explicit injected instances do not claim encrypted runtime configuration.
  assert.equal(configuredCaps.workers.mediaArchive.encrypted, false);
  assert.equal(
    (await f.call("/v1/media-archives/archive", { token: f.keys[1].token }))
      .status,
    404,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives/archive/restore", {
        token: f.keys[1].token,
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives", {
        token: f.keys[1].token,
        method: "POST",
        body: { recordingJobId: "recorded" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives/archive/restore", {
        token: f.keys[3].token,
        method: "POST",
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/v1/media-archives/archive", { token: f.keys[3].token }))
      .status,
    200,
  );
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.storage.verifiedReadback, true);
  assert.ok(receipt.segments.every((segment) => segment.state === "verified"));
  publicReceipt(receipt, f);
  const list = await f.call("/v1/media-archives");
  assert.equal(list.status, 200);
  assert.equal((await list.json()).archives[0].id, "archive");
  const manifest = JSON.parse(
    f.store.db
      .prepare("SELECT manifest FROM media_archives WHERE workspace=? AND id=?")
      .get("alpha", "archive").manifest,
  );
  const ciphertext = await f.backing.get(
    "alpha",
    manifest.segments[0].objectKey,
  );
  assert.equal(ciphertext.subarray(0, 6).toString(), "LLOBJ1");
  assert.notDeepEqual(ciphertext, originals[0].bytes);
  rmSync(originals[0].path);
  writeFileSync(originals[1].path, "Known local fixture damage");
  await assert.rejects(
    () => f.recorder.media("alpha", "recorded", originals[0].id),
    /media_unavailable/,
  );
  await assert.rejects(
    () => f.recorder.media("alpha", "recorded", originals[1].id),
    /media_integrity_failed/,
  );
  const missing = await f.call("/v1/media/recorded/" + originals[0].id);
  assert.equal(missing.status, 410);
  assert.equal((await missing.json()).error, "media_unavailable");
  const damaged = await f.call("/v1/media/recorded/" + originals[1].id);
  assert.equal(damaged.status, 409);
  assert.equal((await damaged.json()).error, "media_integrity_failed");
  // Reading the archived receipt must not silently replace damaged media.
  await f.call("/v1/media-archives/archive");
  assert.equal(
    readFileSync(originals[1].path, "utf8"),
    "Known local fixture damage",
  );
  const restore = await f.call("/v1/media-archives/archive/restore", {
    method: "POST",
    body: {},
  });
  assert.ok(restore.status >= 200 && restore.status < 300);
  assert.equal((await restore.json()).restore.state, "queued");
  await f.mediaArchive.tick();
  const restored = await (await f.call("/v1/media-archives/archive")).json();
  assert.equal(restored.restore.state, "completed");
  publicReceipt(restored, f);
  for (const original of originals) {
    assert.equal(
      (await f.recorder.media("alpha", "recorded", original.id)).sha256,
      original.sha256,
    );
    const response = await f.call("/v1/media/recorded/" + original.id);
    assert.equal(response.status, 200);
    assert.equal(
      sha(Buffer.from(await response.arrayBuffer())),
      original.sha256,
    );
  }
  const range = await f.call("/v1/media/recorded/" + originals[0].id, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal(range.status, 206);
  assert.deepEqual(
    Buffer.from(await range.arrayBuffer()),
    originals[0].bytes.subarray(0, 100),
  );
});

test("archive HTTP actions independently enforce scopes, governance roles, workspace isolation and trusted storage configuration", async (t) => {
  const f = await fixture(t);
  const value = { recordingJobId: "recorded" };
  assert.equal(
    (await f.call("/v1/media-archives", { token: null })).status,
    401,
  );
  assert.equal(
    (await f.call("/v1/media-archives", { token: f.keys[4].token })).status,
    403,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives", {
        token: f.keys[3].token,
        method: "POST",
        body: value,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives", {
        token: f.keys[2].token,
        method: "POST",
        body: value,
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/v1/media-archives", { token: f.keys[5].token })).status,
    403,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives", {
        headers: { Origin: "https://untrusted.invalid" },
      })
    ).status,
    403,
  );
  assert.deepEqual(
    (
      await (
        await f.call("/v1/media-archives", { token: f.keys[1].token })
      ).json()
    ).archives,
    [],
  );
  for (const body of [
    { ...value, id: "../outside" },
    { ...value, recordingJobId: "../outside" },
    { ...value, workspace: "beta" },
    { ...value, storageUrl: "https://untrusted.invalid/bucket" },
    { ...value, objectKey: "../escape" },
    { ...value, localPath: "/tmp/arbitrary" },
  ]) {
    const response = await f.call("/v1/media-archives", {
      method: "POST",
      body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(
    (await f.call("/v1/media-archives/nonexistent", { token: f.keys[1].token }))
      .status,
    404,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives/nonexistent/restore", {
        token: f.keys[1].token,
        method: "POST",
        body: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives/nonexistent/restore", {
        token: f.keys[2].token,
        method: "POST",
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/v1/media-archives/nonexistent/restore", {
        method: "POST",
        body: { url: "https://untrusted.invalid" },
      })
    ).status,
    400,
  );
  assert.equal(f.mediaArchive.list("alpha").length, 0);
});

test("unconfigured archive storage reports unavailable capability and refuses archive actions", async (t) => {
  const f = await fixture(t, { configured: false });
  const capabilities = await (await f.call("/v1/capabilities")).json();
  assert.ok(!capabilities.enabled.includes("verified-media-archive"));
  assert.equal(capabilities.workers.mediaArchive.enabled, false);
  assert.equal(capabilities.workers.mediaArchive.encrypted, false);
  const list = await f.call("/v1/media-archives");
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).archives, []);
  for (const request of [
    {
      path: "/v1/media-archives",
      method: "POST",
      body: { recordingJobId: "recorded" },
    },
    { path: "/v1/media-archives/missing" },
    { path: "/v1/media-archives/missing/restore", method: "POST", body: {} },
  ]) {
    const response = await f.call(request.path, request);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "media_archive_unavailable");
  }
});

test("object storage runtime configuration requires a named canonical 32-byte encryption secret and rejects request-shaped fields", (t) => {
  assert.equal(objectStorageFromEnvironment({}), undefined);
  const directory = mkdtempSync(join(tmpdir(), "livelens-storage-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = Buffer.alloc(32, 19).toString("base64url");
  const value = {
    backend: "filesystem",
    root: directory,
    encryptionKeyEnv: "LL_ARCHIVE_TEST_KEY",
  };
  const envFor = (config, secret = key) => ({
    LIVELENS_OBJECT_STORAGE: JSON.stringify(config),
    ...(secret === undefined ? {} : { LL_ARCHIVE_TEST_KEY: secret }),
  });
  const fail = (env, code) =>
    assert.throws(
      () => objectStorageFromEnvironment(env),
      (error) => error instanceof Fault && error.code === code,
    );
  fail(
    { LIVELENS_OBJECT_STORAGE: "not-json" },
    "invalid_object_storage_configuration",
  );
  fail(
    { LIVELENS_OBJECT_STORAGE: JSON.stringify(value) },
    "object_storage_secret_required",
  );
  fail(
    envFor({ ...value, encryptionKeyEnv: "lowercase_secret" }),
    "object_storage_secret_required",
  );
  for (const secret of [
    key.slice(0, -1),
    key + "=",
    key.slice(0, -1) + "x",
    "raw unencoded secret",
  ])
    fail(envFor(value, secret), "object_encryption_key_required");
  for (const field of [
    "workspace",
    "recordingJobId",
    "storageUrl",
    "objectKey",
    "localPath",
    "token",
    "key",
    "command",
  ])
    fail(
      envFor({ ...value, [field]: "untrusted request data" }),
      "unknown_field",
    );
  for (const config of [
    { ...value, backend: "unrecognised" },
    { ...value, endpoint: "https://untrusted.invalid" },
    { ...value, bucket: "wrong-backend" },
    { ...value, backend: "s3" },
    { ...value, root: "" },
  ])
    fail(envFor(config), "invalid_object_storage_configuration");
});

test("configured filesystem storage encrypts actual bytes at rest and returns exact authenticated plaintext", async (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "livelens-storage-config-bytes-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = Buffer.alloc(32, 29).toString("base64url");
  const storage = objectStorageFromEnvironment({
    LIVELENS_OBJECT_STORAGE: JSON.stringify({
      backend: "filesystem",
      root: directory,
      encryptionKeyEnv: "LL_ARCHIVE_TEST_KEY",
    }),
    LL_ARCHIVE_TEST_KEY: key,
  });
  assert.ok(storage instanceof EncryptedObjectStorage);
  const plaintext = Buffer.from(
    "Known synthetic plaintext fixture, never an environment secret",
  );
  await storage.put("alpha", "recordings/fixture/segment.mp4", plaintext);
  const sealed = readFileSync(
    join(directory, "alpha", "recordings", "fixture", "segment.mp4"),
  );
  assert.equal(sealed.subarray(0, 6).toString(), "LLOBJ1");
  assert.notDeepEqual(sealed, plaintext);
  assert.ok(!sealed.includes(plaintext));
  assert.deepEqual(
    await storage.get("alpha", "recordings/fixture/segment.mp4", {
      maxBytes: plaintext.length,
    }),
    plaintext,
  );
  await assert.rejects(() =>
    storage.get("beta", "recordings/fixture/segment.mp4"),
  );
  await assert.rejects(
    () => storage.put("alpha", "../outside", plaintext),
    /invalid_object_key/,
  );
});

test("overview does not expose scoped recording metadata to an evidence-only principal", async (t) => {
  const store = new EvidenceStore();
  const privateJobs = [
    {
      id: "private-recording",
      sourceId: "private-source",
      segments: [{ id: "private-segment", sha256: "private-hash-receipt" }],
    },
  ];
  const recorder = {
    list: () => privateJobs,
    workerError: "private-worker-state",
  };
  const keys = [
    {
      token: "a".repeat(40),
      workspace: "alpha",
      subject: "evidence-reader",
      scopes: ["sessions:read", "cases:read", "evidence:read"],
    },
    {
      token: "b".repeat(40),
      workspace: "alpha",
      subject: "recording-reader",
      scopes: [
        "sessions:read",
        "cases:read",
        "evidence:read",
        "recordings:read",
      ],
    },
  ];
  const governance = new Governance({
    store,
    members: keys.map((key) => ({
      workspace: key.workspace,
      subject: key.subject,
      role: "viewer",
    })),
  });
  const server = createIntelligenceServer({
    store,
    recorder,
    keys,
    governance,
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = async (path, key) =>
    fetch("http://127.0.0.1:" + server.address().port + path, {
      headers: { Authorization: "Bearer " + key.token },
    });
  const withoutPermission = await request("/v1/overview", keys[0]);
  assert.equal(withoutPermission.status, 200);
  const redacted = await withoutPermission.json();
  assert.deepEqual(redacted.recordings, []);
  assert.equal(redacted.worker, null);
  assert.ok(!JSON.stringify(redacted).includes("private-recording"));
  assert.ok(!JSON.stringify(redacted).includes("private-worker-state"));
  assert.equal((await request("/v1/jobs", keys[0])).status, 403);
  const withPermission = await request("/v1/overview", keys[1]);
  assert.equal(withPermission.status, 200);
  const full = await withPermission.json();
  assert.deepEqual(full.recordings, privateJobs);
  assert.equal(full.worker.error, "private-worker-state");
});

test("malformed recording and speech job identifiers fail before database lookup or worker dispatch", async (t) => {
  let queries = 0,
    dispatched = 0;
  const speech = {
    db: {
      prepare() {
        queries++;
        throw new Error(
          "Malformed identifiers must not reach a database lookup",
        );
      },
    },
    create() {
      dispatched++;
      throw new Error("Malformed identifiers must not dispatch speech");
    },
  };
  const f = await fixture(t, { speech });
  for (const id of [{}, []])
    for (const path of ["/v1/jobs", "/v1/speech/jobs"]) {
      const response = await f.call(path, {
        method: "POST",
        body: {
          id,
          sessionId: "fixture",
          sourceId: "source",
          recordingJobId: "recorded",
        },
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, "invalid_identifier");
    }
  assert.equal(queries, 0);
  assert.equal(dispatched, 0);
});

test("overview case counts include all permitted cases beyond one page and exclude restricted cases without grants", async (t) => {
  const store = new EvidenceStore(),
    token = "c".repeat(40);
  const governance = new Governance({
    store,
    members: [
      { workspace: "alpha", subject: "owner", role: "owner" },
      { workspace: "alpha", subject: "reviewer", role: "viewer" },
    ],
  });
  t.after(() => store.close());
  for (let i = 0; i < 205; i++)
    store.createCase(
      "alpha",
      { id: "public_" + i, title: "Case " + i, question: "Review the sources" },
      "owner",
    );
  for (const id of ["restricted", "shared", "created-by-reviewer"]) {
    store.createCase(
      "alpha",
      { id, title: id, question: "Selected access" },
      id === "created-by-reviewer" ? "reviewer" : "owner",
    );
    governance.grantCase(
      "alpha",
      id,
      { visibility: "restricted", reason: "Selected investigation access" },
      "owner",
    );
  }
  governance.grantCase(
    "alpha",
    "shared",
    {
      subject: "reviewer",
      permission: "read",
      reason: "Reviewer may read this case",
    },
    "owner",
  );
  const server = createIntelligenceServer({
    store,
    governance,
    keys: [
      {
        token,
        workspace: "alpha",
        subject: "reviewer",
        scopes: ["sessions:read", "evidence:read", "cases:read"],
      },
    ],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const response = await fetch(
    "http://127.0.0.1:" + server.address().port + "/v1/overview",
    { headers: { Authorization: "Bearer " + token } },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cases, 207);
});
