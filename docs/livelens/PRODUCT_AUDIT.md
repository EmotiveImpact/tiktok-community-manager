# LiveLens product audit — 11 October 2026

**Verdict: useful and working, but not yet a polished final product.** The monitor
now has a coherent recording workspace. The wider application still exposes too
much of its internal structure. Real workflow and accessibility checks found two
high-priority defects; both are fixed and covered by browser regression checks.
Passing these checks does not establish owner design acceptance.

This is a fresh audit of eight actual authenticated application steps, using
Product Design's screenshot-first workflow and Shiro's clarity, hierarchy,
consistency and accessibility review. Before captures were taken on `acfb377`.
After captures and all five final browser journeys use `index-Ch5jfvlq.js` and
`index-CepzgEEN.css`. Desktop viewport: 1440 × 1024; phone: 390 × 844.
All accounts and conversations are explicitly fictional. Colour bars are actual
generated test video. A six-second fixture recording was explicitly requested;
the configured public-account fixture was never checked or collected.

![Actual monitor after this audit](screenshots/product-audit/after-01-monitor.png)

## Eight inspected steps

| Step | General health after fixes | Before → after evidence |
|---|---|---|
| 1. Desktop monitor | Improved. Account entry has usable width; saved conversation has session/date context. Navigation remains crowded. | [Before](screenshots/product-audit/01-monitor-desktop.png) · [After](screenshots/product-audit/after-01-monitor.png) |
| 2. Phone monitor and navigation | Keyboard defect fixed. Drawer traps focus, closes with Escape, returns focus and makes covered controls inert. | [Before](screenshots/product-audit/02-monitor-phone.png) · [After](screenshots/product-audit/after-02-phone.png) · [Drawer](screenshots/product-audit/after-02b-phone-navigation.png) |
| 3. Record and replay | Wrong-account action defect fixed. Saved replay has its own mode and Back to monitor action; exact-job playback remains verified. | [Fixture media](screenshots/product-audit/03-recording-desktop.png) · [Defect](screenshots/product-audit/03b-replay-source-mismatch.png) · [After](screenshots/product-audit/after-03-replay.png) |
| 4. Session library | Consistent shell and accurate conversation labels. Rows still need useful retained-media summaries. | [Before](screenshots/product-audit/04-session-library.png) · [After](screenshots/product-audit/after-04-library.png) |
| 5. Recorded conversation | Functional but dense. Provenance is useful; archive, transcription and hash detail compete with finding a moment. | [Before](screenshots/product-audit/05-recorded-conversation.png) · [After](screenshots/product-audit/after-05-conversation.png) |
| 6. Review desk | Shell and inbox labels corrected. Evidence selection works; collection scheduling remains too prominent above review. | [Before](screenshots/product-audit/06-review-desk.png) · [After](screenshots/product-audit/after-06-review.png) |
| 7. ALFRED connection | Setup is now first, remains available when the tool manifest fails, and preserves truthful connection status. Still a manual setup. | [Before](screenshots/product-audit/07-alfred-connection.png) · [After](screenshots/product-audit/after-07-alfred.png) · [Service error](screenshots/product-audit/after-07b-alfred-error.png) |
| 8. Workspace settings | Stale ALFRED roadmap wording corrected; Set up ALFRED opens the right screen. Capability inventory remains technical. | [Before](screenshots/product-audit/08-workspace-settings.png) · [After](screenshots/product-audit/after-08-settings.png) |

## Findings resolved

### P1 — Saved replay offered collection actions for a different account

With the fictional public source selected, opening the fixture recording changed
the heading to `@fictional_host`, while Check LIVE, Watch only and Record when LIVE
still used the selected public account. The screenshot shows the contradictory
heading, selection and actions; its media-loading overlay is unrelated to this
control-binding defect. No external action was clicked during reproduction.

Replay now selects its resolvable originating source, including schedule-linked
jobs, hides source collection actions and limits, clears stale notices and focuses
the replay heading. Back to monitor restores the originating source's controls.
Independent active jobs retain their explicitly labelled stop controls. Browser
checks start from an unrelated source and verify both replay and return, including
two different recordings of the same session and no new external jobs/schedules.

### P1 — Phone navigation left keyboard focus behind the overlay

Opening the drawer left focus on its toggle. A real Tab keypress reached background
search instead of navigation. The drawer now receives focus, exposes dialog
semantics, wraps Tab/Shift+Tab, makes covered content inert and locks body scroll.
Escape restores the toggle; choosing a destination focuses the main content.
These behaviors are verified with actual keyboard input in the monitor journey.

### P2 — The application frame changed between destinations

