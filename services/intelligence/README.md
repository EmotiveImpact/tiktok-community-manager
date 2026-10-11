# LiveLens intelligence service

The backend for the LiveLens operator console, retained media, investigations,
protection review and scoped agent access. The existing Electron community manager
remains available. See [full application status](../../docs/livelens/FULL_APPLICATION.md)
and [runtime configuration](../../docs/livelens/RUNTIME_CONFIGURATION.md) for the
current application, optional workers and deployment boundaries.

The default private pilot uses Node 24 and SQLite. Collection uses trusted Linux,
Python and FFmpeg processes; speech, model analysis, PDF rendering, PostgreSQL and
object archiving are optional. Installing or configuring a source does not start
network polling. Operators explicitly create bounded schedules or recording jobs.

The console's current direction is a capture-first account monitor with explicit
checks/watch schedules, Record/Stop, retained video/chat and recent recordings.
The [LIVE monitor operating guide](../../docs/livelens/LIVE_MONITOR.md) distinguishes
discovery, recording jobs and verified replay. A last observed LIVE status is not
a direct live-video feed. Existing fixture tests do not validate an external LIVE
or establish final visual acceptance.

## Run locally

From the repository root, the generated-media console is:

```bash
npm run console:fixture
```

It uses fictional evidence and generated recordings. The loopback development
login is `fixture` / `fixture-operator-only`; these are public fixture credentials,
not credentials for a private deployment. Stop the fixture with Ctrl+C. No TikTok
account or remote model is contacted by this command.

For the API, privately configure `LIVELENS_API_KEYS`, then run:

```bash
npm --prefix services/intelligence start
```

The default listener is `127.0.0.1:4318`. The database defaults to
`./data/intelligence.sqlite` relative to the service working directory. Browser
hosting additionally needs scoped browser users, an exact console origin and the
built bundle. [Runtime configuration](../../docs/livelens/RUNTIME_CONFIGURATION.md)
contains the full environment catalogue and worker examples. Runtime databases,
media, object archives and secrets belong outside Git.

Affected checks and demonstrations are available without contacting a LIVE:

```bash
npm --prefix services/intelligence test
npm --prefix services/intelligence run demo
npm --prefix services/intelligence run demo:recording
npm test
npm run build
```

Tests label generated media and provider fixtures. Optional native speech and
PostgreSQL checks require their documented prerequisites; a skip is not provider
or model validation. Current acceptance receipts live in
[full application status](../../docs/livelens/FULL_APPLICATION.md).

## Authentication and authority

The HTTP principal supplies the workspace and reviewer. A request body cannot
select another workspace. API clients send `Authorization: Bearer TOKEN` and
`Content-Type: application/json` for writes. Bodies are bounded to 1 MiB. Browser
bearer requests with an Origin header remain refused; the configured same-origin
console uses an HttpOnly, SameSite cookie and a separate CSRF token for writes.
Login/session/logout are `/console/login`, `/console/session`, `/console/logout`.
Browser sessions expire and are cleared on service restart.

Every route checks its API scope. When `LIVELENS_WORKSPACE_MEMBERS` enables the
governance layer, it also checks current membership and role on each request.
`owner` and `admin` can manage workspace controls; `analyst` can use permitted
writes; `viewer` is read-only; `revoked` cannot access the workspace. Only an owner
can assign owner authority, and the final owner cannot be removed. Role changes
and revocations persist across restarts; initial seeds do not overwrite them.

Cases default to workspace visibility. Owners/admins can restrict a case and
assign read/write grants to current members. Case routes enforce those grants;
filtered case lists omit inaccessible cases. Scope and role checks remain
independent: a role never supplies a missing scope. Without the optional
governance configuration, API workspace/scope isolation remains, but membership,
case grants and workspace controls are unavailable.

## API catalogue

`GET /health` is unauthenticated minimal liveness. `GET /v1/capabilities` describes
configured and unavailable features for the caller. All routes below are bound to
the authenticated workspace. IDs in paths are opaque identifiers. Read pages and
searches use bounded `limit`; session/case lists also support `offset`.

