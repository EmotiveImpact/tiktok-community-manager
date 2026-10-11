# Validation receipt

## Expanded operator application — 11 October 2026

The current continuation follows the first application slice on
`feat/livelens-first-release-2026-10-10`. Fixtures remain distinct from external
provider acceptance. Current product/configuration: [FULL_APPLICATION.md](FULL_APPLICATION.md) and
[RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md). Public image gallery:
[SCREENSHOTS.md](SCREENSHOTS.md). Exact optional-backend/container receipts:
[deployment validation](../../deployment/livelens/VALIDATION.md).

| Check | Result | Executed scope and limits |
|---|---|---|
| Application regression | 84 passed, 10 files | CRM/timeline, Electron archive boundaries and real scoped HTTP uploads preserved. |
| TypeScript and Vite/Electron bundles | Passed | Final renderer/main/preload outputs; existing bundle-size/browser-data warnings remain. |
| Intelligence service, all optional test prerequisites enabled | 102 passed; zero failures/skips | Actual PostgreSQL 17.6, independent PocketSphinx known audio, offline Chromium PDF, FFmpeg concurrent recording, scheduler, model HTTP fixtures, investigations/graph/protection, roles/scopes/case ACL/revocation, encrypted archive/restore, retention and SQLite backup recovery. |
| Evidence demo | Passed | SQLite restart, original clocks/unknown tracks, hash receipts, case export. |
| Recording recovery demo | Passed | Actual colour bars/tone, abrupt service death, restart, honest gaps/partial tails, 3 verified segments, authenticated range replay and retained case report. |
| Source pins | 8/8 verified | Committed Gitlinks and lock agree; research checkouts are not materialised/executed in this environment. |
| Desktop/phone original browser regression | Passed | Actual replay/seek, account search, source context, cases, original JSON/Markdown and restart; zero page errors/phone overflow. |
| Full operator browser journey | Passed; zero page errors | Reviewed findings/counterevidence, bookmarks, literal comparisons, source-scoped anonymous tracks and unverified person references, source-backed relations after restart, missions/alert reviews, redaction/actual PDF, audit, explicit source creation, desktop/phone and keyboard. Final screenshots/receipt are tracked. |
| Encrypted archive UI | Passed | Actual fixture snapshot, local segment removal, explicit UI restore, matching SHA-256, video reopened; desktop/phone, zero page errors/overflow. |
| Native PostgreSQL graph extension | Passed | Anonymous tracks retain job/engine/media scope; operator-declared person reference, original evidence sources and history survive reconnect and remain workspace-isolated. |
| Packaged API/recorder runtime | Passed | Pinned Node image built; real service health200/auth401, actual FFmpeg capture3segments, AES-GCM archive4objects, missing-media410, exact103815-byte restore/replay. Native PostgreSQL/TikTok modules and PDF helper are packaged. Optional web/PDF/speech derived-image recipes are not validated container claims. |
| Real public LIVE | Unrun | No selected usable permitted account/media source supplied. Provider fixtures and generated recording do not establish real collection. |
| Diarisation/semantic quality | Unmeasured | Known-audio CPU receipt is not overlapping-speaker accuracy; model adapter tests use local HTTP fixtures, not an external model. |
| ALFRED registration | Outstanding | Standalone read/control gateway real HTTP policy tests pass; separate ALFRED repository is unchanged. |
| Customer/paid rollout | Outstanding | No payment provider, self-service invitations/recovery, target RLS/queue deployment or representative customer capacity/cost receipt. |
| Native Electron GUI | Unrun | Bundle and actual archive HTTP contract verified; native display/package startup is not. |

Speech receipt: three checksum-pinned excerpts, 15.186 seconds/40 words, 30% word
error rate and 3.895 seconds CPU processing (0.256 processing/audio ratio). No
anonymous track is asserted to be a platform account or real person. The optional
provider drafts are source-validated, model-labelled and atomically saved; review
history and originals remain distinct. Redaction tests cover dependent notes,
findings/editorial history and account provenance while preserving original hashes.

