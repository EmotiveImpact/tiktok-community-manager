# LiveLens — actual application screenshots

These captures show the running application, not mock-ups. Desktop
views use 1440-pixel width; phone views use 390-pixel width. All accounts,
statements and media are labelled fictional fixtures. The colour bars and tone
are actual FFmpeg media used for playback, seek, archival and recovery checks.
The [current full browser receipt](refined-app-browser-validation.json),
[original journey receipt](refined-original-browser-validation.json) and
[review desk receipt](review-desk-validation.json) record the exercised journeys.
The separate [archive receipt](browser-validation.json) preserves its earlier
recovery validation. Design references are in [DESIGN_CONCEPTS.md](DESIGN_CONCEPTS.md).

## Invited workspace accounts

Actual administrator invitation form and persisted operator accounts; no private
join links or populated password fields are shown. The separate
[onboarding receipt](onboarding-validation.json) records real signup, access
changes, password recovery and restart checks on isolated fictional identities.

![Workspace invitations](screenshots/workspace-invitations.png)

| Phone invitation | Persisted accounts |
|---|---|
| ![Phone workspace join](screenshots/phone-workspace-join.png) | ![Persisted operator accounts](screenshots/workspace-accounts.png) |

## Review desk — selected C layout with a restrained dark palette

This is the actual 1440 × 1024 desktop viewport, with a draft finding selected,
its exact supporting source, verified playback and the investigation action.

![LiveLens review desk](screenshots/review-desk.png)

Phone views provide a selectable inbox and a source preview with a keyboard
accessible Back to inbox action.

| Phone inbox | Selected original source |
|---|---|
| ![Phone review desk](screenshots/phone-review-desk.png) | ![Phone original source](screenshots/phone-review-source.png) |

## Conversation and original evidence

![Media playback and original context](screenshots/replay-evidence.png)

## Reviewed investigation

![Investigation with support, counterevidence and review](screenshots/investigations.png)

## Reviewed report and redaction

![Report editor and downloadable evidence/PDF](screenshots/cases-reports.png)

## Context graph

![Graph with selected source evidence](screenshots/context-graph.png)

The graph keeps anonymous tracks within their original session, speech job and
media segment. A manually declared person reference remains explicitly unverified.

![Source-scoped tracks and unverified person reference](screenshots/identity-boundaries.png)

## Missions and reviewed protection signals

![Selected-session mission and contextual rule](screenshots/missions.png)

![Reviewed signal with context and gaps](screenshots/reviewed-alert.png)

## Account activity and comparisons

![Observed account activity from retained sources](screenshots/account-activity.png)

![Cross-session literal comparison with quotations](screenshots/comparison.png)

## Workspace audit

![Persisted workspace audit](screenshots/workspace-audit.png)

## Encrypted archive and recovery

This separate browser check archived verified media, removed one local segment,
restored it through the interface, compared its SHA-256 and reopened video playback.
These two archive captures retain the earlier visual theme and are historical
recovery evidence; the current console palette is shown above.

![Verified archive and restored original media](screenshots/desktop-archive-restored.png)

## Phone

| Investigation | Source-linked graph |
|---|---|
| ![Phone investigation](screenshots/phone-investigation.png) | ![Phone graph connections](screenshots/phone-graph.png) |

![Phone archive recovery](screenshots/phone-archive-restored.png)

The [release notes](FULL_APPLICATION.md) distinguish these measured fixture
workflows from unvalidated real LIVE, diarisation, external model quality,
ALFRED registration and customer-scale operation.
