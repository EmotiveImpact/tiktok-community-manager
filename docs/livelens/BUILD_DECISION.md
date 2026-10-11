# What should we build?

Date: 2026-10-10. Decision requested: new core or refactor the old CRM.

Historical research comparison. The owner chose the shared intelligence engine
and preserved CRM with a complete operator console; see
[APP_BLUEPRINT.md](APP_BLUEPRINT.md) and [FULL_APPLICATION.md](FULL_APPLICATION.md)
for the implemented application and remaining gates.

## Findings

- **Our existing Community Manager** is an Electron/React live-event fan CRM.
  Real code: event connector, watchlist poller (5-minute checks), multichannel
  **event** viewer, optional TikTok captions, local sessions/exports and clips
  where a playable stream is available.
- It **does not yet** provide independently transcribed audio, reliable
  guest-username attribution, server-native recording jobs for several
  channels or a multi-tenant evidence journal.
- **LiveLens PR #1** has an early combined chat/caption evidence UI,
  but the automated build check was not green. It is a separate draft PR
  and NOT merged into this research branch.
- **Eight repos** are now pinned as isolated submodules, not app dependencies.
  See the catalogue for licence constraints and capabilities.
- **ALFRED** has a source/evidence specialist-contract proposal and code,
  but no LiveLens adapter.

## Strategy

A. Rename the old Electron CRM: expedient but mixes fans, gifts,
engagement and evidence into an increasingly unwieldy app.

B. **RECOMMENDED: new standalone LiveLens core and web UI.**
Use the previous CRM for audited source adapters, recovery patterns and
recorded fixture examples. Keep the working CRM intact, rework the UI
as an analyst command centre, and include an ALFRED bridge as a product
interface, never a hard dependency.

C. Run every upstream as a single giant stack: conflicts between licences,
deps, capture semantics and failure handling. Do not do this.

## First concrete feature

"Record one permitted LIVE completely, with video, audio, original chat,
speaker-labelled transcript, a seekable synchronised timeline and an
evidence-linked export. Then prove it handles **two rooms at once**."

Sequence:
1. Stable room/session/source IDs, mock/replay adapter and tests.
2. Headless capture worker, stop/finalise/recovery and source gaps.
3. Independent ASR and diarisation worker (WhisperLiveKit benchmark).
4. Time synchronisation and manual guest attribution.
5. Search, clip, case and reviewed evidence report.
6. ALFRED read-only status/alerts/reports integration.
7. Multi-user/workspaces, operational cost caps and scale testing.

**Recommendation:** create a distinct private LiveLens repository after
reviewing this source shelf, cherry-picking only audited reusable pieces
of Community Manager and the LiveLens prototype, rather than turning the
old app into a monolith. No new repo has been created by this branch.
