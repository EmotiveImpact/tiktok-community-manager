# Validation receipt

## Aperture Operations & Recovery — 16 October 2026

O01 implements stage 2 of the [standing programme](MASTER_PLAN.md). The
[operating guide and actual screenshots](OPERATIONS.md) cover workspace worker
observations, reservation-aware capacity and durable retention cleanup.

- [Application/build](operations-build-validation.json): **127 tests / 14 files**
  pass; TypeScript, renderer and Electron main/preload production builds pass.
  Final renderer `index-CrYZznnn.js`, stylesheet `index-Brl14Sbd.css`. Existing
  Browserslist age and bundle-size notices remain.
- [Service](operations-service-validation.json): **165/165, zero skips**, including
  actual PostgreSQL 17.6, SQLite, FFmpeg, pinned PocketSphinx and Chromium PDF.
  Sixteen new Operations checks run across both databases; one backup cleanup
  contract verifies refusal of unfinished tasks and restored completed history.
- [Browser](operations-browser-validation.json): **seven journeys pass**, 70
  screenshots and zero uncaught page errors. All actual served renderer/CSS hashes
  match the final build. The six existing journeys were rerun after the recovery
  entry fix; no existing assertion was weakened.
- [New Operations journey](operations-journey-validation.json): actual generated
  media, queued reservations, restricted workers and workspace denial; real
  filesystem permission failure; partial cleanup and byte reservations after
  record deletion; restart, failed retry and successful retry of the same task;
  unconfigured workers; original-conversation navigation; fresh browser entry
  with a deliberately corrupt archive manifest and unavailable capacity.
- [Pilot drill](pilot-drill-validation.json): 600 mixed requests, zero unexpected
  errors, six actually in flight; p50/p95/p99 **11.871/30.956/58.390 ms** during
  this paced 12-second fixture. Two actual synthetic captures overlap for 11.903
  seconds. After removing its own original data, a fresh restored API reopens
  **2,240 exact originals**, notes, bookmarks, findings/reviews, report/redactions,
  grants and audit. All **16 segments / 630,730 bytes** match original hashes and
  actually decode to 32 seconds / 320 frames. Restore plus reopen/verification
  takes 2,167.389 ms. Seven access/isolation checks pass before and after recovery.
- [Visual inspection](operations-layout-validation.json): 12 actual desktop/phone
  captures, no horizontal page overflow or blank footer tails. Aperture styling
  and visible keyboard focus remain. [Design QA](../../design-qa.md) records scope.

Independent review caught and fixed a fresh-entry failure: workspace usage errors
hid the entire Operations view. Its navigation now works independently of the
failed metadata request. Actual corrupted archive usage returns a refused
workspace response while Operations displays worker failures and unavailable
capacity; it never substitutes zero. Durable cleanup also refuses replaced
directories, symlinks and reused recording IDs, and reserves known bytes until
actual removal. Backup checks unfinished cleanup on both its source database and
the completed snapshot. No automatic retry, retention or provider polling starts.

These are exercised local pilot contracts. The workload is short and paced, not
a saturation or hundreds-of-users result. Recovery uses a quiesced SQLite/local
snapshot, not crash RPO, PostgreSQL or external-bucket recovery. Missing original
cleanup identities have no force-resolve operation. External LIVE, private ALFRED,
representative speech/context quality, production migration/deployment and
commercial acceptance remain separate gates. ALFRED source is unchanged; its
earlier full suite is not claimed as a new private-host test. The dedicated
PostgreSQL fixture is stopped and private credential files removed. Hosted CI is
reported separately on the exact pushed PR head.

Hosted follow-up: the first push run passed service/build/recovery but timed out
in the monitor's held-response test. Its duplicate PR run passed the monitor,
then exposed an Operations keyboard focus-order race after restart. The harness
now waits for actual navigation focus before selecting Operations. The monitor
keeps its one-shot interception through page close, so releasing the real POST
cannot race interception removal; an added check verifies exactly one schedule.
Four old-order local probes did not reproduce the hosted timeout, although traces
showed the teardown overlap. Both complete revised journeys pass on the exact
hosted Chromium 151/revision 1234, with all original assertions and unchanged
production assets. [Follow-up evidence and diagnosis limits](operations-browser-followup-validation.json)
preserve the failed runs. The gallery contains the pinned-browser Operations
recapture; latest hosted confirmation is recorded on PR #5.

## Aperture Investigation Desk — 16 October 2026

The [goal, implementation and screenshots](INVESTIGATION_DESK.md) connect retained
statements and saved moments to reviewed cases and reports. This receipt describes
its checkpoint; Operations & Recovery above is the latest continuation.

- Application: 127 tests in 14 files; TypeScript and renderer/Electron production
  build pass. Final renderer `index-Cuq1l9vc.js`, stylesheet `index-BZbmVy_B.css`.
