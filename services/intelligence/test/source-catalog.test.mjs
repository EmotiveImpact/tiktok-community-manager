import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../src/store.mjs";
import { SourceCatalog, publicMediaUrl } from "../src/source-catalog.mjs";

test("owner-selected source descriptors persist across restart and never fetch or expose signed input", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "livelens-source-catalog-")),
    path = join(dir, "db.sqlite");
  let store = new EvidenceStore(path);
  const stub = () => ({
    adapters: [],
    sourcesFor(workspace) {
      return this.adapters
        .filter((a) => a.workspace === workspace)
        .map((a) => a.descriptor());
    },
  });
  let scheduler = stub(),
    catalog = new SourceCatalog({ store, scheduler });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const source = catalog.create("alpha", {
    id: "allowed",
    kind: "https",
    input: "https://media.example.com/video.mp4?signature=private",
    label: "Permitted media",
  });
  assert.equal(source.kind, "https");
  assert.equal(source.platform, "direct-media");
  assert.equal(source.providerValidated, false);
  assert.equal(JSON.stringify(source).includes("private"), false);
  assert.equal(JSON.stringify(source).includes("media.example"), false);
  catalog.create("beta", {
    id: "allowed",
    kind: "tiktok-public",
    account: "fictional_account",
  });
  assert.equal(catalog.sourcesFor("alpha").length, 1);
  assert.equal(catalog.sourcesFor("beta")[0].account, "fictional_account");
  assert.throws(
    () =>
      catalog.create("alpha", {
        id: "allowed",
        kind: "https",
        input: "https://example.com",
      }),
    /source_exists/,
  );
  store.close();
  store = new EvidenceStore(path);
  scheduler = stub();
  catalog = new SourceCatalog({ store, scheduler });
  assert.deepEqual(catalog.list("alpha"), [source]);
  assert.equal(scheduler.adapters.length, 2);
  assert.throws(
    () => catalog.create("alpha", { kind: "file", input: "/etc/passwd" }),
    /invalid_source_kind/,
  );
  assert.throws(
    () =>
      catalog.create("alpha", {
        kind: "tiktok-public",
        account: "fictional",
        signApiKeyEnv: "CLIENT_OVERRIDE",
      }),
    /unknown_field/,
  );
});

test("browser source URLs reject private addresses, alternate literals, credentials and local names", () => {
  for (const input of [
    "http://example.com/video",
    "https://localhost/video",
    "https://127.0.0.1/video",
    "https://2130706433/video",
    "https://0x7f000001/video",
    "https://0177.0.0.1/video",
    "https://10.1.2.3/video",
    "https://169.254.169.254/video",
    "https://192.168.1.2/video",
    "https://172.16.0.1/video",
    "https://[::1]/video",
    "https://[::ffff:127.0.0.1]/video",
    "https://[fc00::1]/video",
    "https://server.internal/video",
    "https://server.local/video",
    "https://user:secret@example.com/video",
    "https://example.com/video#fragment",
  ])
    assert.throws(
      () => publicMediaUrl(input),
      /https_media_required|public_media_url_required/,
      input,
    );
  assert.equal(
    publicMediaUrl("https://1.1.1.1/video"),
    "https://1.1.1.1/video",
  );
  assert.equal(
    publicMediaUrl("https://[2606:4700:4700::1111]/video"),
    "https://[2606:4700:4700::1111]/video",
  );
});

test("source selection is capped without creating missions, jobs or background work", (t) => {
  const store = new EvidenceStore();
  t.after(() => store.close());
  const scheduler = {
    adapters: [],
    sourcesFor(workspace) {
      return this.adapters
        .filter((a) => a.workspace === workspace)
        .map((a) => a.descriptor());
    },
  };
  const catalog = new SourceCatalog({ store, scheduler });
  for (let i = 0; i < 20; i++)
    catalog.create("alpha", {
      id: "source_" + i,
      kind: "https",
      input: "https://example.com/" + i,
    });
  assert.throws(
    () =>
      catalog.create("alpha", {
        id: "overflow",
        kind: "https",
        input: "https://example.com/media",
      }),
    /source_capacity/,
  );
  assert.equal(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='collection_missions'",
      )
      .get().n,
    0,
  );
});
