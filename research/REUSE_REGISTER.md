# Source review and reuse decisions

Reviewed 10 October 2026. Exact commits and reviewed API-read paths are recorded
in `upstream-lock.json`. Every imported project is currently **research-only**.
Source inspection and successful checkout do not establish operational reliability.

| Imported project | Useful source | Decision for LiveLens | Licence evidence |
|---|---|---|---|
| zerodytrash/TikTok-Live-Connector | `src/lib/client/index.ts`: connection lifecycle, status and event client | Prefer the already-used Node event-adapter interface. Decide the exact runtime version and hosted-service route before replacing the existing dependency. | `LICENSE`: AGPL-3.0 with additional integration and hosted-service terms |
| isaackogan/TikTokLive | `TikTokLive/client/web/routes/fetch_is_live.py`: account/room LIVE checks | Alternative Python collector. Expose one collector contract to the core rather than supporting two incompatible event models. | Same additional licence terms in `LICENSE` |
| XploitVoid/tiktok-live-recorder | `lib/recorder.js`, `server.js`: FFmpeg jobs, concurrent limits, chat sidecars and replay | Strongest reference for the first recorder worker. Reimplement durable job state, tenant boundaries and verified media completion in our worker. Its jobs use in-memory maps and API auth is optional in its server. | MIT root licence; dependencies need their own decision |
| PieterVanBoheemen/tiktoklive_monitor | `monitor/stream_monitor.py`, `recording/stream_recorder.py`: polling, recording lifecycle, stop and reconnect behaviour | Use its lifecycle as a design reference for the scheduler. Do not transplant the standalone application or its authentication environment into the core. | README claims MIT and links to an external generic licence; no repository licence file at the pinned commit |
| Michele0303/tiktok-live-recorder | `src/core/tiktok_recorder.py`, `src/utils/video_management.py`: recording and video processing | Compare FFmpeg shutdown/finalisation and long-session recovery with the Node recorder. Its followed-creators mode concerns their broadcasts. | MIT root licence |
| QuentinFuxa/WhisperLiveKit | `whisperlivekit/basic_server.py`, `audio_processor.py`, `timed_objects.py`, `diarization/`: streaming audio, timed segments and speaker tracks | Preferred candidate for a separate self-hosted speech worker. Benchmark transcript accuracy, overlap and latency on reference audio before adoption. | Apache-2.0 root licence; model/backend licences and downloads are separate |
| pyannote/pyannote-audio | `src/pyannote/audio/pipelines/speaker_diarization.py`: diarisation, exclusive speech turns and serialisation | Evaluate anonymous speaker separation. Do not infer TikTok handles or real-world identities from speaker IDs. | MIT toolkit; pretrained pipelines have separate model conditions |
| unitaryai/detoxify | `detoxify/detoxify.py`, README: text classification and bias limitations | Optional candidate flagger behind a context-review layer. A classifier output is a signal for review, not a factual allegation. | Apache-2.0 root licence; model/data decisions remain separate |

## What we own and build

The shared event contract, durable journal, case model, identity assertions,
source-linked reports, workspace boundaries, agent API and operating console are
the LiveLens product. Imported recorder applications provide useful patterns but
do not supply this combined system.

The service imports no research checkout at runtime. Its default evidence store
uses Node's built-in HTTP/SQLite modules; optional speech, PostgreSQL, selected
provider adapters and explicitly configured model egress have separate adoption
records below. This source import does not change or
clear the original desktop app's existing npm dependencies.

## Adoption record required for each worker

Record the exact version, imported or adapted files, attribution, direct and
transitive dependencies, licence route, external destinations, credentials,
failure behaviour, tests and rollback. A process boundary is an implementation
choice and does not itself settle licence obligations.

The first two worker choices to resolve are the Node event connector route and
FFmpeg media capture. Speech processing can then be benchmarked independently.

## First-release runtime decision

The recorder and browser gateway are original LiveLens code. No files or runtime
imports were copied from the eight research repositories; their pins, licences
and research-only states are unchanged. The worker uses Node 24 built-in
HTTP/SQLite/crypto/fs/child_process, Python 3.12 standard-library `ctypes` only for
Linux parent-death handling, and an explicitly configured FFmpeg executable.