- Service: [148/148, zero skips](investigation-desk-service-validation.json),
  including actual PostgreSQL 17.6, FFmpeg, PocketSphinx and Chromium PDF. Eighteen
  intake contracts across SQLite / PostgreSQL are included in that total. They cover
  full-journal search, saved-label pages, current attribution, ACL-before-page,
  scope/role checks, atomic create/link/rollback, duplicates and both source bounds.
- Browser: [all six journeys pass](investigation-desk-browser-validation.json),
  producing 58 screenshots with zero uncaught page errors or horizontal overflow.
  Fifteen investigation captures include phone footer/document geometry and opened
  provenance. Every journey hashes the actual final renderer/CSS responses.
  Existing five journeys and the new investigation journey use authenticated HTTP. Controlled lost-response tests commit on the real service before dropping
  a browser response; no successful payload is fabricated.

Independent review found and fixed: a blank account filter refusing source reads;
shared form CSS overriding the search layout; duplicate bookmark row identities;
reviewed-case / original-case capacity mismatch; dirty report overwrite on refresh; and
ambiguous case-creation retries; and hidden absolute labels causing phone scroll
overflow. A new-case retry reuses its exact ID/question and
verifies the retained original before accepting recovery. No existing assertion
was weakened: legacy link selectors now use the real destination picker, and
source-free decorative row numbers are hidden from accessible names.

Limits remain explicit: 50 selected originals per tray, 200 per reviewed case;
legacy original-evidence cases retain 1,000. Linking is not journal certification;
exports verify source journals. Unsaved drafts are held in memory for temporary
source detours, not persisted across page reload or explicit navigation. External
LIVE, private ALFRED installation, representative speech/model quality and customer
production capacity remain separate gates.

Hosted application, service and all six browser jobs passed at implementation
`52aa0ac72c6b6bc7f8a2205ae94858d301eb0738` in [PR run 38886782136](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38886782136).
The duplicate push run exposed a keyboard-test ordering race in the existing
review desk: navigation schedules main focus on an animation frame, which could
arrive after the harness focused a disclosure but before Enter. The failure
artifact showed the loaded, closed disclosure. A controlled browser probe now
holds and releases the actual navigation focus to reproduce that ordering. The
harness waits for navigation focus before targeting the disclosure and verifies
both focused summary and open state. Its full journey passes with unchanged
renderer bytes and all schedule, media, permission and restart assertions intact.
This follow-up changes validation only; later hosted results are recorded on PR #5.

## Aperture workflows — 11 October 2026

The [current application and gallery](APERTURE_WORKFLOWS.md) preserve the approved
Aperture Studio design while adding per-recording transport, complete retained
search, stable saved originals and guided private ALFRED setup. Final renderer:
`index-Bi3d_2-c.js`; stylesheet: `index-BUy4-zTR.css`.

| Check | Actual result |
|---|---|
| Application tests and production build | [127 tests in 14 files pass](operator-workflow-build-validation.json); TypeScript, renderer, Electron main/preload build. Nine new transport model cases and 23 ALFRED setup cases. Existing Browserslist/chunk-size notices remain. |
| Full service suite | [130/130 pass, zero skips](operator-workflow-service-validation.json), including actual PostgreSQL 17.6, FFmpeg, offline Chromium PDF and pinned PocketSphinx recognition. No service source changed after this run. |
| Search contracts | [25 focused checks pass](operator-workflow-search-validation.json): SQLite and actual PostgreSQL, 300-event journals, 225-session libraries, literal metacharacters, current assertions, stable sequence pages, actual HTTP scope/workspace boundaries and older @handle matches. Included in the full service suite, not 25 additional unique tests. |
| Monitor browser journey | [Pass](operator-workflow-monitor-validation.json): cross-segment range/skip/rate, job isolation and auto-advance, provider-only clocks/gaps, older event/session search, stale-response refusal, off-page original hydration and exact 100/200 terminal-page return. All prior capture/hash/range/stop/read-only/keyboard assertions retained. |
| Full application journey | [Pass](operator-workflow-full-validation.json): exact ALFRED selected-session/read-only JSON, actual downloads, keyboard tabs, explicit bounded source option, invalid origin focus, no supplied-endpoint call/install/browser storage. Existing bookmarks, original clocks/frames/repeated seeking, review, exports, actual PDF and restart assertions retained. |
| Original / review / onboarding journeys | [Original](operator-workflow-original-validation.json), [review](operator-workflow-review-validation.json) and [onboarding](operator-workflow-onboarding-validation.json) pass; real cookie/scopes, invites, revocation, schedule bounds and persisted reopen remain intact. |
| Actual desktop / phone visual inspection | [12 final studio captures and geometry](operator-workflow-layout-validation.json); shared-form CSS conflicts and squeezed phone ALFRED introduction fixed and recaptured. [Design QA](../../design-qa.md) records scope and remaining acceptance. |
| Pinned source inventory | Eight research gitlinks verify. Nested research checkouts are not present or claimed as executed applications; adoption remains research-only. |

