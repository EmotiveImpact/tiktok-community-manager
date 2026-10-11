# First application release

Historical first-slice receipt. The expanded application supersedes the feature
boundaries below; use [FULL_APPLICATION.md](FULL_APPLICATION.md),
[RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md) and the current backlog.

This is the private operator pilot, built from foundation
`14df1ae5d42e38e9dbcf4a974c8d161814a141f5`. It is not a deployed paid service.

## Reproduce the application

Use the existing isolated checkout; do not create a worktree unless requested.
From the repository root, with Node 24+, Python 3.12+ and Linux:

```bash
ELECTRON_GET_USE_PROXY=1 electron_config_cache=/workspace/.cache/electron npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm test
npm run build
npm --prefix services/intelligence test
npm --prefix services/intelligence run demo
npm --prefix services/intelligence run demo:recording
node scripts/research/verify-upstreams.mjs
npm run console:fixture
```

The last command serves the application at loopback port 4318, path `/app/`.
The **public, synthetic fixture login** is operator `fixture`, password
`fixture-operator-only`. This is not a real credential. The launcher binds only
to `127.0.0.1`, creates labelled fictional evidence and generated colour bars/tone,
and stores its database and media in ignored `services/intelligence/data/console-fixture`.
Do not publish this fixture launcher as customer authentication.

In Sources & captures, start a bounded fixture capture, then refresh its receipt.
Only verified written media establishes recording state. Open the conversation,
select a synthetic marker to seek the media, inspect context and link it to a
case. Cases & reports provides source-linked JSON and Markdown exports. Restart
the launcher, sign in again, and reopen the same case/media. No external LIVE or
speech provider is contacted by these commands.

`python3 scripts/validation/browser_smoke.py` launches its own isolated fixture
server and checks desktop/phone journeys, media playback/seek, keyboard access,
exports, and case/media reopening after a service restart. It needs the Python
Playwright package and an installed Chromium executable (default `/usr/bin/chromium`),
not an upstream application or model. Screenshots are written outside Git.

The ordinary build command updates the existing tracked TypeScript build cache.
For setup without changing that cache, use `npx --no-install tsc --noEmit` followed
by `npx --no-install vite build`. Existing CRM routes remain reachable from
Community & CRM and through the original `?page=...` links. Browser CRM fixtures
are labelled; Electron retains its actual local ledger and collection workflow.

## Configure the real private operator service

Set `LIVELENS_API_KEYS` as before. The bearer API and JavaScript/Python clients
remain compatible. Browser bearer requests remain refused; no CORS allowlist or
global cross-origin access is added.

Configure `LIVELENS_BROWSER_USERS` as a private JSON array of objects with
`username`, `password` (at least 12 characters), `workspace`, and `scopes`.
Recommended console scopes: `sessions:read`, `evidence:read`, `cases:read`,
`cases:write`, `recordings:read`, `recordings:write`. Supply user passwords through
private runtime configuration, never tracked files. Passwords are scrypt-hashed
in memory at startup. API keys are not used as browser login credentials.

Set `LIVELENS_CONSOLE_ORIGIN` to the exact HTTPS browser origin (explicit loopback
HTTP is allowed for local development), and `LIVELENS_BUNDLE_DIR` to the absolute
`dist` directory. The API serves the console from `/app/` on that same origin.
Keep reverse-proxy Host headers consistent with the configured origin. Login is
bounded and rate limited. Sessions expire in eight hours and are revoked on
logout or service restart. Cookies are HttpOnly, SameSite=Strict, and Secure on
HTTPS. Writes require the exact Origin and a per-session CSRF token. Session
principals carry only configured scopes and workspace. Customer roles and
commercial access management remain S01.

For desktop archiving, set **only in Electron's main-process environment**:
`LIVELENS_DESKTOP_URL` and `LIVELENS_DESKTOP_TOKEN`. Give that token
`sessions:read`, `sessions:write`, and `evidence:write`, bound to the destination
workspace. The LiveLens desktop panel archives the current or selected retained
session through IPC; credentials are never accepted from or returned to the
renderer. Explicit retries reuse stable session/event identities. A conflict is
a failed upload, not archived success. Archive receipts persist beside local
session files; interrupted uploads require explicit retry.

