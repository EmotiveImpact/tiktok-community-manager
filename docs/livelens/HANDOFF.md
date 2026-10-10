# LiveLens development handoff

Checkpoint: 10 October 2026. Repository: `EmotiveImpact/tiktok-community-manager`.
Expanded draft: PR #1, branch `feat/livelens-evidence-timeline-2026-10-10`.
Base: `redesign`. Previous head: `8731d5bdd4ec932c6bfe3c50bf02ace154aa616e`.
Do not treat this checkpoint as a merge, deployment or live collection receipt.

For a new cloud coding task, use [CLOUD_HANDOFF.md](CLOUD_HANDOFF.md). It contains
the product vision, verified starting branch, cloud setup guidance and a
paste-ready C01/C02/C03 continuation prompt. The foundation code checkpoint is
`48deedee8f39b31b3f21414720cdf6f3007abfaa`; read the latest branch head, including
later handoff changes, instead of resetting to that historical commit.

## Read in this order

1. `AGENTS.md`
2. `docs/livelens/PLATFORM.md`
3. `plans/livelens-backlog.json`
4. `research/REUSE_REGISTER.md` and `research/upstream-lock.json`
5. `services/intelligence/README.md`
6. `docs/livelens/ALFRED_INTEGRATION.md`
7. `docs/livelens/VALIDATION.md`

`PRD.md` retains the original timeline slice requirements. `PLATFORM.md` is the
current wider scope: an intelligence engine that ALFRED and an operator console
can both use for collection, investigation and reporting.

## Implemented in this draft

- Existing React chat/caption evidence workspace, manual attribution, search and
  Markdown/JSON exports, using the desktop connector event feed.
- Eight complete pinned upstream checkouts as Git submodules: 850 tracked files,
  a machine-readable lock, source verifier and reuse register.
- Separate Node 24 HTTP/SQLite service: original events, source/collector/receipt
  clocks, workspace-bound access, idempotent atomic ingestion, literal search,
  anonymous speaker IDs, attribution history, cases and evidence exports.
- Per-session hash chains, replay-conflict refusal and report damage checks.
- JavaScript/Python agent clients, real HTTP tests and a synthetic restart demo.
- Local Docker/Compose scaffolding; neither built nor deployed here.
- Tracked backlog and an expanded CI workflow.

## Current integration boundaries

The desktop timeline does not automatically persist into the new API. C01 is the
explicit desktop-to-service bridge. The service is usable independently through
its API and demo. It does not connect to TikTok or call a speech/LLM provider.

The Python client is tested transport for ALFRED. It is not registered in ALFRED,
has not changed that repository and cannot start monitoring or write memory.
G01/G02 describe the actual registration and control work.

All upstream code is research-only. Both connector repos have additional hosted-
service licence terms. The monitor lacks a licence file at its pinned commit
despite its README claim. Models, transitive dependencies and provider services
require deliberate adoption decisions; source pinning does not make the combined
commercial product operational or cleared.

## Validation

The existing application passed all 78 tests and its TypeScript/Vite/Electron
bundles built. The new service has 15 passing tests, including database restart,
cross-workspace refusal, attribution corrections, atomic retries/conflicts,
integrity failure and real JavaScript/Python client requests. All eight upstream
HEADs agree with the lock and recorded Git submodule entries.

No upstream applications/models, real LIVE, media capture, automatic speech
attribution, browser acceptance, Electron packaging, VPS capacity or semantic
AI analysis was validated. Old GitHub Actions failure logs were unavailable;
check current-head CI independently. Full receipt: `VALIDATION.md`.

## Next complete engineering slice

Start with C01/C02/C03: bridge selected desktop evidence into a service session,
choose a supported source/connector route, then build one durable recorder worker.
Prove a replayable media-plus-chat session survives restart before extending to
independent speech processing and two concurrent streams.

Keep the existing UI running while introducing an operations console over the
shared API. Use the backlog's measurable gates and preserve implemented/planned
status. Publish for review without merging or deploying as a side effect.
