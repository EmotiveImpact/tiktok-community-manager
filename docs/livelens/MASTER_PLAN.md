# LiveLens: standing product goal and delivery programme

Status: **active**. Set by the owner on 16 October 2026: give the entire goal and
plan, make it the goal, and work autonomously. This is the current programme;
older first-slice plans are historical. The measured backlog, implementation
receipts and remaining acceptance gates remain authoritative about what works.

## The goal

Build a polished, reliable, capture-first conversation-intelligence application
for the owner, creator/community teams and investigators. A person can select
permitted sources, collect available video/audio/chat, reopen and search the
conversation, gather original evidence, investigate across sessions, review
supporting and conflicting interpretations, and publish a useful reviewed brief.
ALFRED can use the same specialist engine through explicitly granted tools.

LiveLens must be useful independently of ALFRED. ALFRED adds a personal operational
interface; it does not replace the console, source journal or authority checks.
Preserve the useful native Electron community/CRM application while building the
shared browser service. Its current local fan records are not shared web records.

The product progresses from private operator application to invited team pilot,
then a measured commercial service. Hundreds of registered users, concurrent web
users, simultaneous recordings and speech jobs are separate targets to measure.
The goal is dependable usefulness, not a number of navigation destinations.

## The everyday experience

1. **Monitor and collect.** Open on selected accounts, explicit bounded checks and
   watches, Record/Stop and actual capture state. See failures, missing tails and
   the limits applying to the request. Configuration alone starts no monitoring.
2. **Reconstruct and find.** Replay retained media alongside chat, independent
   speech and speaker turns where available. Search across the retained journal,
   reopen precise original context, and save useful moments without losing time,
   source or attribution provenance.
3. **Investigate and compare.** Start with a question; gather relevant originals,
   including contrary evidence. Keep notes, comparisons, relationships and identity
   assertions distinguishable from captured facts. Review proposed findings.
4. **Protect and respond.** Run explicitly scoped missions and contextual rules,
   review resulting signals, acknowledge them and preserve decision history.
   External delivery is a separately configured extension.
5. **Explain and share.** Produce readable briefs with original sources, review
   state, uncertainty, redactions and working exports. Reopen cited evidence.
6. **Operate and recover.** Understand committed capacity, waiting/failed work and
   retention outcomes. Recover retained evidence and playable media after failure.
7. **Use ALFRED.** Search and prepare source-backed work through scoped tools;
   collection requires its own selected-source and duration grant. Captured text
   cannot issue instructions or grant an agent new authority.

## Design and product standards

Aperture Studio is the selected visual language: warm charcoal, off-white actions,
self-hosted Inter, a narrow navigation rail, expansive media, compact conversation
and readable source lists. Carry it through every new workflow. Give priority to
one understandable task and next action, using purposeful rows, tables and split
views. Desktop, phone, keyboard, loading, empty, denied and failure states are part
of delivery. Real recordings and counts must come from actual scoped records.

Keep source, collector and receipt clocks separate. Missing time stays missing;
captions are distinct from independent transcription. Anonymous speaker tracks do
not establish account or real-world identity. Preserve original evidence and
correction/review history. A graph edge or proposed claim must reopen its sources.

## Delivery stages and exit evidence

