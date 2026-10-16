# LiveLens runtime configuration

This is the configuration reference for the implemented operator application.
See [FULL_APPLICATION.md](FULL_APPLICATION.md) for acceptance and remaining gates,
[the service API catalogue](../../services/intelligence/README.md) for routes, and
[deployment/recovery notes](../../deployment/livelens/README.md) for infrastructure.
All paths in JSON examples are placeholders to replace with trusted absolute paths.

The default console opens the capture-first [LIVE monitor](LIVE_MONITOR.md).
Saving source configuration starts no polling. Its Check LIVE control creates a
15-second discovery-only schedule; Watch only and Record when LIVE create explicit
bounded schedules. Preview is delayed verified retained media, with no direct
live-video streaming claim. The operating guide describes control and stop behavior.

Keep populated settings, database connections, credentials and recordings out of
Git. The API never accepts server executables or object-store credentials.

## Required service identity and browser access

Start from the repository root with `npm --prefix services/intelligence start`.
Supply `LIVELENS_API_KEYS` privately as a JSON array:

```json
[
  {
    "token":"REPLACE_WITH_RANDOM_BASE64URL_TOKEN_AT_LEAST_32_CHARACTERS",
    "workspace":"your_workspace",
    "subject":"operator",
    "scopes":["sessions:read","sessions:write","evidence:read","evidence:write","assertions:write","cases:read","cases:write","recordings:read","recordings:write","speech:read","speech:write","analysis:write","investigations:write","missions:read","missions:write","reports:write","workspace:read","workspace:admin"]
  }
]
```

Tokens use 32–128 base64url characters. Assign each client only its required
scopes. The browser receives a separate cookie session, never this bearer token.
For the console, privately configure `LIVELENS_BROWSER_USERS`:

```json
[
  {
    "username":"operator",
    "password":"REPLACE_WITH_A_PRIVATE_RANDOM_PASSWORD",
    "workspace":"your_workspace",
    "scopes":["sessions:read","sessions:write","evidence:read","evidence:write","assertions:write","cases:read","cases:write","recordings:read","recordings:write","speech:read","speech:write","analysis:write","investigations:write","missions:read","missions:write","reports:write","workspace:read","workspace:admin"]
  }
]
```

Passwords require at least 12 characters. Set `LIVELENS_CONSOLE_ORIGIN` to the
exact HTTPS origin, including a non-default port if used, and
`LIVELENS_BUNDLE_DIR` to the built repository `dist` directory. Explicit loopback
HTTP is permitted for local development. Reverse proxies must preserve the
configured Host/Origin; writes require same-origin CSRF protection. Browser
sessions are in memory and require sign-in after a service restart.

Enable persistent membership and case permissions with
`LIVELENS_WORKSPACE_MEMBERS`:

```json
[{"workspace":"your_workspace","subject":"operator","role":"owner"}]
```

For browser users the member subject is the username; API member subjects match
their key configuration. Roles are owner/admin/analyst/viewer/revoked. The optional
governance layer checks current roles as well as token scopes on each request;
seed configuration does not undo persisted changes. Workspace admins manage
restricted case grants, manual limits and explicit retention previews. Without
this configuration the service retains token workspace/scope isolation, but
membership/case-grant controls are disabled.

## Environment catalogue

Set `LIVELENS_BROWSER_AUTH=persisted` to enable administrator-issued invitations
and stored password changes. This requires configured workspace membership;
bootstrap users are inserted once and cannot restore reset/revoked credentials.
See [invited onboarding](WORKSPACE_ONBOARDING.md) for the UI and API contracts.

Defaults resolve relative paths against the service working directory.

