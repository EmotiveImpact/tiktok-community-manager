import { realpathSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  Fault,
  handle,
  ident,
  object,
  sourceUrl,
  text,
} from "./validation.mjs";

const require = createRequire(import.meta.url);
const configurationFields = [
  "id",
  "workspace",
  "kind",
  "input",
  "sessionId",
  "label",
  "platform",
  "sourceUrl",
  "account",
  "signApiKeyEnv",
  "eulerFallbacks",
];
function privateHttps(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Fault("https_media_required");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Fault("https_media_required");
  return value;
}
function base(config) {
  object(config, configurationFields);
  ident(config.id);
  ident(config.workspace);
  if (config.label != null) text(config.label, 256);
  if (config.sessionId != null) ident(config.sessionId);
  return {
    id: config.id,
    workspace: config.workspace,
    label: config.label ?? config.id,
  };
}
function providerTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  return Number.isSafeInteger(ms) ? ms : null;
}
function pickUrl(info) {
  const stream = info.stream_url ?? info.streamUrl ?? {};
  for (const candidate of [
    stream.hls_pull_url,
    ...Object.values(stream.hls_pull_url_map ?? {}),
    ...Object.values(stream.flv_pull_url ?? {}),
    stream.rtmp_pull_url,
  ]) {
    if (typeof candidate !== "string") continue;
    try {
      return privateHttps(candidate);
    } catch {}
  }
  return null;
}

/** Explicit operator-supplied media. A generated file is a fixture, not another LIVE provider. */
export class DirectMediaAdapter {
  constructor(config, { fetchImpl = fetch } = {}) {
    Object.assign(this, base(config));
    if (!["file", "https"].includes(config.kind))
      throw new Fault("invalid_adapter_kind");
    this.config = { ...config };
    this.kind = config.kind;
    this.fetch = fetchImpl;
    if (config.kind === "https") privateHttps(config.input);
    this.platform =
      config.kind === "file"
        ? "fixture"
        : ident(config.platform ?? "direct-media");
    this.provenance = sourceUrl(
      config.sourceUrl ??
        (config.kind === "file"
          ? "https://example.invalid/operator-fixture"
          : config.input.split("?")[0]),
    );
    this.account = handle(config.account);
    if (config.kind === "file") {
      this.config.input = realpathSync(config.input);
      if (!statSync(this.config.input).isFile())
        throw new Fault("fixture_file_required");
    }
  }
  descriptor() {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      platform: this.platform,
      account: this.account,
      sessionId: this.config.sessionId ?? null,
      discovery: "operator-configured-media",
      providerValidated: false,
      fixture: this.kind === "file",
    };
  }
  async poll({ signal } = {}) {
    try {
      if (this.kind === "file") {
        if (!statSync(this.config.input).isFile())
          return { status: "unavailable", reason: "fixture_unavailable" };
      } else {
        const response = await this.fetch(this.config.input, {
          method: "HEAD",
          signal: signal ?? AbortSignal.timeout(10_000),
          redirect: "follow",
        });
        if (!response.ok || !response.url.startsWith("https:"))
          return { status: "unavailable", reason: "media_unavailable" };
      }
      return {
        status: "available",
        broadcastId: this.config.sessionId ?? this.id,
        platform: this.platform,
        account: this.account,
        title: this.label,
        sourceUrl: this.provenance,
        sourceTimestampMs: null,
        recorderSource: { kind: this.kind, input: this.config.input },
        fixture: this.kind === "file",
      };
    } catch {
      return {
        status: "unavailable",
        reason: signal?.aborted ? "poll_aborted" : "media_unavailable",
      };
    }
  }
  async subscribe() {
    return { close: async () => {} };
  }
}