| Stage | Deliverables | Exit evidence | Current state |
|---|---|---|---|
| 1. Coherent operator application | Capture, retained playback, search, saved moments, reviewed cases/reports, workspace access, useful native CRM preservation | Actual authenticated desktop/phone/keyboard journeys; saved work survives restart; actual screenshots | Implemented and fixture-verified through U02; continue refinement |
| 2. Pilot operations and recovery (O01) | Workspace operational state, reservation-aware capacity, failure attention, durable retention cleanup recovery, mixed-workload and full restore drill | Scoped actual states and denial tests; physical cleanup failure/retry/restart; on-disk concurrent workload measurements; restored reviewed brief and decodable media | **Implemented and locally verified**; [receipt](OPERATIONS.md) |
| 3. Real-source pilot (C05) | Selected permitted TikTok LIVE discovery/capture/chat, bounded retry/stop and retained replay | Actual chosen-source recording plus provider failure receipts, original clocks and verified replay | Needs a selected usable permitted source and provider access |
| 4. Speech and context quality (A02/I03) | Representative licensed reference corpus, noise/overlap/timing evaluation, candidate speech adapters, grounded proposal evaluation | Declared corpus/engine versions, word/turn/latency measurements, unsupported-claim and counterevidence tests; comparative results before adoption | Local evaluation design is unblocked; representative data/model/provider choices remain explicit |
| 5. Private ALFRED operation (G03) | Install scoped tools on the actual private host; source reads and separately granted bounded collection; useful supported interaction | Actual private-host integration, revocation/timeout behavior and end-to-end evidence receipts | Tools and recipe builder fixture-verified; real host/access required |
| 6. Investigation and protection depth (I04/P02/R02) | Better cross-session comparisons, relationship/context review, collaborative review queues, readable report delivery and configured notifications | Fixed reviewed examples, original/counterevidence traceability, human review preserved, realistic browser workflows and delivery receipts | Core workflows implemented; improvements staged by observed usefulness |
| 7. Production foundation and invited pilot (S03) | Deliberate PostgreSQL/queue migration, workspace isolation, durable objects, deployment, observability, recovery/runbooks and measured load | Migration/rollback on a copy, actual restore, isolated concurrent workloads, failure drills, explicitly selected host/budget and pilot acceptance | Pilot bridge/archive exist; target architecture and deployment remain unvalidated |
| 8. Commercial release and expansion (S04/S02) | Tested billing/self-service, metering/cost limits, support/upgrade procedures, release packaging and additional source adapters | Sandbox billing lifecycle/idempotency, approved commercial configuration, cost/capacity envelope, native packaging checks, each new adapter's own access/licence/failure proof | Future; do not mark complete from manual entitlements or fixtures |

Dependencies determine execution, rather than the numbering forcing a wait.
Proceed with unblocked speech/context evaluation and product improvements while
real-source or private-host inputs are unavailable. Production migration follows
measured pilot constraints; commercial release follows production acceptance.

## What already works, and what is still unproven

The current implementation includes bounded concurrent recording and selected
schedules, retained playback and original clocks, full retained-data search,
saved evidence, the Aperture Investigation Desk, reviewed findings/graphs,
protection signals, redacted exports/PDF, invited accounts/roles/case permissions,
quotas/retention/audit, encrypted local backup/media archive, optional PostgreSQL
pilot storage, and separately configured ALFRED HTTP/CLI tools.

O01 has 127 application tests, 165 service tests with optional PostgreSQL/speech/PDF
actually exercised, seven browser journeys and a complete encrypted recovery
drill. The latest [validation receipt](VALIDATION.md) records exact sources and
limits; actual-head hosted results are reported separately on PR #5. These counts
describe this checkpoint, not future work.

Real external LIVE, private-host ALFRED installation, broad speech/overlap and
semantic quality, native GUI packaging, external object recovery, production
migration/queues, payments and representative customer capacity remain gates.
Existing partial milestones C02/A01/I01/S01/S02 stay partial until their own exit
criteria pass. Prior source imports are research references, not adopted apps.

## Delivered foundation: O01 Operations & Recovery

Operator outcome: understand what is waiting or failed, see the same committed
capacity used by admission checks, recover incomplete physical cleanup truthfully,
and prove that retained conversations and reviewed work can be restored.

Implementation order:

1. Add an authenticated workspace operations read model. Aggregate all scoped
   records before bounding displayed attention rows. Show configured and actual
   lifecycle/workload state separately; restricted modules disclose no job data.
   Do not expose paths, signed URLs, credentials, raw failures or other workspaces.
2. Show retained + reserved capacity and remaining allowance in the existing
   workspace area. Explain logical archive usage; this is not free disk space,
   financial billing or proven customer capacity.
3. Persist physical-media cleanup tasks in the same transaction as retention
   deletion. Report partial cleanup; allow explicit bounded, audited retries after
   restart. Resolve only recorded identities under the configured root, refuse
   unsafe paths/new-job conflicts, and retain pending bytes in capacity accounting.