The monitor used a 184px sidebar and 56px header; the library switched to 232/64px
and the review desk to 232/72px, with different colours and breadcrumbs. A shared
authenticated shell now carries the restrained charcoal/warm-white palette,
navigation, breadcrumb, spacing and focus treatment across destinations. Measured
library, review and ALFRED screens all use 184/56px. Component colours use shared
semantic tokens. The phone retains a collapsible drawer and 44px shell controls.

### P2 — Primary setup actions were cramped or buried

The desktop account input was approximately 72px wide. It now uses the Accounts
panel width (176px measured), with Add account beneath it. ALFRED's setup guide
previously followed its identity and entire tool inventory. It now precedes those
details and stays visible even when `/v1/agent` returns HTTP 503. Settings links
directly to it. A manifest is not proof of a private ALFRED installation: the UI
continues to say Connection not checked when registration is unknown.

### P2 — Labels overstated or obscured the available context

The captured feed now names its saved conversation and session start date. Recent
recordings include dates. Fixture conversation rows no longer imply that every
conversation has video. The review inbox heading follows its selected filter.
Global search says Search captured statements, matching its actual text query.
Settings describes the optional ALFRED provider as available, with configuration
and connection verification required in ALFRED.

## Remaining design work, in priority order

1. **Simplify navigation around everyday tasks.** Thirteen destinations still ask
   operators to understand the implementation before using it. Validate a smaller
   primary navigation for Monitor, Recordings, Investigations and Settings, with
   specialist tools placed within their relevant workflow. Preserve direct links
   and scope-aware access. This needs representative operator task testing.
2. **Put finding a moment first in recorded conversations.** Keep video, timeline,
   search and selected context together. Move hash, archival and transcription
   operations into clearly labelled secondary disclosures without hiding gaps or
   losing source provenance. Acceptance: reach a statement and its covered video
   before encountering maintenance controls.
3. **Make the library useful for choosing a recording.** Add real retained-media
   availability, recorded duration and capture state where the service supplies
   them. Distinguish conversations with no video. Do not derive invented duration
   from conversation length. Acceptance: users can select a playable capture
   without opening every session.
4. **Keep review focused on evidence.** Collection schedules currently sit above
   the inbox. Move them to secondary context and clarify the View missions action,
   which routes to protection missions rather than a schedule manager. The latter
   is a code-backed navigation finding, not a newly exercised provider workflow.
5. **Guide the real ALFRED handoff.** The optional provider is implemented in the
   companion application, but a customer must still privately configure it and
   verify discovery there. A future guided setup needs an actual authenticated
   handoff and truthful status; a decorative Connected indicator would not solve
   this. Keep workspace, source and collection permissions separate.
6. **Broaden accessibility and operating evidence.** Keyboard, narrow-screen
   overflow and focus regressions are covered. This was not a complete screen
   reader, zoom, contrast or assistive-technology audit. External TikTok LIVE,
   customer-scale operation and owner design approval remain unvalidated.

## Verification and boundaries

| Check | Result and evidence |
|---|---|
| Existing application regression | 91 tests pass across 11 files. |
| Final renderer/Electron build | Pass; `index-Ch5jfvlq.js`, `index-CepzgEEN.css`. |
| Monitor browser journey | [Pass](product-audit-monitor-validation.json): new replay-account and drawer regressions, actual capture, hashes/ranges, decoded playback/seek, exact-job replay, >100 chat records, independent stops and real viewer HTTP 403. |
| Original operator journey | [Pass](product-audit-original-validation.json): desktop/phone, recording, search, case exports and restart. |
| Full application journey | [Pass](product-audit-full-validation.json): investigations, counterevidence, graph, contextual reviews, redaction, actual PDF and restart. |
| Review desk journey | [Pass](product-audit-review-validation.json): source reset, exact context, deep links, acknowledgement binding, schedules, permissions and restart. |
| Persisted onboarding journey | [Pass](product-audit-onboarding-validation.json): real cookies, invitations, role changes, resets, revocation, expiry, workspace isolation, no-secret assertions and restart. |
| Focused shell/setup checks | [Pass](product-audit-layout-validation.json): common shell geometry, ALFRED setup survives manifest failure, settings opens setup, zero page errors. |

All five browser journeys ran against the final bundle and reported zero uncaught
page errors. Existing assertions were preserved; the monitor suite adds regressions.
The earlier 120-test optional-service and companion ALFRED receipts remain evidence
for unchanged backend code; they were not rerun locally for this UI audit. Hosted
results are recorded on PR #5 for their exact head. No deployment or external LIVE
collection is part of this audit.
