# LiveLens build handoff

As of 2026-10-10, the initial evidence workspace is being incubated in:
EmotiveImpact/tiktok-community-manager
Branch: feat/livelens-evidence-timeline-2026-10-10
Base: redesign

## This branch contains
- src/lib/livelens/engine.ts: typed evidence timeline, timestamp alignment,
  operator attribution, adjacent chat, search, report serialisation.
- src/components/LiveLensPanel.tsx: UI for the LIVE event feed and evidence export.
- src/App.tsx + src/state/ui.ts: navigation wiring.
- test/livelens.test.ts: focused Vitest coverage.
- docs/livelens/PRD.md: product scope and future architecture.

## Not yet implemented
- independent real-time speech transcription + speaker diarisation
- automatic on-screen guest detection and username mapping
- VPS worker that automatically records multiple public rooms
- replayable video/audio capture with signed manifests
- persistent operator corrections and case management
- AI semantic reporting and external fact checking

## Decisions
- Broad conversation intelligence, not only anti-bullying.
- An account identifier is not automatically a person identity.
- A caption source event is not proof of which guest spoke.
- Time-neighbouring chat is context, not proof of causation.
- Do not merge or deploy this branch before tests and review.

## Next engineering sequence
1. Run TypeScript build and tests in CI or on a local clone, and fix issues.
2. Persist stream/session evidence and operator attribution per room.
3. Create a capture-worker interface and a replayable mock source.
4. Add independently sourced audio speech-to-text with diarisation.
5. Add reliable multi-stream scheduling and media persistence on VPS.
6. Add report review and source-linked case bundling.
