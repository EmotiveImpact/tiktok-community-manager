# LiveLens intelligence service

A runnable first backend for session evidence, search, investigations and agent
queries. Node 24 or later, no third-party runtime packages. SQLite is the pilot
store. The first release adds the same-origin operator console and an optional
Linux/Python/FFmpeg recorder. See [first-release instructions](../../docs/livelens/FIRST_RELEASE.md)
for authentication, source configuration, desktop archiving and browser/recording reproduction.

Implemented: workspace-bound API keys and scopes; persistent sessions and original
events; content-sensitive idempotent ingestion; source/collector/receipt clocks;
anonymous speaker tracks; append-only operator attribution history; case evidence
links; JSON/Markdown reports; local hash-chain verification; JavaScript and Python
clients. The synthetic demo writes a database, closes it, reopens it and exports
the retained evidence.

## Try the demo and tests

```bash
npm --prefix services/intelligence run demo
npm --prefix services/intelligence test
```

No live account is connected by these commands. The demo uses fictional fixtures,
creates a temporary database and removes it after the demonstration.

## Start the API

Set `LIVELENS_API_KEYS` to a JSON array held in your private environment:

```json
[
  {
    "token": "REPLACE_WITH_A_RANDOM_TOKEN_OF_AT_LEAST_32_CHARACTERS",
    "workspace": "your_workspace",
    "subject": "operator",
    "scopes": ["sessions:read", "sessions:write", "evidence:read", "evidence:write", "assertions:write", "cases:read", "cases:write"]
  }
]
```

Generate tokens with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'`.
Never commit the populated configuration. Give the ALFRED client a separate key
with only `sessions:read`, `evidence:read` and `cases:read` initially.

```bash
npm --prefix services/intelligence start
```

Default address: `127.0.0.1:4318`. Default database: `./data/intelligence.sqlite`
relative to the service working directory. Optional variables: `LIVELENS_DB_PATH`,
`LIVELENS_HOST`, `LIVELENS_PORT`. The service refuses to start without keys.
`compose.yml` binds the container port to host loopback and keeps its database in
a named volume. The container scaffold has not been built or deployed here.

## API

Use `Authorization: Bearer <token>` and JSON request bodies. The token establishes
the workspace; body fields cannot select a different one. Browser bearer requests
remain refused. The configured same-origin console uses a separate scoped cookie
session and CSRF protection; broad API keys remain outside the browser.

| Method and path | Scope | Result |
|---|---|---|
| GET `/health` | None | Minimal service liveness |
| GET `/v1/capabilities` | Any valid key | Implemented/planned features and caller scopes |
| GET/POST `/v1/sessions` | sessions:read/write | List or create sessions |
| GET `/v1/sessions/:id` | sessions:read | Session provenance |
| GET/POST `/v1/sessions/:id/events` | evidence:read/write | Paginated journal or atomic ingestion |
| GET `/v1/sessions/:id/integrity` | evidence:read | Local chain verification |
| GET `/v1/evidence/search?q=&account=&session=&limit=` | evidence:read | Literal text and observed/asserted account search |
| GET `/v1/evidence/:id` | evidence:read | Original event and current attribution |
| GET/POST `/v1/evidence/:id/assertions` | evidence:read / assertions:write | Attribution history or an operator assertion |
| POST `/v1/cases` | cases:write | Create an investigation question |
| POST `/v1/cases/:id/evidence` | cases:write + evidence:read | Link up to 200 evidence IDs |
| GET `/v1/cases/:id/report?format=markdown` | cases:read + evidence:read | JSON by default, Markdown optionally |

Create a session with `{id?, platform, account?, sourceUrl, title, startedAtMs}`.
Ingest `{events: [...]}` with up to 200 events and a maximum 1 MiB request:

```json
{
  "source": {"adapter": "your-collector", "eventId": "provider-id-123"},
  "kind": "transcript",
  "text": "Words actually returned by the speech provider",
  "speakerId": "speaker-1",
  "sourceTimestampMs": 1791657600000,
  "capturedAtMs": 1791657600400,
  "raw": {"providerConfidence": 0.87}
}
```

Event kinds: chat, caption, transcript, observation, gap. Source timestamps may be
null and are never replaced by receipt timestamps. Speech cannot carry an account
handle in the original event contract; add an explicitly labelled operator
assertion separately. Event IDs are scoped by workspace, session, adapter and
provider ID. Matching retries return the original event; conflicting content
under the same identity refuses the entire batch with HTTP 409.

Create a case with `{id?, title, question}`; link with `{evidenceIds:[...]}`; assert
an account with `{account, reason}`. The reviewer comes from the API principal.
Reports contain captured statements, source references, assertion history and
integrity information. They do not perform semantic AI reasoning.

## Practical limits

Additional bounded routes: GET `/v1/overview`, GET `/v1/cases`, GET `/v1/cases/:id`,
GET `/v1/evidence/:id/context`, GET `/v1/sources`, GET/POST `/v1/jobs`,
GET `/v1/jobs/:id`, POST `/v1/jobs/:id/stop`, GET `/v1/sessions/:id/media`,
and GET `/v1/media/:job/:segment`. Session/case lists accept bounded `offset` and
`limit`. Recorder routes use `recordings:read` / `recordings:write`; media never
leaves the authenticated workspace. Existing bearer/SDK routes are unchanged.

SQLite and synchronous bounded API operations are suitable for this pilot, not a
proven high-volume commercial service. Case exports are capped at 1,000 linked
events; searches/pages at 200. There is no billing, case-level ACL, encryption,
deletion/retention lifecycle, distributed scheduling or local speech model yet.
The optional recorder stores local media and durable bounded jobs; it is not a
multi-stream scheduler. A database administrator can rewrite an entire local chain;
external signing, retained checkpoints and trusted timestamps are future work.

The SDK has been exercised against the actual HTTP service with synthetic data.
No real TikTok broadcast, speech provider, VPS or registered ALFRED tool has been
validated by this milestone. See the platform roadmap for the next acceptance gates.