All five final browser journeys ran with at most two concurrent QA browsers,
generated **43 screenshots**, and reported **zero uncaught page errors or horizontal
page overflow**. Each receipt hashes the actual authenticated renderer/CSS response
bytes; the [aggregate receipt](operator-workflow-browser-validation.json) matches
the final build. Published functional captures include [whole-session search](screenshots/operator-workflow/verification-whole-session-search.png),
[recording transport](screenshots/operator-workflow/verification-recording-transport.png),
[ALFRED recipe](screenshots/operator-workflow/verification-alfred-recipe.png) and
[phone access](screenshots/operator-workflow/verification-alfred-phone.png).

Review caught misleading empty-page copy at exact page boundaries. The final UI
says the results have ended without denying earlier matches; new browser checks
exercise Next into an empty page and Previous back to those matches. An initial
new ALFRED assertion used a label locator that included select option text; the
harness now uses the actual named combobox role. No access, collection, persistence
or original workflow assertion was removed or weakened. Earlier browser passes
were repeated on the final asset hashes after visual/copy corrections.

A hosted duplicate push run exposed a timing race after the first successful local
and PR runs: receiving the initial event page cancelled an unrelated pending
bookmark-original GET, which was then requested twice. Per-evidence request
lifetimes now preserve unchanged reads while cancelling removed/supplied rows and
session/scope teardown. Aborted requests retain their slot until settled, keeping
the six-request maximum. The [deterministic before/after receipt](operator-workflow-hydration-validation.json)
holds actual authenticated responses: the previous renderer requests the original
twice; the fixed renderer keeps one request across page arrival, search and refresh,
then resolves the exact original and decoded frame. The final journeys include
this regression; its count assertion was retained, not relaxed.

Generated ALFRED configs also passed its pinned actual in-memory validators
without transport or installation. ALFRED source is unchanged at `5b37ba4`; its
full prior backend/HTTP/browser suites were not rerun here. The private placement
guard remains enforced and private-host installation remains unverified.

The studio gallery's generated still/tone and illustrative captions are explicitly
synthetic, distinct from the standard colour-bar regression fixture and actual
PocketSphinx reference checks. These tests establish the exercised implementation,
not external LIVE, broad speech/semantic quality, customer capacity, native GUI
startup or production deployment. Hosted CI is checked separately on the pushed
commit. The dedicated PostgreSQL fixture was stopped and its private credentials
removed after validation.

## Aperture Studio implementation — 11 October 2026

The owner selected the Aperture Studio reference. The [implemented app](APERTURE_STUDIO.md)
now uses its narrow rail, warm charcoal, self-hosted Inter, media-led conversation
and source-bound saved moments. Final renderer: `index-CBq7TQKy.js`; stylesheet:
`index-uQ3gdMnf.css`; self-hosted font: `inter-latin-wght-normal-Dx4kXJAl.woff2`.

| Check | Actual result |
|---|---|
| Application tests and build | [95 tests pass in 12 files](aperture-studio-build-validation.json); TypeScript, renderer, Electron main/preload all build. Existing bundle-size/Browserslist warnings retained. |
| Monitor journey | [Pass](aperture-studio-monitor-validation.json): bounded capture, exact-job replay, hash/range, later chat, independent stops, desktop/phone, viewer HTTP 403. New popover default/selection/Escape/outside dismissal and permitted read-only Saved moments assertions pass. |
| Original operator journey | [Pass](aperture-studio-original-validation.json): existing source, replay and investigation assertions retained. |
| Full application journey | [Pass](aperture-studio-full-validation.json): actual bookmark ID/text/original clock, decoded thumbnail, keyboard original seek, same-selected re-seek after manual playback change, cross-session isolation, explicit choose-before-write and persistence after restart. Existing saved duration/filter/search, reviewed findings, graph, exports and real PDF assertions pass. |
| Review journey | [Pass](aperture-studio-review-validation.json): source-linked review, bounded schedule state/disclosures, selection, permissions, stop/deadline, no hidden capture and restart retained. |
| Onboarding journey | [Pass](aperture-studio-onboarding-validation.json): real cookies, invitations, roles, session revocation, recovery and persisted restart retained. |
| Visual comparison | [Pass](../../design-qa.md): selected 1487 × 1058 reference and equally sized actual browser state inspected together. Final [geometry and screenshot hashes](aperture-studio-layout-validation.json); 390px phone and desktop have no horizontal overflow or uncaught page errors. |

All five final journeys ran with at most two concurrent QA browsers and produced
39 screenshots with zero uncaught page errors. [Aggregate receipt and final asset
SHA-256 hashes](aperture-studio-browser-validation.json) identify the tested build.
The tests use the usual generated colour-bar fixture: [actual conversation](screenshots/aperture-studio/verification-conversation.png)
and [actual monitor](screenshots/aperture-studio/verification-monitor.png).
The separate visual demo uses a generated studio still recorded through FFmpeg
plus explicit fictional captions; it does not establish recognised speech or LIVE.

