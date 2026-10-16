# LiveLens development handoff

PRs #1, #2 and #3 were merged into `redesign` on 11 October 2026 at the
owner's request. Merged baseline `aacfb18` has the same tree as `53267ed`,
which passed both hosted application/service/browser runs and source inventory.
Current continuation is the capture-first LIVE monitor on
`feat/livelens-live-studio-2026-10-11`, following invited workspace onboarding.
Preserve later commits and user changes. This continuation does not deploy the application.

The owner selected **Aperture Studio**. Its [implemented design](APERTURE_STUDIO.md)
adds a narrow rail, warm charcoal frame, self-hosted Inter, expansive playback,
compact conversation and source-bound saved moments with actual media thumbnails.
The monitor and library share the design language. More tools preserves specialist
destinations and deep links. Recording maintenance and idle collection schedules
use disclosures. Consult the latest validation/screenshots before relying on an
earlier audit's remaining-work list. The design selection is approved; acceptance
of the implementation and external-provider/production gates remain separate.

The [current workflow pass](APERTURE_WORKFLOWS.md) adds a per-recording retained-time
scrubber, speed/skip controls, collector-only evidence seeks and explicit gaps;
server-side whole-session/library search before pagination; off-page saved-original
hydration; and a three-step private ALFRED recipe builder. Keep With video and the
ALFRED 200-recent-session picker bounds explicit. Generating files does not install
or verify a private ALFRED runtime. See the latest receipts for actual optional
PostgreSQL/PDF/speech checks and browser behavior.

The current delivered milestone is [Aperture Investigation Desk](INVESTIGATION_DESK.md):
searchable source intake and accessible case pages, atomic case creation with a
statement, bounded batch linking, source-return draft preservation and a clearer
question-to-reviewed-brief workspace. Its current validation supersedes older
workflow counts. Keep the 200-source reviewed-case bound distinct from the legacy
1,000-source original export API, and preserve server revision checks on reports.

Read [FULL_APPLICATION.md](FULL_APPLICATION.md) for the product and remaining gates,
[VALIDATION.md](VALIDATION.md) for executed receipts,
[RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md) for configuration, and
[SCREENSHOTS.md](SCREENSHOTS.md) for the running interface. Then consult
APP_BLUEPRINT.md, PLATFORM.md, the backlog, reuse register, service README and
ALFRED integration notes before extending contracts.

Implemented: the operator console and retained-data workflows; same-origin
scoped authentication; Electron
archive bridge; concurrent bounded recording and selected-source scheduling;
optional media-linked speech; reviewed investigations, counterevidence/comparisons;
provenance graph; contextual in-app protection signals/reviews; redacted reports
and configured PDF; workspace roles/case grants/quotas/audit/explicit retention;
optional PostgreSQL pilot-schema storage; encrypted verified media archive/restore;
encrypted SQLite backup recovery; a standalone ALFRED policy gateway; and actual
optional ALFRED authenticated tools/CLI on a separately published branch.

Actual desktop/phone/keyboard browser acceptance reopens evidence, reviewed findings
and the same report after restart. Tests distinguish generated media, fictional
evidence, reference speech, local HTTP provider fixtures and actual PostgreSQL
from external-provider and production acceptance.

Community/CRM remains the native Electron application with its existing local
fan storage. The browser `?page=` bridge is a development demo; it is not a
shared-server CRM or evidence of unified customer fan records.

Partial gates remain explicit: real selected LIVE, speech diarisation/overlap,
external-model semantic quality and production ALFRED installation are unvalidated.
Actual configured-fixture ALFRED integration passed on
[draft PR #20](https://github.com/EmotiveImpact/Alfred/pull/20), commit
`5b37ba41353cfcd0cae4243482520e25175e21d9`; it remains unmerged/undeployed.
See [ALFRED_INTEGRATION.md](ALFRED_INTEGRATION.md) for exact runtime receipts.
PostgreSQL uses the pilot schema, not the separately scaffolded production RLS/
queue target. Payments, public self-service signup, production rollout and
representative capacity/cost remain outstanding. Native Electron GUI startup is
unverified. Optional persisted accounts support administrator-issued invitations,
password reset links and immediate session revocation; see
[WORKSPACE_ONBOARDING.md](WORKSPACE_ONBOARDING.md). All eight research imports remain pinned/research-only; adopted
optional runtimes have separate licence inventories.

## Current direction: capture before review

The owner rejected the review-first home as the main product experience. The
default entry point is a recognisable LIVE monitor: selected `@account` sources,
bounded availability checks/watch schedules, explicit Record/Stop, a large
retained-recording preview beside captured chat, and recent recordings.
The review desk remains a secondary workflow for retained evidence and findings.
Read [LIVE_MONITOR.md](LIVE_MONITOR.md) for the operating guide and inspected
XploitVoid recorder/Pieter monitor references. Their pinned sources are design
references; they are not installed applications or runtime imports.

Prior browser passes establish the exercised workflows and access boundaries.
The owner has now selected Aperture Studio as the visual direction; earlier browser
passes do not establish acceptance of its implementation or that the console is
visually finished. Keep capture-monitor receipts separate from those historical
checks. Real external LIVE discovery/capture remains unvalidated; retained-media
replay must not be called a direct live-video preview. Actual ALFRED integration
has its own configured-fixture receipt; it does not establish a user's production
connection or external LIVE capture.

Use the existing isolated checkout in cloud tasks; create no worktree unless
requested. Restart processes after environment restoration. Saved startup
instructions describe the fixture workflow and checks; a saved draft is distinct
from environment publication.

FIRST_RELEASE.md and historical VALIDATION.md sections retain the previous slices.
Their future-work lists are superseded by the current backlog. GitHub hosted checks
at that checkpoint failed before runner steps with payment/spending-limit
annotations. Check the latest run before claiming hosted CI passed; do not change
billing settings as part of development.