| Method and path | Required scopes | Result |
|---|---|---|
| GET `/v1/overview` | sessions:read, cases:read, evidence:read | Retained counts and recording receipts |
| GET/POST `/v1/sessions` | sessions:read / sessions:write | Literal `q` search with `limit`/`offset` / create session provenance |
| GET `/v1/sessions/:id` | sessions:read | Session provenance |
| GET/POST `/v1/sessions/:id/events` | evidence:read / evidence:write | Literal `q`, exact `kind`, sequence `after` and `limit` / atomic ingestion |
| GET `/v1/sessions/:id/integrity` | evidence:read | Local journal verification |
| GET `/v1/evidence/search?q=&account=&session=&limit=` | evidence:read | Literal text/account search |
| GET `/v1/evidence/:id` | evidence:read | Original event and current attribution |
| GET `/v1/evidence/:id/context` | evidence:read, sessions:read | Before/after context in the same session |
| GET/POST `/v1/evidence/:id/assertions` | evidence:read / assertions:write | Attribution revisions / explicit account assertion |
| GET/POST `/v1/cases` | cases:read / cases:write | Accessible cases / create question |
| GET `/v1/cases/:id` | cases:read | Accessible case |
| POST `/v1/cases/:id/evidence` | cases:write, evidence:read | Link retained evidence |
| GET `/v1/cases/:id/report?format=markdown` | cases:read, evidence:read | Original JSON/Markdown evidence export |
| GET `/v1/sources` | recordings:read | Configured source descriptors; no private media URLs |
| POST `/v1/sources` | workspace:admin, recordings:write | Persist selected public TikTok account or HTTPS media source |
| GET/POST `/v1/jobs` | recordings:read / recordings:write | Recorder receipts (`active=true` filters nonterminal jobs) / explicit bounded capture |
| GET `/v1/jobs/:id` | recordings:read | Recording progress, gaps and verified segments |
| POST `/v1/jobs/:id/stop` | recordings:write | Persist stop request |
| GET `/v1/sessions/:id/media` | recordings:read, sessions:read | Retained recording receipts |
| GET `/v1/media/:job/:segment` | recordings:read | Hash-verified MP4 replay, including bounded byte ranges |
| GET/POST `/v1/schedules` | recordings:read / recordings:write | Selected-source schedules / explicit bounded watchlist |
| POST `/v1/schedules/:id/stop` | recordings:write | Stop schedule and its current capture |
| GET/POST `/v1/media-archives` | recordings:read / recordings:write | Object archive receipts / explicit verified-media snapshot |
| GET `/v1/media-archives/:id` | recordings:read | Snapshot, readback and restore receipts |
| POST `/v1/media-archives/:id/restore` | recordings:write | Explicit bounded restore to original verified media locations |
| GET `/v1/speech/capabilities` | evidence:read | Actual configured recognition/diarisation capability |
| GET/POST `/v1/speech/jobs` | speech:read / speech:write | Speech receipts / selected retained-media transcription |
| GET `/v1/speech/jobs/:id` | speech:read | Per-input progress and transcript count |
| POST `/v1/speech/jobs/:id/stop` | speech:write | Stop speech job |
| GET `/v1/investigations/:case` | cases:read, evidence:read | Linked evidence, notes and finding revisions |
| POST `/v1/investigations/:case/notes` | cases:write, evidence:read | Source-linked operator note |
| POST `/v1/investigations/:case/findings` | cases:write, evidence:read | Draft finding with supporting/counter evidence |
| POST `/v1/investigations/:case/findings/:finding/review` | cases:write, evidence:read | Append reviewed status/reason |
| GET/POST `/v1/bookmarks` | evidence:read / evidence:read, investigations:write | Retained evidence bookmarks |
| GET `/v1/accounts/:handle/activity` | evidence:read, sessions:read | Observed/asserted activity across retained sessions |
| POST `/v1/comparisons` | evidence:read, sessions:read | Bounded comparison of selected sessions |
| GET/POST `/v1/graph` | evidence:read, sessions:read / evidence:read, investigations:write | Evidence-supported graph / reviewed relation |
| GET/POST `/v1/missions` | missions:read / missions:write, evidence:read | Protection review missions / create rules |
| POST `/v1/missions/:id` | missions:write, evidence:read | Append mission configuration revision |
| POST `/v1/missions/:id/run` | missions:write, evidence:read | Explicit contextual review over retained evidence |
| GET `/v1/alerts?mission=&limit=` | missions:read, evidence:read | In-app review candidates |
| POST `/v1/alerts/:id/review` | missions:write | Reviewed alert revision |
| GET `/v1/investigations/:case/report` | cases:read, evidence:read | Revised report metadata |
| POST `/v1/investigations/:case/report` | reports:write, cases:write, cases:read, evidence:read | Append report/redaction revision |
| GET `/v1/investigations/:case/report?format=json\|markdown\|html\|pdf` | cases:read, evidence:read | Redacted source-backed export; PDF requires configured renderer |
| GET `/v1/analysis/capabilities` | evidence:read | Configured model suggestion capability |
| POST `/v1/analysis` | analysis:write, investigations:write, evidence:read, cases:write | Explicit model request producing unreviewed findings |
| GET `/v1/workspace` | workspace:read | Role, members, limits, usage and retention |
| GET `/v1/workspace/usage` | workspace:read | Retained-media/speech metering |
| POST `/v1/workspace/limits` | workspace:admin | Manual entitlement changes with reason |
| GET/POST `/v1/workspace/members` | workspace:read / workspace:admin | Membership / role changes |
| GET `/v1/workspace/audit` | workspace:admin | Local hash-chained audit receipts |
| POST `/v1/workspace/retention` | workspace:admin | Retention policy; no automatic deletion |
| GET `/v1/workspace/retention/preview` | workspace:admin | Eligible/protected sessions and preview hash |
| POST `/v1/workspace/retention/apply` | workspace:admin | Explicit selected deletion with matching preview/reason |
| GET/POST `/v1/workspace/cases/:case/access` | workspace:admin | Restricted case policy and member grants |
| GET `/v1/agent` | sessions:read | Scoped adapter manifest; registration remains false |

