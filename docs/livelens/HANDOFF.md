# LiveLens development handoff

PRs #1, #2 and #3 were merged into `redesign` on 11 October 2026 at the
owner's request. Merged baseline `aacfb18` has the same tree as `53267ed`,
which passed both hosted application/service/browser runs and source inventory.
Current continuation is invited workspace onboarding on
`feat/livelens-workspace-onboarding-2026-10-11`. Preserve later commits and
user changes. This continuation does not deploy the application.

Read [FULL_APPLICATION.md](FULL_APPLICATION.md) for the product and remaining gates,
[VALIDATION.md](VALIDATION.md) for executed receipts,
[RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md) for configuration, and
[SCREENSHOTS.md](SCREENSHOTS.md) for the running interface. Then consult
APP_BLUEPRINT.md, PLATFORM.md, the backlog, reuse register, service README and
ALFRED integration notes before extending contracts.

Implemented: the complete console; same-origin scoped authentication; Electron
archive bridge; concurrent bounded recording and selected-source scheduling;
optional media-linked speech; reviewed investigations, counterevidence/comparisons;
provenance graph; contextual in-app protection signals/reviews; redacted reports
and configured PDF; workspace roles/case grants/quotas/audit/explicit retention;
optional PostgreSQL pilot-schema storage; encrypted verified media archive/restore;
encrypted SQLite backup recovery; and a standalone ALFRED policy gateway.

Actual desktop/phone/keyboard browser acceptance reopens evidence, reviewed findings
and the same report after restart. Tests distinguish generated media, fictional
evidence, reference speech, local HTTP provider fixtures and actual PostgreSQL
from external-provider and production acceptance.

Partial gates remain explicit: real selected LIVE, speech diarisation/overlap,
external-model semantic quality and separate ALFRED registration are unvalidated.
PostgreSQL uses the pilot schema, not the separately scaffolded production RLS/
queue target. Payments, public self-service signup, production rollout and
representative capacity/cost remain outstanding. Native Electron GUI startup is
unverified. Optional persisted accounts support administrator-issued invitations,
password reset links and immediate session revocation; see
[WORKSPACE_ONBOARDING.md](WORKSPACE_ONBOARDING.md). All eight research imports remain pinned/research-only; adopted
optional runtimes have separate licence inventories.

Use the existing isolated checkout in cloud tasks; create no worktree unless
requested. Restart processes after environment restoration. Saved startup
instructions describe the fixture workflow and checks; a saved draft is distinct
from environment publication.

FIRST_RELEASE.md and historical VALIDATION.md sections retain the previous slices.
Their future-work lists are superseded by the current backlog. GitHub hosted checks
at that checkpoint failed before runner steps with payment/spending-limit
annotations. Check the latest run before claiming hosted CI passed; do not change
billing settings as part of development.