Final review regressions cover overview recording-scope refusal, ACL-aware counts
beyond200cases, malformed job IDs returning400 before lookup/dispatch, and libpq
query overrides/duplicate TLS configuration rejection. Archive admission reserves
unique encrypted objects/manifests plus pending jobs transactionally; shared keys
are counted once per workspace. Uncertain failed writes retain reservations.

Local capacity probe: 10 concurrent callers, 200 requests, 1000 synthetic events,
zero errors, 441.64 requests/second and p95 37.94ms in its documented in-memory
SQLite fixture. This is an API pilot measurement, not representative customer,
recording/speech/analysis concurrency or hundreds-of-users capacity.

No populated keys, signed URLs, media or databases are committed. No merge,
hosted deployment, real unattended monitoring, external model invocation, paid
infrastructure provisioning, billing-account change or ALFRED repository edit
occurred. Reusable install/start instructions are saved in the environment draft;
saving does not publish a snapshot or guarantee a fresh-task restoration.

Hosted CI at implementation/diagnostic commit
`844bc2f3e10bb4c26bd6a55e7b8a3ab245369654` completed successfully:
[push run 38098045790](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38098045790)
and [PR run 38098048357](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38098048357).
Both executed all three jobs: application tests/build, intelligence/source pins
with actual PostgreSQL/speech/FFmpeg recovery, and original/full browser journeys
including real PDF, phone and restart. Uploaded browser receipts are linked from
the runs. This receipt update changes documentation only.

The preceding expanded run at `868b741` passed application/service checks but
failed the original browser journey before precise diagnostics were installed.
Its signed blob logs remain denied by the current managed proxy, so no cause is
asserted. Failure annotations, screenshots, media state and fixture logs are now
retained. Both subsequent fresh browser runs passed without weakening assertions
or changing the browser/codecs. A later documentation-only rerun at `ad01247`
exposed the precise recurring test synchronization failure through those new
annotations: after reopening original context on restart, the test accessed
`video.readyState` before React had mounted the player. The test now explicitly
waits for the video element before the existing media-readiness assertion. No
application behavior, playback assertion or browser/codec selection was changed.
A controlled 1500ms delay of the real post-restart media metadata reproduced the
old null-player exception. Both corrected original/full journeys passed the same
delay, explicitly observing an initially absent video before mount, with all
playback/export/PDF/phone/restart assertions retained and zero page errors.
The first-slice payment/spending blocker is historical; no billing-account change
was made.

## Historical first application release — 10 October 2026

Foundation: `14df1ae5d42e38e9dbcf4a974c8d161814a141f5`, verified as the current
foundation branch/PR #1 head before the new feature branch was created.
Runtime: Node 24.19.0, Python 3.12.14, Playwright 1.62.0, Chromium 154.0.8037.57; actual recorder
fixtures used the locked FFmpeg 7.0.2-static binary from ffmpeg-static 5.3.0.

| Check | Result | Evidence and limits |
|---|---|---|
| `npm test` | 84 passed, 10 files | Existing CRM/timeline plus separate provider/collector clocks, stable broadcasts, conflict refusal and actual HTTP upload/retry |
| `npm run build` | Passed | TypeScript and renderer/Electron main/preload bundles; existing browser-data and bundle-size warnings remain |
| `npm --prefix services/intelligence test` | 22 passed | Original 15 service tests, 3 browser authentication/bounds tests and 4 actual FFmpeg recording/recovery/media isolation tests |
| Evidence restart demo | Passed | Original JavaScript/Python compatible evidence/case API and hash-chain export |
| `npm --prefix services/intelligence run demo:recording` | Passed | Actual segmented fixture capture, SIGKILL service interruption, parent-death guard, restart recovery, capture gaps, 3 verified segments, authenticated range replay and retained report after another restart |
| Source verification | 8/8 Gitlinks/lock entries verified | `node scripts/research/verify-upstreams.mjs`; research checkouts were not materialised or executed in this environment |
| Stage A desktop/phone browser journey | Passed | Login, sessions, context, case linking, JSON export; no uncaught errors or phone overflow |
| Stage B browser fixture capture and search | Passed | Start receipt, recording state backed by segments, authenticated MP4 metadata, literal statement/account searches |
| Real public TikTok LIVE | Unrun / blocked | No selected usable account/media URL or provider access supplied; fixtures do not establish provider success |
| Native Electron window | Unrun | Container sandbox helper/display limitations; archive logic/IPC bundle and HTTP transport are separately verified |
| PR #1 / publication | Confirmed | PR #1 open/draft/unmerged; branch and implementation commit published; draft PR #3 targets the foundation branch |
| Hosted CI at implementation `5990315` | Externally blocked | Run `38085765961`: no runners/steps. Both check annotations explicitly cite failed account payments or spending limit and direct the owner to GitHub Billing & plans. Local checks passed; no billing change made. |