Optional workers return an explicit unavailable error when unconfigured. Reports
include media only for callers with `recordings:read`; media bytes are checked
before export. Case-specific scopes in the table also enforce case permissions
when governance is enabled. Stop/restore/run endpoints expect the empty JSON
object `{}` unless their route defines a configuration body.

## Evidence and operation contracts

Create sessions with `{id?, platform, account?, sourceUrl, title, startedAtMs}`.
Ingest `{events:[...]}` atomically, with at most 200 original events:

```json
{
  "source": {"adapter":"configured-collector","eventId":"provider-event-id"},
  "kind": "chat",
  "text": "Words actually captured",
  "account": "observed_platform_account",
  "sourceTimestampMs": null,
  "capturedAtMs": 1791657600400,
  "raw": {"broadcastId":"known-provider-room-id"}
}
```

Kinds are `chat`, `caption`, `transcript`, `observation`, `gap`. Provider source,
collector capture and service receipt clocks remain separate. Missing provider
source time remains null. Matching source-event retries return the original
receipt; conflicting content under the same identity refuses the batch.
Speech carries no inferred account identity. An operator assertion is a separate
labelled revision, not a rewrite of the original evidence.

Session event reads accept `q` (up to 512 characters) and `kind` (`chat`, `caption`,
`transcript`, `observation`, `gap`, or `all`; omitted means `all`). Filtering runs
over the retained session before the bounded page is selected. The literal query
matches captured text and the current displayed account attribution, including
the latest operator assertion; prior assertions and anonymous speaker IDs are not
account matches. `%`, `_` and backslash are literal characters. Matching folds
ASCII letter case in both SQLite and PostgreSQL. Source, collector and receipt
clocks remain untouched.

The response remains `{events,nextAfter}`. Pages follow ascending journal
sequence, with `after` (default `0`) as an exclusive cursor and `limit` (default
`100`, maximum `200`). `nextAfter` is the last returned event's actual sequence,
or `null` for an empty page; it is not a total or a promise of a further match.
Carry the same `q`/`kind` when continuing; reset `after` when changing either.
This is a live retained-data query, not a snapshot: later appends can appear on
subsequent pages and a later attribution correction can change account matches.

Session library reads accept the same literal `q` over title, displayed `@account`
(both `@handle` and `handle` match) and raw platform identifier before applying
`limit` (default `100`, maximum `200`) and
`offset` (default `0`). The response remains `{sessions}`, ordered by newest
session start, then ID. Reset the offset when changing the query. Offset pages
can shift when sessions are added or removed; no total or snapshot is implied.