An initial visual-capture harness read a job snapshot before all three segments
were published; it now waits for the complete real receipt. The successful visual
recapture and final acceptance journeys above ran on the final renderer. No app
assertion was removed or weakened. Service contracts, provider adapters, dependency
lockfiles and ALFRED source are unchanged; their earlier complete suites were not
rerun locally for this UI pass. Hosted checks apply only to their published commit.
The owner approved the visual direction; final implementation, external-provider
and production acceptance remain distinct.

## Recording workspace refinement — 11 October 2026

The [implemented refinement](STUDIO_REFINEMENT.md) gives the actual application six
primary destinations, a recording library with receipt-backed metadata, a shared
video/timeline workspace and quieter recording/review disclosures. Final renderer:
`index-DvisZsW-.js`; stylesheet: `index-BAyBVht6.css`.

| Check | Result |
|---|---|
| Application regression and final build | [95 tests pass in 12 files](studio-refinement-build-validation.json); TypeScript, renderer and Electron build pass. Four new library cases cover saved-capture selection, interruption, duplicate segments and duration formatting. |
| Monitor browser journey | [Pass](studio-refinement-monitor-validation.json): six visible destinations, keyboard-operated More tools, specialist deep links and existing bounded capture, exact-job replay, source-switch, phone-focus and permission checks. |
| Original browser journey | [Pass](studio-refinement-original-validation.json): existing original-source, media and investigation workflow assertions retained. |
| Full application browser journey | [Pass](studio-refinement-full-validation.json): actual selected-segment SHA matches its HTTP receipt, recording tools open by keyboard, saved duration matches retained segments, video filter/search/reset/reopening work, and existing export/PDF/restart assertions pass. |
| Review browser journey | [Pass](studio-refinement-review-validation.json): idle and stopped schedules remain collapsed, a newly discovered bounded schedule opens the disclosure, actual HTTP/UI states agree, and source context, permissions, stop/deadline/no-hidden-job and restart checks pass. |
| Onboarding browser journey | [Pass](studio-refinement-onboarding-validation.json): existing invitation, real-cookie, role/revocation/recovery and restart assertions retained. |
| Actual desktop and phone captures | [Pass](studio-refinement-layout-validation.json): video and timeline align at 258px on desktop; no horizontal overflow at 1440px or 390px. Main gallery uses actual generated monochrome media. |

All five browser journeys ran on the final bundle with zero uncaught page errors.
An initial new review assertion compared a pre-poll `scheduled` snapshot with the
already-updated `discovered` interface. The harness now waits, within ten seconds,
for the actual fixture poll receipt before comparing the two. No renderer change
or weakening of schedule, permission or capture assertions was needed. The
successful rerun is the linked review receipt.

Backend/runtime contracts and ALFRED source are unchanged. Their earlier complete
service and ALFRED suites below were not rerun locally for this UI pass. Hosted
checks belong to the exact published commit. These fixture checks establish the
exercised behavior, not external LIVE access, production readiness or final owner
design acceptance.

## Eight-step product audit and fixes — 11 October 2026

The [fresh product audit](PRODUCT_AUDIT.md) records before/after evidence from eight
actual steps. Final renderer: `index-Ch5jfvlq.js`; stylesheet: `index-CepzgEEN.css`.
This pass fixes saved-replay actions targeting the previously selected account,
phone navigation focus escaping behind its overlay, inconsistent application
frames, buried ALFRED setup and misleading conversation/settings labels.

| Check | Result |
|---|---|
| Application regression and final build | 91 tests pass in 11 files; TypeScript/renderer/Electron build passes. |
| Final monitor browser journey | [Pass](product-audit-monitor-validation.json), including new wrong-account replay/Back and drawer keyboard/focus regressions; existing capture/media/permission assertions retained. |
| Final original and full journeys | [Original](product-audit-original-validation.json) and [full](product-audit-full-validation.json) pass, including actual PDF and restart. |
| Final review and onboarding journeys | [Review](product-audit-review-validation.json) and [onboarding](product-audit-onboarding-validation.json) pass, including source reset, contextual review, real cookies, permission changes, revocation and restart. |
| Focused shell/setup checks | [Pass](product-audit-layout-validation.json): 184px sidebar/56px header across library, review and ALFRED; 176px desktop account input; setup remains available on actual intercepted HTTP 503; settings link reaches setup. |

All five journeys ran against the final bundle with zero uncaught page errors.
No assertions were weakened. Backend/runtime contracts are unchanged; earlier
optional-service and ALFRED receipts below were not rerun locally for this UI pass.
Hosted checks belong to their exact published head on PR #5. Remaining product,
accessibility and provider acceptance work is explicitly listed in the audit.

## Monitor layout refinement — 11 October 2026