| Variable | Purpose and default |
|---|---|
| `LIVELENS_API_KEYS` | Required private API key JSON array |
| `LIVELENS_HOST` | Listener; default `127.0.0.1` |
| `LIVELENS_PORT` | Listener port; default `4318` |
| `LIVELENS_DB_PATH` | SQLite pilot database; default `./data/intelligence.sqlite` |
| `LIVELENS_BROWSER_USERS` | Optional scoped operator login JSON array |
| `LIVELENS_BROWSER_AUTH` | `static` by default; `persisted` enables stored accounts and invitations |
| `LIVELENS_CONSOLE_ORIGIN` | Exact browser origin; required when browser users are configured |
| `LIVELENS_BUNDLE_DIR` | Absolute built frontend directory |
| `LIVELENS_WORKSPACE_MEMBERS` | Optional persisted role/member seed JSON array |
| `LIVELENS_ENABLE_RECORDER` | Set `1` to enable an empty configured recorder/source catalogue for API-only operation |
| `LIVELENS_RECORDER_SOURCES` | Trusted static recorder sources, including explicit fixture file paths |
| `LIVELENS_SOURCE_ADAPTERS` | Trusted discovery adapters; defaults to recorder source configuration |
| `LIVELENS_MEDIA_ROOT` | Local retained media; default `./data/media` |
| `LIVELENS_FFMPEG_PATH` | Trusted FFmpeg executable; default `/usr/bin/ffmpeg` |
| `LIVELENS_MAX_RECORDINGS` | Global bounded recording concurrency; default `2`, maximum `16` |
| `LIVELENS_SPEECH_RECOGNIZER` | Optional trusted independent speech command JSON |
| `LIVELENS_ANALYSIS_PROVIDER` | Optional explicitly invoked model suggestion endpoint JSON |
| `LIVELENS_PDF_RENDERER` | Optional trusted Python/Chromium configuration JSON |
| `LIVELENS_POSTGRES_URL` | Optional private PostgreSQL connection; switches the pilot database adapter |
| `LIVELENS_POSTGRES_SCHEMA` | Optional pilot PostgreSQL schema name; default `livelens` |
| `LIVELENS_OBJECT_STORAGE` | Optional encrypted object archive configuration JSON |

Browser configuration or configured recorder/discovery sources also enable the
recorder. Enabling the recorder/scheduler creates no external polling by itself;
only persisted, explicit bounded schedules do that. Source configuration and
server credentials remain separate from HTTP requests.

## Sources, schedules and recording limits

Static recorder sources have a fixed retained session and trusted input:

```json
[
  {"id":"selected_media","workspace":"your_workspace","sessionId":"retained_session","kind":"https","input":"https://permitted.example/media.m3u8","label":"Selected permitted media"},
  {"id":"generated_fixture","workspace":"your_workspace","sessionId":"fixture_session","kind":"file","input":"/absolute/private/generated-fixture.mp4","label":"Generated fixture"}
]
```

The sessions must exist before manual capture. File input is an explicitly
configured fixture, not another platform. Signed HTTPS media URLs stay private;
TLS verification remains enabled. The trusted FFmpeg executable's licence/build
and any provider/signing terms remain independent of API correctness.

Discovery configuration supports the same direct file/HTTPS contract and the
existing integrity-pinned npm TikTok 2.1.0 selected-public-account route:

```json
[
  {"id":"selected_account","workspace":"your_workspace","kind":"tiktok-public","account":"selected_public_account","label":"Selected public account","signApiKeyEnv":"PRIVATE_TIKTOK_SIGNING_KEY","eulerFallbacks":false}
]
```

`signApiKeyEnv` names a private runtime setting; its value is not stored in the
source catalogue or returned to the console. Euler fallbacks are disabled unless
explicitly configured true. Access/signing terms, network availability and usable
public media determine whether collection succeeds. Private/subscriber-only
broadcasts are not bypassed. Actual public LIVE capture remains unverified by
fixture tests.

Owners can add HTTPS/public TikTok sources through `POST /v1/sources`; that body
cannot supply file paths, credential environment names or server arguments.
Source descriptors do not disclose signed inputs. Browser source validation
rejects credentials, fragments, local names and private IP literals. Enforce the
runtime's network egress policy as well; catalogue validation is not a DNS or
redirect policy for every possible host.

A schedule request uses only a configured source ID:

```json
{
  "id":"selected_watch",
  "sourceId":"selected_account",
  "startAtMs":1791657600000,
  "endAtMs":1791661200000,
  "maxDurationSeconds":600,
  "segmentSeconds":5,
  "pollSeconds":60,
  "autoRecord":true
}
```

Replace timestamps with the desired future/current window. `autoRecord` defaults
false, so an omitted checkbox discovers availability without recording. The
window is at most 24 hours, polls are at least 10 seconds, and consecutive source
failures use bounded backoff. Schedules retain discovered broadcast/session/job
identities across restart; a healthy sibling's lease is not recovered as a failed
worker. Guests and chat appearances remain observed activity, not a universal
room-to-room account locator.