4. Build an isolated file-backed mixed read/write workload with concurrent actual
   generated-media recordings. Record declared concurrency/duration, latency
   percentiles, failures, resource measurements and correctness checks.
5. Stop workers, create an encrypted SQLite/local-media backup, restore into a new
   directory, start a fresh authenticated service, and reopen the same originals,
   notes, findings, reviews, redactions/report, audit and byte-identical decodable
   media. Record measured times and the recovery-point boundary.
6. Verify actual desktop/390px/keyboard UI, scope and workspace denial, quota
   reservations, cleanup failure/retry/restart and existing journeys. Publish code,
   inspected screenshots, commands and sanitized receipts for review.

O01 does not validate external LIVE, install a private host, restore PostgreSQL or
external buckets, or migrate to the target distributed production schema. Those
remain named later acceptance gates rather than hidden assumptions.

O01's defined local pilot scope is implemented and verified in [OPERATIONS.md](OPERATIONS.md).
The next queued unblocked milestone is **A02 speech-quality evaluation**, followed
by I03 grounded-analysis evaluation. Begin with pinned/licensed corpus selection,
explicit noise/overlap/timing cases and reproducible metrics. Do not adopt an
engine or promise accuracy before comparing measured results. If representative
audio/model access is unavailable, finish the local evaluation infrastructure and
continue I03/I04/R02 while recording the unmet quality gate. C05/G03 resume when
the actual permitted source/private host is available. No queued item is claimed
as already running or complete.

## Completion rules for every stage

- Implement the useful end-to-end behavior with durable data and real failures.
- Exercise affected contracts, permission boundaries and recovery paths. Run the
  relevant build and existing regressions; distinguish passed, skipped and unrun.
- Inspect actual browser screens when changing the interface and publish accessible
  screenshot links. Keep fictional fixtures labelled.
- Review the change and correct consequential findings. Preserve pinned research,
  attribution, working behavior and user files; document deliberate migrations.
- Publish reviewable commits/PR updates with receipts, operating instructions,
  remaining limits and an updated backlog. A screenshot alone is not acceptance.
- Mark a stage complete only when its stated exit evidence exists. Do not turn
  measured local results into an unmeasured service-level or customer-scale claim.

The overall programme is complete only when the intended release has passed its
real-source/private-host and operational/commercial gates, with a coherent usable
interface, traceable originals, measured limits and recoverable retained data.

## Autonomous continuation

This is the standing goal for future work in this repository. Read this document,
HANDOFF.md, the backlog and latest receipts; inspect current changes; choose the
highest-priority unblocked item and carry it through implementation, validation,
publication and handoff. Use parallel agents for independent work with clear file
ownership. Routine implementation, reversible fixes and local fixture validation
are authorised by the owner's instruction; do not repeatedly ask to continue.

Keep working on independent items when a prerequisite is unavailable. Record the
exact missing source, host, credential, budget or deployment decision and what it
unblocks. Use existing authenticated configuration; keep secrets outside Git and
chat. Deployment, spending, external messages and destructive changes to user data
need applicable explicit authorisation; publishing code creates none of those.
Merging is not a side effect of a development milestone.

The persistent goal lives in this repository and saved continuation instructions.
That persistence is not an unattended execution service or a claim that work runs
after the active task ends. Each continuation resumes from the recorded queue.

## Source and architecture policy

Build our own coherent service, console, evidence/review contracts and agent API.
Reuse useful recorder/scheduler patterns deliberately; retain pins, licences and
adoption evidence. Evaluate Whisper/diarisation/classification candidates through
measured adapters before adoption. Keep PostgreSQL, object storage and durable
queues as the deliberate production path, with explicit migration and rollback.
See [source reuse decisions](../../research/REUSE_REGISTER.md),
[architecture](PLATFORM.md), [screen map](APP_BLUEPRINT.md),
[measured backlog](../../plans/livelens-backlog.json) and
[standing goal record](../../plans/livelens-goal.json).
