import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createSourceAdapters } from "./source-adapters.mjs";
import { Fault, ident, object, sourceUrl, text } from "./validation.mjs";

const schema = `CREATE TABLE IF NOT EXISTS configured_sources(
 workspace TEXT NOT NULL,id TEXT NOT NULL,configuration TEXT NOT NULL,created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,id));`;

function ipv4Public(host) {
  const n = host.split(".").map(Number),
    [a, b, c] = n;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}
function ipv6Parts(host) {
  const [left, right] = host.toLowerCase().split("::");
  const l = left ? left.split(":") : [],
    r = right ? right.split(":") : [];
  return (
    right === undefined
      ? l
      : [...l, ...Array(8 - l.length - r.length).fill("0"), ...r]
  ).map((x) => parseInt(x || "0", 16));
}
export function publicMediaUrl(value) {
  text(value, 8192);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Fault("https_media_required");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Fault("https_media_required");
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    (!host.includes(".") && !isIP(host)) ||
    /\.(localhost|local|internal|lan|home|arpa)$/.test(host)
  )
    throw new Fault("public_media_url_required");
  if (isIP(host) === 4 && !ipv4Public(host))
    throw new Fault("public_media_url_required");
  if (isIP(host) === 6) {
    const p = ipv6Parts(host),
      first = p[0];
    // Global unicast only; IPv4-mapped addresses additionally obey the IPv4 rule.
    const mapped = p.slice(0, 5).every((x) => x === 0) && p[5] === 0xffff;
    if (mapped) {
      if (!ipv4Public(`${p[6] >> 8}.${p[6] & 255}.${p[7] >> 8}.${p[7] & 255}`))
        throw new Fault("public_media_url_required");
    } else if (
      (first & 0xe000) !== 0x2000 ||
      (first === 0x2001 && p[1] === 0x0db8)
    )
      throw new Fault("public_media_url_required");
  }
  return url.href;
}

/** Owner-managed source selection. Private media URLs remain in the server database. */
export class SourceCatalog {
  constructor({ store, scheduler, adaptersOptions = {}, governance }) {
    if (!scheduler) throw new Fault("scheduler_required");
    this.store = store;
    this.db = store.db;
    this.scheduler = scheduler;
    this.options = adaptersOptions;
    this.governance = governance;
    this.db.exec(schema);
    this.load();
  }
  load() {
    for (const row of this.db
      .prepare("SELECT * FROM configured_sources ORDER BY workspace,id")
      .all()) {
      if (
        this.scheduler.adapters.some(
          (a) => a.workspace === row.workspace && a.id === row.id,
        )
      )
        continue;
      const config = JSON.parse(row.configuration);
      if (config.kind === "https") publicMediaUrl(config.input);
      const [adapter] = createSourceAdapters([config], this.options);
      this.scheduler.adapters.push(adapter);
    }
  }
  sourcesFor(workspace) {
    return this.scheduler.sourcesFor(workspace);
  }
  list(workspace) {
    return this.sourcesFor(workspace);
  }
  create(workspace, value) {
    ident(workspace);
    object(value, [
      "id",
      "kind",
      "input",
      "account",
      "label",
      "platform",
      "sourceUrl",
    ]);
    const id = value.id == null ? randomUUID() : ident(value.id);
    if (!["https", "tiktok-public"].includes(value.kind))
      throw new Fault("invalid_source_kind");
    const config = {
      ...value,
      id,
      workspace,
      label:
        value.label ??
        (value.kind === "tiktok-public"
          ? `@${value.account ?? ""}`
          : "Selected media"),
    };
    text(config.label, 256);
    if (value.kind === "https") {
      if (value.account !== undefined) throw new Fault("unknown_field");
      config.input = publicMediaUrl(value.input);
      if (value.sourceUrl != null)
        config.sourceUrl = sourceUrl(value.sourceUrl);
    } else {
      if (
        value.input !== undefined ||
        value.platform !== undefined ||
        value.sourceUrl !== undefined
      )
        throw new Fault("unknown_field");
      // Optional server credential routing is configured outside this browser contract.
      config.eulerFallbacks = false;
    }
    const [adapter] = createSourceAdapters([config], this.options);
    this.store.transaction(() => {
      if (
        this.scheduler.adapters.some(
          (a) => a.workspace === workspace && a.id === id,
        ) ||
        this.db
          .prepare(
            "SELECT 1 FROM configured_sources WHERE workspace=? AND id=?",
          )
          .get(workspace, id)
      )
        throw new Fault("source_exists", 409);
      if (this.sourcesFor(workspace).length >= 20)
        throw new Fault("source_capacity", 409);
      this.db
        .prepare("INSERT INTO configured_sources VALUES(?,?,?,?)")
        .run(workspace, id, JSON.stringify(config), Date.now());
    });
    this.scheduler.adapters.push(adapter);
    return adapter.descriptor();
  }
}