The owner rejected the crowded monitor. The revised actual app places account
setup in Accounts, collection actions beside the selected source, a larger 16:9
player next to chat, limits below the player and compact saved-recording rows.
The home uses neutral charcoal/warm-white tokens and removes the redundant eyebrow.
Final renderer: `index-BQzEr-5F.js`; stylesheet: `index-gnFuFJ2Q.css`.
[Actual screenshots](SCREENSHOTS.md) and [design audit](../../design-qa.md) show the
change. No service/API, provider, ALFRED policy or test assertion changed.

| Check | Result | Scope |
|---|---|---|
| Application regression | 91 passed, 11 files | Existing application tests after the main layout edits. |
| Final TypeScript/renderer/Electron build | Passed | Includes the final phone DOM/keyboard correction and scoped CSS. |
| Final monitor browser journey | Passed | Real bounded check/watch, FFmpeg capture/hash/range/decoded playback/seek, exact-job replay, >100 actual chat records, source-switch receipts, independent stops, viewer HTTP 403 and desktop/phone; zero uncaught page errors. [Receipt](monitor-redesign-validation.json). |
| Final secondary review and onboarding | Both passed | Existing complete assertions on `BQzEr-5F`; source selection, deep links, persistence, invitations, role/revocation/recovery and restart. [Review](monitor-redesign-review-validation.json), [onboarding](monitor-redesign-onboarding-validation.json). |
| Original and full browser journeys | Both passed | Preceding `index-YCnd_bzW.js`, before the monitor-only keyboard-order correction; not relabelled as final-bundle receipts. Hosted CI re-executes all five journeys on the published commit. |
| Actual phone keyboard and geometry | Passed | Real Tab order: recording limit → watch window → Open conversation → Chat; no horizontal overflow. Empty-player top moves from 1003.7px to 521.1px at 390px phone width; desktop from 511.9px to 255.7px. [Measured receipt](monitor-redesign-layout-validation.json). |

The complete 120-test optional service receipt and ALFRED continuation below
remain evidence for unchanged backend source. Current-head hosted results are
reported separately in PR #5. Screenshots are actual fictional/generated fixtures;
external LIVE access, production capacity and owner design approval remain unvalidated.

## Capture-first LIVE monitor — 11 October 2026

The owner requested a recognisable account monitor/recorder as the default home,
with the review desk secondary. The final renderer is `index-hYmzztav.js`.
[The operating guide](LIVE_MONITOR.md),
[actual monitor screenshots](SCREENSHOTS.md),
[browser receipt](live-monitor-validation.json) and
[recording receipt](live-monitor-recording-validation.json) document this change.
The [complete service receipt](live-monitor-service-validation.json) records the
final source/test hashes and optional runtime checks.
These are generated-media and explicitly fictional source/evidence checks. They
do not establish real external LIVE access or final owner design acceptance.

| Check | Result | Executed scope |
|---|---|---|
| Application regression | 91 passed, 11 files | Existing community, evidence and review-desk regressions on the final source. |
| Complete optional-backend suite | 120 passed; zero failed/skipped | Actual PostgreSQL 17.6, offline Chromium PDF, pinned PocketSphinx, FFmpeg recording/recovery and all authenticated service contracts; 58.513 seconds. |
| TypeScript/renderer/Electron build | Passed | Final capture-first monitor and recording-specific media preview; renderer `index-hYmzztav.js`. |
| Capture-first browser journey | Passed | Configured public account starts no polling; actual bounded discovery-only check/watch; FFmpeg capture with hash/range verification, decoded playback/seek and source-linked chat; stop watch keeps a separately requested capture; explicit recording stop; keyboard replay; 1440-pixel desktop/390-pixel phone and actual viewer writes denied with HTTP 403. Zero uncaught page errors or overflow. |
| Source and recording selection regressions | Passed | Delayed check receipt cannot appear under another selected account; two recordings in the same session replay only their selected job; 125 fictional records appended through actual HTTP advance the rolling window of 100 loaded events and reopen exact late-message context. |
| Active-job HTTP projection | 2 passed | Active jobs remain returned beyond 100 newer terminal receipts; workspace/read-scope boundaries, session filter, limits and strict boolean validation. The monitor merges 100 recent with up to 200 active receipts and deduplicates job IDs. |
| Actual PostgreSQL active projection | Passed | 115 terminal receipts plus six older active jobs; recent page remains 100 and active selection preserves all six, with session/workspace/filter/page-bound checks. Metadata fixture spawns no FFmpeg and its temporary schema is removed. |
| Original/full/onboarding/secondary-review browser journeys | Passed | Actual replay/seek/restart, findings/counterevidence/comparison/graph, contextual reviews, redacted exports/offline PDF, persistent invited credentials, role/revocation/reset, exact source selection and deep links remain working with the capture-first entry point. |
| Pinned source inspection | 8 Gitlinks unchanged | Exact XploitVoid/Pieter recorder/monitor source patterns read without executing upstream applications; previously audited Git blob hashes match the lock. Runtime imports remain separately inventoried. |

