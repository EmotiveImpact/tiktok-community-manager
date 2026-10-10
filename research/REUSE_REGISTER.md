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

The new service has no upstream runtime imports or external AI calls. It uses
Node's built-in HTTP and SQLite modules. This source import does not change or
clear the original desktop app's existing npm dependencies.

## Adoption record required for each worker

Record the exact version, imported or adapted files, attribution, direct and
transitive dependencies, licence route, external destinations, credentials,
failure behaviour, tests and rollback. A process boundary is an implementation
choice and does not itself settle licence obligations.

The first two worker choices to resolve are the Node event connector route and
FFmpeg media capture. Speech processing can then be benchmarked independently.
