# Validation receipt

## First application release — 10 October 2026

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