The monitor reports availability **at last check**, with its clock; unavailable
provider results remain distinct from offline. Preview consists of saved verified
segments and is delayed. It implements no direct live-video feed. Stop watch
requests a stop for its linked capture, while independent jobs keep their own
limits. Recording-specific replay cannot continue into another job's media.

Earlier validation sections below are historical receipts. Their design-reference
comparisons do not override the owner's later direction or establish a polished
final product. The actual ALFRED continuation has a separate application/runtime
receipt; the standalone gateway is not evidence of registration by itself.
No external TikTok collection, model call, email, billing change or deployment
was performed by the monitor browser checks.

The initial published head's PR browser run passed all five journeys; its push
run failed the monitor's five-second status matcher after the backend check had
completed. A [controlled real-read delay](live-monitor-read-sync-validation.json)
reproduced the same `Unchecked` result while a successful browser schedule read
was held for six seconds. After delivery, the unchanged status assertion passed
with a bounded 15-second wait, matching the browser/API timeout. The test now
waits for that separate browser snapshot; no application behavior, capture limit
or permission assertion was changed.

## Actual optional ALFRED tools — 11 October 2026

[ALFRED PR #20](https://github.com/EmotiveImpact/Alfred/pull/20), ready for review, publishes
branch `feat/livelens-tools-2026-10-11`, commit
`5b37ba41353cfcd0cae4243482520e25175e21d9`. Its first-party provider is installed
explicitly, loaded by the actual Desk runtime, and callable through authenticated
HTTP or the ordinary operator CLI. This is not inferred from LiveLens's standalone
manifest. See [ALFRED_INTEGRATION.md](ALFRED_INTEGRATION.md) and the immutable
[redacted actual-transport receipt](https://github.com/EmotiveImpact/Alfred/blob/5b37ba41353cfcd0cae4243482520e25175e21d9/docs/evidence/livelens-2026-10-11/http-receipt.json).

| Check | Result | Executed scope |
|---|---|---|
| Full ALFRED backend | 1,128 passed; zero skipped | Includes 15 focused LiveLens tool/approval/policy/token/placement/reconciliation cases; existing source, lifecycle and identity contracts remain covered. |
| Actual ALFRED HTTP/CLI transport | 36/36 passed | Authenticated discovery/source reads, independent grants and actual denials, exact capture proposal/approval/dispatch, installed operator CLI and secret-free receipts. |
| Actual capture through ALFRED | Passed | One explicitly approved six-second generated capture, three hashed segments, strict independent FFmpeg decoding totaling 6,000 ms. Dispatch acceptance and recording completion are separately checked. |
| ALFRED browser regression | 58 checks passed | 33 Desk and 25 Knowledge Chromium checks. |
| Hosted ALFRED CI | All six passed | Exact commit `5b37ba4`: original contracts, local validation, core/source checks, backend browser, console and connected console. [Unified run](https://github.com/EmotiveImpact/Alfred/actions/runs/38111995356). |

G01/G02 are implemented for this optional configured runtime: source/workspace
binding, current read/model separation, exact independently granted bounded
collection, revocation, token rotation, timeout/reconciliation and untrusted-source
boundaries are tested. Fourteen of nineteen milestones are implemented and five
remain partial. The ALFRED branch is unmerged/undeployed; production configuration,
external LIVE access and customer-scale operation remain separate gates. No NLP
tool auto-selection, automatic memory acceptance, tool-board UI, model request,
email or external TikTok capture is claimed. Historical registration-outstanding
receipts below describe their earlier revisions and remain intact.

## Invited workspace continuation and merged baseline — 11 October 2026

PRs #1, #2 and #3 are merged into `redesign` at `aacfb18`. Its tree matches
`53267ed`, which passed [push run 38102007232](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38102007232)
and [PR run 38102009370](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38102009370):
application tests/build, actual PostgreSQL/speech/FFmpeg service checks and all
three original/full/review-desk browser journeys. Source inventory also passed.
The research merge retains exactly eight canonical, unchanged source pins.

The combined research branch exposed an asynchronous comparison-selector race in
the test. A controlled 1500 ms delay reproduced its zero-checkbox snapshot and
disabled submit button. Waiting for both retained conversation checkboxes then
selected their actual IDs and created the comparison with HTTP 201. The original
comparison assertions were retained; no application behavior was changed.

The next continuation adds optional persisted accounts and real administrator
invitations. [Its browser receipt](onboarding-validation.json) and
[actual screenshots](SCREENSHOTS.md) use isolated fictional identities and real
SQLite/HTTP/cookies. Renderer bundle: `index-D-WDEAHp.js`.

| Check | Result | Scope |
|---|---|---|
| Application regression | 91 passed, 11 files | Existing community, timeline and desk checks |
| Complete backend suite | 118 passed, zero failed/skipped | Twelve account tests plus actual PostgreSQL 17.6 lifecycle/parity, Chromium PDF, PocketSphinx recognition and actual FFmpeg recording/recovery |
| TypeScript/renderer/Electron build | Passed | Final account forms, fragment redemption and resource refresh wiring |
| New onboarding browser journey | Passed | Real viewer/analyst joins, clipboard link handoff, phone/keyboard, minimum password, workspace isolation, ambiguous-name refusal/explicit workspace login, single-use/expiry/revocation, same-cookie downgrade, reset of multiple cookies, owner reset and unchanged-bootstrap restart; zero page errors or overflow |
| Secret retention checks | Passed | Raw passwords/tokens absent from account metadata, audit, database bytes, request URLs and published screenshots |
| Original/full/review-desk journeys | Passed | Persisted demonstration mode retains actual capture/playback/seek, findings/comparisons/graph, alerts, exports/PDF, read-only controls and restart |

Browser QA also found and fixed missing concise role-selector names, one-time
link receipt loss during workspace refresh, and account tables failing to reload
when teammates joined in another browser. The broader membership assertion now
targets the actual membership section because the new account table also names
the operator. It still verifies the same retained member.

No application deployment, email delivery, external LIVE collection, model
request, billing change or separate ALFRED registration occurred. Twelve of
nineteen milestones remain implemented and seven partial; invitations complete
one S01 slice, while payments, public signup and production infrastructure remain.

## Selected C review desk — 11 October 2026

The owner selected the Mission Inbox structure and requested a restrained dark
palette without neon. The implemented desk uses bounded, authenticated workspace
records with exact source replay, draft findings, protection signals and source
schedules. [Actual screenshots](SCREENSHOTS.md), [design QA](../../design-qa.md)
and [the desk receipt](review-desk-validation.json) document this revision.

| Check | Result | Scope |
|---|---|---|
| App regression | 91 passed, 11 files | Original 84 tests plus seven review-desk source/state/bounds regressions. |
| TypeScript and renderer/Electron build | Passed | Final desk and investigation navigation changes included. |
| Dedicated desk browser journey | Passed | Actual support/counter selection and finding revision refresh, decoded playback/seek, exact original context, case A/library/case B/reload/back URL consistency, acknowledgement history and selection-bound receipts, bounded schedules, phone/keyboard, restart and a separate real read-only server. Zero page errors or overflow. |
| Original browser journey | Passed | Actual playback/seek, source/account search, export and restart with the updated palette. |
| Full app browser journey | Passed | Reviewed findings, comparisons/graph, contextual signals, redacted JSON/Markdown/HTML/actual PDF, roles/audit, phone and restart. |
| Affected collector/archive/backend tests | 31 passed | Four new deadline/interruption regressions plus recorder, scheduler, archive and HTTP checks; actual FFmpeg, hashes and restart. |
| Abrupt recording recovery demo | Passed | Three verified segments, restart gap, retained report and authenticated range replay. |

Browser acceptance exposed an existing natural-deadline race: FFmpeg could
finalise media after SIGINT with exit255 or stall until forced termination, which
correctly prevented success. Deadline shutdown now sends FFmpeg's fixed quit
command through a private parent pipe, retaining the existing three-second kill
bound. Completion still requires exit0 and verified current-attempt media.
Deterministic deadline and three actual five-second captures passed; forced
termination and unsolicited interruption remain failures with earlier verified
segments replayable. External LIVE behavior is not established by these fixtures.

The review desk journey is included in the hosted browser workflow. Local passes
do not establish that hosted checks on the new commit have completed. Fixture
recordings remain distinct from real LIVE/provider acceptance. The owner deferred
Pinterest research; no Pinterest pins were inspected or claimed as references.

## Expanded operator application — 11 October 2026

The current continuation follows the first application slice on
`feat/livelens-first-release-2026-10-10`. Fixtures remain distinct from external
provider acceptance. Current product/configuration: [FULL_APPLICATION.md](FULL_APPLICATION.md) and
[RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md). Public image gallery:
[SCREENSHOTS.md](SCREENSHOTS.md). Exact optional-backend/container receipts:
[deployment validation](../../deployment/livelens/VALIDATION.md).

| Check | Result | Executed scope and limits |
|---|---|---|
| Application regression | 84 passed, 10 files | CRM/timeline, Electron archive boundaries and real scoped HTTP uploads preserved. |
| TypeScript and Vite/Electron bundles | Passed | Final renderer/main/preload outputs; existing bundle-size/browser-data warnings remain. |
| Intelligence service, all optional test prerequisites enabled | 102 passed; zero failures/skips | Actual PostgreSQL 17.6, independent PocketSphinx known audio, offline Chromium PDF, FFmpeg concurrent recording, scheduler, model HTTP fixtures, investigations/graph/protection, roles/scopes/case ACL/revocation, encrypted archive/restore, retention and SQLite backup recovery. |
| Evidence demo | Passed | SQLite restart, original clocks/unknown tracks, hash receipts, case export. |
| Recording recovery demo | Passed | Actual colour bars/tone, abrupt service death, restart, honest gaps/partial tails, 3 verified segments, authenticated range replay and retained case report. |
| Source pins | 8/8 verified | Committed Gitlinks and lock agree; research checkouts are not materialised/executed in this environment. |
| Desktop/phone original browser regression | Passed | Actual replay/seek, account search, source context, cases, original JSON/Markdown and restart; zero page errors/phone overflow. |
| Full operator browser journey | Passed; zero page errors | Reviewed findings/counterevidence, bookmarks, literal comparisons, source-scoped anonymous tracks and unverified person references, source-backed relations after restart, missions/alert reviews, redaction/actual PDF, audit, explicit source creation, desktop/phone and keyboard. Final screenshots/receipt are tracked. |
| Encrypted archive UI | Passed | Actual fixture snapshot, local segment removal, explicit UI restore, matching SHA-256, video reopened; desktop/phone, zero page errors/overflow. |
| Native PostgreSQL graph extension | Passed | Anonymous tracks retain job/engine/media scope; operator-declared person reference, original evidence sources and history survive reconnect and remain workspace-isolated. |
| Packaged API/recorder runtime | Passed | Pinned Node image built; real service health200/auth401, actual FFmpeg capture3segments, AES-GCM archive4objects, missing-media410, exact103815-byte restore/replay. Native PostgreSQL/TikTok modules and PDF helper are packaged. Optional web/PDF/speech derived-image recipes are not validated container claims. |
| Real public LIVE | Unrun | No selected usable permitted account/media source supplied. Provider fixtures and generated recording do not establish real collection. |
| Diarisation/semantic quality | Unmeasured | Known-audio CPU receipt is not overlapping-speaker accuracy; model adapter tests use local HTTP fixtures, not an external model. |
| ALFRED registration | Outstanding | Standalone read/control gateway real HTTP policy tests pass; separate ALFRED repository is unchanged. |
| Customer/paid rollout | Outstanding | No payment provider, self-service invitations/recovery, target RLS/queue deployment or representative customer capacity/cost receipt. |
| Native Electron GUI | Unrun | Bundle and actual archive HTTP contract verified; native display/package startup is not. |

Speech receipt: three checksum-pinned excerpts, 15.186 seconds/40 words, 30% word
error rate and 3.895 seconds CPU processing (0.256 processing/audio ratio). No
anonymous track is asserted to be a platform account or real person. The optional
provider drafts are source-validated, model-labelled and atomically saved; review
history and originals remain distinct. Redaction tests cover dependent notes,
findings/editorial history and account provenance while preserving original hashes.

Final review regressions cover overview recording-scope refusal, ACL-aware counts
beyond200cases, malformed job IDs returning400 before lookup/dispatch, and libpq
query overrides/duplicate TLS configuration rejection. Archive admission reserves
unique encrypted objects/manifests plus pending jobs transactionally; shared keys
are counted once per workspace. Uncertain failed writes retain reservations.

Local capacity probe: 10 concurrent callers, 200 requests, 1000 synthetic events,
zero errors, 441.64 requests/second and p95 37.94ms in its documented in-memory
SQLite fixture. This is an API pilot measurement, not representative customer,
recording/speech/analysis concurrency or hundreds-of-users capacity.

No populated keys, signed URLs, media or databases are committed. No merge,
hosted deployment, real unattended monitoring, external model invocation, paid
infrastructure provisioning, billing-account change or ALFRED repository edit
occurred. Reusable install/start instructions are saved in the environment draft;
saving does not publish a snapshot or guarantee a fresh-task restoration.

Hosted CI at implementation/diagnostic commit
`844bc2f3e10bb4c26bd6a55e7b8a3ab245369654` completed successfully:
[push run 38098045790](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38098045790)
and [PR run 38098048357](https://github.com/EmotiveImpact/tiktok-community-manager/actions/runs/38098048357).
Both executed all three jobs: application tests/build, intelligence/source pins
with actual PostgreSQL/speech/FFmpeg recovery, and original/full browser journeys
including real PDF, phone and restart. Uploaded browser receipts are linked from
the runs. This receipt update changes documentation only.

The preceding expanded run at `868b741` passed application/service checks but
failed the original browser journey before precise diagnostics were installed.
Its signed blob logs remain denied by the current managed proxy, so no cause is
asserted. Failure annotations, screenshots, media state and fixture logs are now
retained. Both subsequent fresh browser runs passed without weakening assertions
or changing the browser/codecs. A later documentation-only rerun at `ad01247`
exposed the precise recurring test synchronization failure through those new
annotations: after reopening original context on restart, the test accessed
`video.readyState` before React had mounted the player. The test now explicitly
waits for the video element before the existing media-readiness assertion. No
application behavior, playback assertion or browser/codec selection was changed.
A controlled 1500ms delay of the real post-restart media metadata reproduced the
old null-player exception. Both corrected original/full journeys passed the same
delay, explicitly observing an initially absent video before mount, with all
playback/export/PDF/phone/restart assertions retained and zero page errors.
The first-slice payment/spending blocker is historical; no billing-account change
was made.

## Historical first application release — 10 October 2026

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