`python3 scripts/validation/browser_smoke.py` passed: desktop/phone layouts,
keyboard skip/navigation, actual playback and evidence seeking, captured account
search, case linking, JSON/Markdown exports and reopening the case/media after
service restart; zero uncaught page errors and no phone overflow. Local screenshot
receipt: `/tmp/livelens-browser-receipt-ipzci5o9/desktop-replay.png` and
`phone-replay.png` (outside Git). These are synthetic fixture receipts.
Recordings, SQLite databases, signed URLs and populated credentials are excluded
from Git. No real LIVE monitoring, merge, deployment, external model, paid
infrastructure or ALFRED repository change occurred. Later commercial capacity
and source/model/provider licence gates remain separate.

Initial API access failed at the managed proxy; after saving the required
`api.github.com` domain in the environment draft, API reads and draft PR creation
were observed to work. Run-log download remained proxy-blocked, but the check
annotations exposed the current billing/spending prerequisite directly. The
cause of the earlier historical run with unavailable logs remains unasserted.

## Historical foundation receipt

Date: 10 October 2026. Source baseline:
`8731d5bdd4ec932c6bfe3c50bf02ace154aa616e`.
Runtime: Node `v24.19.0`; Python standard library; Linux.

| Check | Result | Practical scope |
|---|---|---|
| Original source materialisation | 168/168 fetched source files match their Git blob hashes | Source read through the connected GitHub API. Unchanged binary assets and other original files are preserved through the remote base tree, not substituted locally. |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed | Original locked dependencies; lifecycle scripts and Electron/FFmpeg binary installation not run |
| `npm test` | 78 tests, 9 files passed | Existing community-manager and LiveLens timeline regressions |
| `npm run build` | Passed | TypeScript, Vite renderer and Electron main/preload bundles; existing size/browser-data warnings remain |
| `npm --prefix services/intelligence test` | 15 passed | Persistent SQLite and real loopback HTTP; clients, scopes, workspace isolation, retries, corrections, report integrity and input boundaries |
| `npm --prefix services/intelligence run demo` | Passed | Synthetic evidence survives close/reopen and exports a source-linked report |
| `node scripts/research/verify-upstreams.mjs --checkouts` | 8/8 passed | Recorded Gitlinks, exact lock and actual upstream checkout HEADs agree |
| Old CI logs at prior head | Unavailable | GitHub reported failure; job log endpoint returned BlobNotFound. No old root cause is asserted. |

The service tests include a Python subprocess querying the running HTTP API.
They do not exercise ALFRED registration or a speech provider. All fixtures are
synthetic. No upstream applications/models, live account, external AI request,
recording, notification, merge or deployment occurred during validation.

This is pilot code. A local hash chain is not an external signature or trusted
timestamp and cannot withstand an administrator rewriting the entire database.
Storage lifecycle, recovery, encryption, commercial access controls and media
retention remain tracked work.

CI uses ignored-lifecycle installation for unit/build validation plus a separate
Node 24 service/source-pin job. Current-head results are reported in the PR;
publishing a workflow is not evidence that it completed successfully.