The desktop stays on npm `tiktok-live-connector` **2.1.0**, resolved and integrity-
pinned by the existing `package-lock.json`. Its installed distribution includes
the MIT licence (copyright zerodytrash 2022), retained at
`runtime-licences/tiktok-live-connector-2.1.0.txt`. This is a different artifact
from the researched newer AGPL/additional-terms Git commit; that research source
is not substituted or adopted. `@eulerstream/euler-api-sdk` **0.1.5** is already
transitive. Provider signing/room-info access and terms remain separate; no
hosted commercial clearance is inferred from a source licence.

Fixture recording uses existing `ffmpeg-static` **5.3.0**, which downloads FFmpeg
**7.0.2-static**, a GPL/version3-enabled build. Package and binary licences are
retained in `runtime-licences`. It runs as a separate executable; that boundary
does not remove GPL distribution obligations. Do not ship a combined paid binary
without satisfying corresponding-source/notices obligations and reviewing the
chosen build/provider terms. Server operators may configure a trusted system
FFmpeg instead; validation records the executable actually used. No new npm
package or research application has been installed for this worker.

`runtime-lock.json` records **64** exact resolved npm packages in the connector
and ffmpeg-static dependency closures, integrity values, licence metadata and
the package-lock digest. It is an inventory, not a claim that metadata alone
clears every future distribution/model/provider arrangement. It includes direct
and transitive runtime routes; the full original package lock remains authority.

Media route: available HTTPS HLS/MP4 supplied by the existing desktop connector /
EulerStream metadata path, or an explicit generated file fixture. Only service-
configured sources can be recorded. Signed URLs stay private; remote TLS stays
verified. Failure produces bounded attempts, persisted gaps and unavailable
tails. Tests exercise actual written media, stop, abrupt death, restart,
workspace denial and damage refusal. Real provider discovery/recording is
unverified without an accessible selected LIVE. Disable recorder source
configuration to roll back recording while preserving retained evidence/API.


## Expanded application runtime adoption

Concurrent recording, scheduling, investigations, graph/protection rules, reports,
roles and archival are original LiveLens code. Research Gitlinks are unchanged;
none of those applications or nested scripts is executed as runtime setup.

The optional local speech engine is **PocketSphinx 5.1.1** (BSD-2-Clause), chosen
for an actual bounded CPU implementation without gated diarisation/model downloads.
Its English acoustic/language models, dependencies, exact hashes and retained
licences are in `services/intelligence/speech/runtime_inventory.json` and
`runtime-licences/`; exact Python pins are in `requirements.txt`. Three known-audio
references are checksum-pinned in `reference_manifest.json`, with actual WER/latency
in `evaluation.json`. No pyannote/Whisper/Detoxify research runtime is adopted, and
no overlapping-speaker or broad live accuracy claim follows from this small sample.
Disable the recognizer configuration to roll back new processing while preserving
transcript evidence and its engine/media receipts.

Optional PostgreSQL uses **pg-native 3.9.1** and **libpq 1.11.0**, both MIT, through
an original narrow synchronous pilot-schema adapter. Exact installed closure,
integrities and licences are recorded in `services/intelligence/runtime-lock.json`,
`runtime-licences/` and the separate service `package-lock.json`. The selected
TikTok adapter uses the existing **tiktok-live-connector 2.1.0** distribution with
Euler SDK **0.1.5**, preserving the previously recorded runtime route. This does
not substitute the newer researched connector source or clear provider service
terms. Native driver compilation uses trusted Node/libpq tooling; removing
`LIVELENS_POSTGRES_URL` selects SQLite for a separately chosen database, not an
automatic data migration.

PDF rendering uses an explicitly configured Python/Playwright/Chromium executable;
HTML is escaped, JavaScript disabled and all browser network requests refused.
The validated environment uses Playwright 1.62.0 and distro Chromium; deployment
operators must retain the licences and notices of their selected browser build.
The project does not silently package that browser into the desktop distribution.

Object storage adapters use built-in Node crypto/HTTP and enforce private workspace
namespaces, bounded reads, Signature V4 and AES-256-GCM. Keys come only from private
runtime configuration. Optional model analysis uses an administrator-configured
OpenAI-compatible HTTPS endpoint and separately granted egress; no external model
was invoked or evaluated here. Provider credentials/terms and deployment cost are
separate operational decisions. Fixtures never imply commercial clearance.