Manual recorder jobs use
`{id?,sessionId,sourceId,maxDurationSeconds?,segmentSeconds?}`. Durations are
2–3,600 seconds from creation, including queue/retries; segments are 2–30 seconds.
The recorder defaults to two simultaneous jobs, two per workspace, 20 outstanding
jobs per workspace, a 1 GiB reservation per job and a 10 GiB workspace media bound.
Class-level limits can be tightened by the trusted embedding application; the
HTTP caller cannot change worker quotas. Governance admission additionally
applies persisted recording, speech, storage and pending-job entitlements.
These are operational limits, not a measured customer-capacity claim.

## Independent speech

Configure a trusted recognizer only after installing its pinned prerequisites.
The supplied offline CPU baseline is PocketSphinx; install/configuration,
reference evaluation and licence inventory are in
[the speech worker README](../../services/intelligence/speech/README.md).

```json
{
  "command":"/absolute/speech-venv/bin/python",
  "args":["/absolute/repository/services/intelligence/speech/pocketsphinx_adapter.py","--ffmpeg","/usr/bin/ffmpeg"],
  "id":"pocketsphinx",
  "language":"en-US",
  "diarization":false
}
```

Set that JSON as `LIVELENS_SPEECH_RECOGNIZER`. API callers select existing verified
media receipts, not commands or paths. Jobs retain exact input hashes, progress,
stop/deadline/retry receipts and source-linked transcript ranges. Recognition is
independent of platform captions and runs on local audio/models. The supplied
engine has no measured multispeaker diarisation; anonymous audio tracks are not
account identities. The short reference evaluation is a baseline, not livestream
accuracy, language coverage or customer-scale throughput.

## Optional model suggestions and PDF

`LIVELENS_ANALYSIS_PROVIDER` configures an OpenAI-compatible chat completion
endpoint. The request happens only when an authorised operator explicitly calls
`POST /v1/analysis` for a case:

```json
{"url":"https://your-approved-provider.example/v1/chat/completions","model":"your-selected-model","apiKeyEnv":"PRIVATE_ANALYSIS_KEY","timeoutMs":12000}
```

An explicit loopback HTTP endpoint is also supported for a local model. Only
bounded evidence already linked to the case is sent. The model has no tools;
returned IDs must refer to supplied evidence. Its findings remain drafts for
human review. Choosing a remote endpoint is a separate source-data egress choice;
it does not follow from collecting a LIVE or permitting ALFRED source reads.
Missing configuration returns unavailable, without fabricated analysis.

PDF export additionally requires a trusted Python environment with Playwright
and a Chromium binary:

```json
{"python":"/absolute/python-environment/bin/python","chromium":"/absolute/chromium"}
```

Set this as `LIVELENS_PDF_RENDERER`. The renderer is bounded and accepts generated
report HTML only; no caller selects executables or arbitrary URLs. JSON, Markdown
and HTML report exports remain available without PDF configuration. Redactions
belong to an export revision and do not overwrite original evidence.

## Optional PostgreSQL pilot adapter

`LIVELENS_POSTGRES_URL` selects the synchronous libpq-backed
`PostgresDatabase` bridge. Its optional `pg-native` dependency and system libpq
build prerequisites are separate from the default SQLite installation. Install
the service's locked optional dependencies with `npm --prefix services/intelligence ci`
after configuring the native build prerequisites. Hold the
connection string in private runtime configuration; non-loopback connections
require `sslmode=verify-full` and a valid trusted server certificate.

`LIVELENS_POSTGRES_SCHEMA` selects a lowercase pilot schema name, default
`livelens`; `LIVELENS_DB_PATH` is not the selected database when a PostgreSQL URL
is configured. The bridge creates/uses that pilot schema and translates its bounded SQL subset,
including the existing evidence, worker, governance and investigation tables.
It retains serial transaction ordering through an advisory writer lock and
safe-range JavaScript numbers. Selecting a PostgreSQL URL does not migrate an
existing SQLite database or activate the separate target forced-RLS schema in
`deployment/livelens/postgres/`. Review and test any data migration separately.
This is an optional pilot backend, not proof of distributed writes, RLS tenant
isolation, paid production operation or capacity for hundreds of users.

## Optional encrypted object archive

`LIVELENS_OBJECT_STORAGE` enables an explicit archive outbox over retained,
hash-verified segments. Every configured backend is wrapped in AES-256-GCM using
a separately named private 32-byte base64url encryption key. Filesystem example:

```json
{"backend":"filesystem","root":"/absolute/private/object-archive","encryptionKeyEnv":"PRIVATE_MEDIA_ARCHIVE_KEY"}
```

S3-compatible example:

```json
{
  "backend":"s3",
  "endpoint":"https://your-private-object-endpoint.example",
  "bucket":"your-private-bucket",
  "region":"your-region",
  "accessKeyIdEnv":"PRIVATE_OBJECT_ACCESS_KEY",
  "secretAccessKeyEnv":"PRIVATE_OBJECT_SECRET_KEY",
  "sessionTokenEnv":"PRIVATE_OBJECT_SESSION_TOKEN",
  "encryptionKeyEnv":"PRIVATE_MEDIA_ARCHIVE_KEY"
}
```

Omit `sessionTokenEnv` when the configured provider does not need one. Keys and
bucket settings are runtime-only; users cannot post object configuration, URLs
or credentials. Remote S3 endpoints use HTTPS; explicit loopback HTTP supports
local protocol validation. The adapter signs requests privately and returns no
public or presigned media URLs. Enable the recorder as well; API-only runtimes
without browser/source configuration need `LIVELENS_ENABLE_RECORDER=1`.

Create an archive with
`POST /v1/media-archives {id?,recordingJobId,maxDurationSeconds?,maxAttempts?}`.
It snapshots only currently verified segments, writes private encrypted objects,
verifies plaintext readback and the hashed manifest, then publishes completion.
The default operation window is 120 seconds, bounded to 10–600 seconds, with at
most three attempts. Segments default to a 64 MiB object bound; two archive jobs
can run concurrently. Receipts state the exact snapshot coverage and failures.
An interrupted outbox resumes without treating a partially written object as
verified.

Workspace admission reserves object bytes before an export starts and counts
pending exports/restores with other pending jobs. Usage separates local bytes,
verified archive bytes and reserved archive bytes. Each immutable media key is
counted once per workspace; each snapshot manifest and each object's 34-byte
encryption envelope count separately. These are logical stored bytes, not a
provider bill. Failed writes keep uncertain reservations because a lost
acknowledgement does not prove the remote object is absent. Archive history is
bounded to 1,000 snapshots and 20,000 unique keys per workspace; automatic object
deletion or reservation cleanup is not implemented.

Local missing/damaged replay remains refused. `POST /v1/media-archives/:id/restore`
with `{}` explicitly queues a bounded restore. The worker verifies object hashes,
manifest and original metadata, restores original media paths atomically, and
rechecks normal replay integrity before success. It does not infer lost source
content or silently repair damaged evidence. Object encryption protects exported
objects; live local media/database still need the host's storage protection.

## Desktop, recovery and agents

The Electron main process reads `LIVELENS_DESKTOP_URL` and
`LIVELENS_DESKTOP_TOKEN` for explicitly archiving a selected capture. Keep them
outside renderer settings. Give that token the required session/evidence read
and write scopes. `LIVELENS_CONSOLE_ORIGIN` selects the browser console opened
from Electron; the desktop service URL is the fallback. Native Electron GUI
startup remains a separate unverified acceptance gate.

Workspace retention is manual: configure a policy, preview eligible sessions,
then explicitly apply selected IDs with the exact preview hash and reason.
Referenced evidence, active jobs and retained archive/source/mission references
prevent deletion. Manual usage limits do not charge a payment provider. Backup
is blocked while physical cleanup is unfinished. Cleanup tasks persist with the
deletion receipt before files are removed, and known pending bytes stay reserved.
Workspace → Operations shows independently scoped worker state and committed
capacity; Workspace → Retention provides bounded cleanup history and explicit,
reasoned retries. No retention or retry timer is enabled by this feature. Correct
filesystem access before retrying; a replaced root/job directory is refused.
See [Operations & Recovery](OPERATIONS.md) for states and escalation steps. Backup
and restore use the separately configured `LIVELENS_BACKUP_KEY`; follow
[the recovery instructions](../../deployment/livelens/README.md) and verify a
stopped-service recovery before repointing a live runtime. The SQLite backup CLI
does not snapshot PostgreSQL or external object-store contents; those backends
need their own separately verified backups.

The [ALFRED local gateway](../../integrations/alfred/GATEWAY.md) requires independent
source-read, collection-control and model-egress grants, checked at dispatch.
It emits untrusted-data receipts, registers no connector in the separate ALFRED
repository, sends no external notifications and accepts no memory automatically.