New collection retains provider time when returned, collector time separately,
and provider message IDs where present. Legacy `ts` is treated as collector time,
never invented source time. Known room/broadcast IDs isolate broadcasts;
without one, the capture connection gets a durable separate boundary rather than
guessing two nearby broadcasts are the same. Captions are retained only when
final, and remain anonymous. Desktop manual assertions stay labelled and are not
silently promoted into provider facts by archiving.

## Selected recording route

The existing pinned npm `tiktok-live-connector@2.1.0` remains the desktop event and
available-media discovery route. No research connector is adopted. The selected
media input is an operator-provided, permitted HTTPS HLS/MP4 source returned by
that existing connector/EulerStream flow; source discovery, provider terms and
access are separate from recording. No signing bypass, private-room access,
account watcher or automatic monitoring is implemented.

Set `LIVELENS_RECORDER_SOURCES` to a private JSON array. Each source has `id`,
`workspace`, `sessionId`, `label`, `kind` (`https` or explicit fixture `file`), and
`input` (the HTTPS URL or administrator-selected absolute file). Sources are
server configuration. Browser/API job callers can select IDs only; they cannot
provide arbitrary inputs, paths or command flags. Signed media URLs can contain
credentials and are never returned in source lists, receipts or reports.
`sessionId` must match the source's configured session in the caller's workspace.

Set `LIVELENS_MEDIA_ROOT` outside Git and `LIVELENS_FFMPEG_PATH` to a verified
FFmpeg executable. The fixture launcher uses the locked `ffmpeg-static@5.3.0`
FFmpeg **7.0.2** binary. The service can use an administrator-managed system
FFmpeg; CI prints its actual version and uses signed distro packages. Python's
Linux parent-death guard kills FFmpeg on abrupt service death. Nothing is run
through a shell. HTTPS inputs retain TLS certificate verification and use the
managed proxy where configured. See the reuse register for licence decisions.

The pilot worker executes one job at a time with a persisted lease, a maximum
of three attempts and a wall-clock deadline of 2–3600 seconds measured from job
creation (including queue/retry delay). Segment durations are 2–30 seconds.
Persistent job identity conflicts return 409. Stop is idempotent. Graceful service
restart finalises valid segments and records a gap; abrupt death is recovered
after the ten-second lease expires. It never silently starts an unbounded job.

FFmpeg writes per-attempt MP4s and a segment list. Closed segments are decoded,
hashed, renamed and entered in SQLite before recording-active is reported.
Unlisted/incomplete tails are quarantined with `.unavailable` and gap events.
Manifests, attempt history and gaps survive restart. Recovery seeks fixture
files beyond retained media; live sources reconnect without pretending their
missing interval was captured. Segment alignment uses **collector/media offsets**,
not an asserted original provider clock. The console labels uncovered evidence
timestamps; unknown intervals never acquire invented speech.

Authenticated media reads support bounded single ranges and recheck bytes/hash.
Reports include media receipts/hashes only for callers with `recordings:read`;
damaged or missing linked media prevents that export. Existing read-only clients
without media scope retain their evidence reports. Media lives outside the static
bundle and every read is workspace/scopes-bound.

## Boundaries

SQLite, local files, one worker and private operator passwords are pilot
contracts. This release does not claim independent transcription, multi-stream
scheduling, identity inference, reviewed AI findings, graphs, protection alerts,
ALFRED registration, billing, customer capacity, encrypted object storage or
retention/deletion controls. Later milestones remain planned.

Real TikTok LIVE validation needs a selected accessible public broadcast and its
permitted HTTPS media URL (and the existing provider access/paid tier if required).
No selected usable source was supplied in this build. Fixture success is kept
separate from that blocked provider check. Native Electron GUI startup is also
unverified in this container; its archive contract, persistence and real HTTP
upload path are tested independently of window startup.