/** Existing integrity-pinned npm 2.1.0 route, only for explicitly selected public accounts. */
export class TikTokPublicAdapter {
  constructor(config, { connectionFactory, env = process.env } = {}) {
    Object.assign(this, base(config));
    this.kind = "tiktok-public";
    this.account = handle(config.account);
    if (!this.account) throw new Fault("account_required");
    if (
      config.signApiKeyEnv != null &&
      !/^[A-Z][A-Z0-9_]{0,95}$/.test(config.signApiKeyEnv)
    )
      throw new Fault("invalid_credential_setting");
    if (
      config.eulerFallbacks != null &&
      typeof config.eulerFallbacks !== "boolean"
    )
      throw new Fault("invalid_adapter_configuration");
    this.options = {
      fetchRoomInfoOnConnect: true,
      processInitialData: true,
      enableExtendedGiftInfo: false,
      disableEulerFallbacks: config.eulerFallbacks !== true,
      webClientOptions: { timeout: 10_000 },
      signApiKey: config.signApiKeyEnv
        ? env[config.signApiKeyEnv] || null
        : null,
    };
    this.factory =
      connectionFactory ??
      ((account, options) => {
        const { WebcastPushConnection } = require("tiktok-live-connector");
        return new WebcastPushConnection(account, options);
      });
  }
  descriptor() {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      platform: "tiktok",
      account: this.account,
      discovery: "selected-public-account",
      providerValidated: false,
      fixture: false,
    };
  }
  client(signal) {
    const client = this.factory(this.account, {
      ...this.options,
      webClientOptions: { ...this.options.webClientOptions, signal },
    });
    // Connector errors contain URLs/provider data. Persist only bounded classification, never raw exceptions.
    client.on("error", () => {});
    return client;
  }
  async poll({ signal } = {}) {
    const client = this.client(signal);
    try {
      if (!(await client.fetchIsLive())) return { status: "offline" };
      const roomId = String(await client.fetchRoomId());
      if (!/^[0-9]{1,64}$/.test(roomId))
        return { status: "unavailable", reason: "broadcast_id_unavailable" };
      if (client.webClient) client.webClient.roomId = roomId;
      const response = await client.fetchRoomInfo();
      const info = response?.data ?? response ?? {};
      if (info.status === 4) return { status: "offline" };
      const readable =
        info.owner?.display_id ||
        info.owner?.unique_id ||
        info.title ||
        info.create_time;
      if (!readable)
        return { status: "unavailable", reason: "public_room_unavailable" };
      const input = pickUrl(info);
      return {
        status: input ? "live" : "unavailable",
        reason: input ? null : "media_url_unavailable",
        broadcastId: roomId,
        platform: "tiktok",
        account: this.account,
        title: String(info.title ?? this.label).slice(0, 256),
        sourceUrl: `https://www.tiktok.com/@${this.account}/live`,
        sourceTimestampMs: providerTime(info.create_time),
        recorderSource: input ? { kind: "https", input } : null,
      };
    } catch {
      return {
        status: "unavailable",
        reason: signal?.aborted ? "poll_aborted" : "provider_unavailable",
      };
    } finally {
      await client.disconnect().catch(() => {});
    }
  }
  async subscribe({ broadcastId, onEvent, onGap = () => {}, signal }) {
    const client = this.client(signal),
      epoch = randomUUID();
    let sequence = 0,
      closed = false;
    const emit = (kind, value) => {
      if (closed) return;
      try {
        const providerId = value?.common?.msgId ?? value?.msgId;
        const event = {
          source: {
            adapter: "tiktok-public",
            eventId:
              providerId != null
                ? String(providerId)
                : `${epoch}-${++sequence}`,
          },
          kind,
          text: String(
            kind === "chat"
              ? (value?.comment ?? "")
              : (value?.text ?? value?.caption ?? ""),
          ).slice(0, 16_384),
          capturedAtMs: Date.now(),
          sourceTimestampMs: providerTime(
            value?.common?.createTime ?? value?.createTime,
          ),
          raw: {
            broadcastId,
            providerEventId: providerId != null ? String(providerId) : null,
            sourceClockAvailable:
              providerTime(value?.common?.createTime ?? value?.createTime) !=
              null,
          },
        };
        if (kind === "chat")
          event.account = handle(value?.user?.uniqueId ?? value?.uniqueId);
        onEvent(event);
      } catch {
        onGap("event_ingestion_failed");
      }
    };
    client.on("chat", (value) => emit("chat", value));
    client.on("caption", (value) => emit("caption", value));
    client.on("disconnected", () => {
      if (!closed) onGap("event_transport_interrupted");
    });
    client.on("error", () => {
      if (!closed) onGap("provider_event_stream_unavailable");
    });
    const close = async () => {
      closed = true;
      await client.disconnect().catch(() => {});
    };
    const abort = () => {
      void close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const state = await client.connect(broadcastId);
      if (
        signal?.aborted ||
        (state?.roomId != null && String(state.roomId) !== String(broadcastId))
      ) {
        await close();
        throw new Fault("broadcast_boundary_changed", 409);
      }
    } catch {
      await close();
      signal?.removeEventListener("abort", abort);
      throw new Fault("provider_event_stream_unavailable", 503);
    }
    return {
      close: async () => {
        signal?.removeEventListener("abort", abort);
        await close();
      },
    };
  }
}

export function createSourceAdapters(configurations = [], options = {}) {
  if (!Array.isArray(configurations) || configurations.length > 100)
    throw new Fault("invalid_adapter_configuration");
  const keys = new Set();
  return configurations.map((config) => {
    const key = config.workspace + ":" + config.id;
    if (keys.has(key)) throw new Fault("duplicate_source_adapter");
    keys.add(key);
    return config.kind === "tiktok-public"
      ? new TikTokPublicAdapter(config, options)
      : new DirectMediaAdapter(config, options);
  });
}