Recording creation is `{id?,sessionId,sourceId,maxDurationSeconds?,segmentSeconds?}`.
Recorder listings accept `limit` up to 200 and an optional exact boolean query
`active=true` or `active=false`. The active filter excludes completed, stopped
and failed jobs before applying the page limit, keeping older active captures
visible even when newer terminal jobs fill a recent page. It remains bound to
the authenticated workspace.

Only a configured source ID selects media. Default recording duration is 60 seconds;
segments are 2–30 seconds and jobs are capped at one hour. The Linux recorder
uses job leases, bounded retries, byte reservations, workspace limits and a
default concurrency of two. It declares recording active only after verified
media is retained. Failed/unlisted tails remain unavailable; gaps never stand in
for missing content. Media timestamps are collector/media offsets.

Schedules accept `{id?,sourceId,startAtMs?,endAtMs?,maxDurationSeconds?,segmentSeconds?,pollSeconds?,autoRecord?}`.
`autoRecord` defaults false. Each schedule watches one explicitly selected source,
within a maximum 24-hour window, with bounded polling/backoff. Discovery-only
schedules do not record. Direct files are fixtures, HTTPS media is operator
supplied, and the TikTok adapter addresses selected public accounts only. There
is no universal guest/account locator or bypass of private broadcasts.

Object archives snapshot currently verified segments; they do not promise
future capture coverage. Archive creation is
`{id?,recordingJobId,maxDurationSeconds?,maxAttempts?}`. Readback and manifest
hashes must verify before completion. Missing/damaged local replay remains refused
until an explicit archive restore completes. Archive encryption is configured
server-side; API callers cannot supply storage endpoints or credentials.
Workspace quotas reserve object bytes before upload, meter shared immutable media
keys once and include manifests/encryption overhead. Failed uncertain writes keep
their reservation; usage is a logical footprint rather than a provider bill.

Speech jobs snapshot selected retained media. The optional PocketSphinx baseline
performs independent offline recognition; it does not substitute platform captions.
It has no measured multi-speaker diarisation or identity inference. Source-linked
findings, graph edges and protection alerts require human review. Literal rule
matches and temporal proximity do not establish harassment, identity or causation.
Protection runs produce in-app candidates; they do not send external messages.

Optional model analysis is a separate explicit request and data-egress decision.
It sends only bounded evidence already linked to the selected case and creates
unreviewed suggestions. Captured text cannot invoke tools, grant access or become
accepted agent memory. [The ALFRED gateway](../../integrations/alfred/GATEWAY.md)
rechecks source-read, collection-control and model-egress permissions separately;
it does not register tools in the separate ALFRED repository.

Actual optional ALFRED HTTP/CLI tools are implemented in
[ALFRED draft PR #20](https://github.com/EmotiveImpact/Alfred/pull/20), separately
installed with private configuration and current grants. The
[integration guide](../../docs/livelens/ALFRED_INTEGRATION.md) records its exact
tested revision and fixture transport/capture receipts. LiveLens's `/v1/agent`
does not infer that another host is configured; the installed ALFRED runtime's
authenticated `/desk/livelens` discovery supplies that registration truth.

## Operational boundaries

The default SQLite service remains a private pilot. The optional PostgreSQL
bridge exposes the same synchronous pilot schema and serial writer behaviour;
it is not the separate forced-RLS target schema or proven horizontal capacity.
The optional AES-256-GCM object archive does not silently replace local recordings
or encrypt the live SQLite database. Backups and recovery scaffolding are in
[deployment instructions](../../deployment/livelens/README.md).

Usage limits are manual entitlements, not a payment-provider integration. Public
LIVE discovery/media capture, a second external platform, native Electron GUI,
multispeaker diarisation and customer-scale capacity require separate validation.
Generated recordings, protocol fixtures and configured adapters do not establish
those results. Nothing is merged or deployed by these start/test commands.
## Invited browser accounts

Optional `LIVELENS_BROWSER_AUTH=persisted` adds stored passwords and
administrator-issued single-use invitations to the existing same-origin console.
It requires workspace governance. Bootstrap users are inserted once; persisted
password changes and revocations survive restart. Static authentication remains
the default. See [workspace onboarding](../../docs/livelens/WORKSPACE_ONBOARDING.md)
for configuration, administrator APIs and public same-origin redemption.
