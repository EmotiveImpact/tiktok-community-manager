# LiveLens full application blueprint

Updated 10 October 2026 following the owner's request to expand the basic
community manager into a complete app and eventual server product. This is a
product and design brief. The features below are targets unless explicitly
identified as implemented in the backlog and validation receipt.

## Intended outcome

**A polished conversation intelligence and protection application, backed by a
durable engine that human operators and ALFRED can both use.**

An operator selects sources and a mission, collects conversations, reopens their
media and evidence, investigates events across sessions and produces a reviewed
brief. A protection mission adds selected accounts, detection rules and alert
preferences. Paying customers receive separate workspaces, permissions and usage
limits. ALFRED queries the same evidence and later requests bounded jobs.

The first useful release must feel like an integrated application: coherent
navigation, real persistent data, complete core journeys, clear failures and a
consistent design. Extending the backend alone does not satisfy the app brief.

Build a browser-capable console over the shared service, retaining the existing
Electron app and useful community/CRM capabilities. Start with the existing
React/Vite/TypeScript stack and reusable components. Avoid an unrelated rewrite
that discards working collection, local fan records or existing exports.

## Application map

This is the target navigation. Release each area with working behaviour. Future
areas belong in capability/settings information until their milestone exists;
avoid filling navigation with convincing but non-functional screens.

| Area | Screens and useful actions | Delivery |
|---|---|---|
| Overview / operations | Actual sessions, job state, recent evidence, service health, capture gaps and usage; open the item behind each figure | U00 starts from available data; C03/U01 add worker operations |
| Sources and missions | Configured accounts and sources, accessibility, schedules, limits, start/stop and research/protection objectives | C02/C03/C04; P01 adds protection rules |
| Session library | Search, filters, source/account/date, completeness, retention state, open/replay/export | U00 evidence library; C03/U01 media |
| Conversation | Video/audio beside timed chat, transcript and speaker turns; seek from evidence, search, bookmark and inspect original context | U00 existing evidence; C03/U01 replay; A01 independent speech |
| Observed accounts | Captured comments/statements/appearances across sessions; supporting sources and separate reviewed identity assertions | U00 literal account evidence; I01/I02 richer context |
| Investigations | Case question, evidence, notes, counterevidence, findings, reviewer decisions and correction history | U00 existing case/report API; U01/I01 full review |
| Context graph | Accounts, sessions, topics, claims and supported relationships; select a link to reopen its evidence | I02; no decorative graph claiming real analysis |
| Reports | Case preview, source links, review status, export, later redaction, PDF and evidence bundles | U00 existing JSON/Markdown; R01 richer reporting |
| Alerts / protection | Mission-specific rules, contextual alerts, review, acknowledgement, delivery history | P01 |
| Community / CRM | Preserve useful fan records, gifts, notes, relationship tools and existing creator workflows | Existing app; make access coherent during expansion |
| Settings / workspace | Service/source configuration, capabilities, access, limits, retention and audit; later team roles and billing | U00 private pilot settings; S01 commercial controls |
| ALFRED connection | Connection state and permitted tools, evidence receipts and later bounded job controls | F04 transport exists; G01/G02 registration/control planned |

## Design direction

- A restrained operational interface: dark graphite surfaces, clear contrast,
  refined typography, purposeful spacing and colour for state or emphasis.
- One clear navigation system with a workspace header, contextual search and
  consistent detail views. Give an operator a useful next action on every screen.
- Dense enough for investigation without making every page a wall of cards.
  Prefer readable lists, timelines, split views and tables where appropriate.
- Media and evidence are the focus. Every account, quotation, finding and graph
  edge should lead back to the captured session and relevant time range.
- Use the project's icon/component system consistently, real loading/empty/error
  states, accessible labels, visible focus and keyboard-friendly navigation.
- Verify desktop and phone layouts in a real browser. A static mock-up or screenshot
  is not evidence that the app works. Preserve the existing desktop workflows.
- Keep implementation jargon out of ordinary user flows. Expose provenance,
  capture gaps and uncertainty where those affect the user's judgement.
- Demo fixtures must be labelled. Counts, live status, recordings and working
  controls must reflect actual service state rather than decorative placeholder data.

These are design instructions for the next implementation, not a claim that the
current UI has already been redesigned.

## First complete application release

Deliver U00 with C01, then C02/C03 in the same build programme. U00 is deliberately
earlier than the full media/worker console U01: the persistent API can support
a useful operator app while recorder work proceeds.

1. Add the app shell and real overview, session library, evidence detail, account
   search, case/report and configuration journeys over the existing service.
2. Implement any missing bounded, workspace-bound read routes needed by those
   journeys, such as browsing cases. Keep the existing API/SDK behaviour compatible.
3. Add an explicit authenticated browser transport. The current API refuses
   browser-origin requests; simply rendering a frontend or opening CORS globally
   does not create a working, safe console. Keep broad service credentials on
   the server and use a scoped browser session or equivalent controlled gateway.
4. Add C01's explicit Electron archive action and truthful retry/failure state.
   Never merge events from different broadcasts into one session.
5. Implement C02/C03's durable recording route and connect retained media to
   conversation replay. Prove capture, interruption, recovery and reporting.
6. Document one-command development/reproduction where practical, show actual
   browser evidence and publish a reviewable first app release.

Definition of done: an operator can open the app, browse a retained session,
search a captured statement, reopen context, add evidence to a case, preview an
exportable report and repeat the journey after restarting the service. Recorder
completion adds actual media replay and honest job/capture state. Provider tests
are separately identified; a synthetic recording is not proof of TikTok access.

## Earlier plans folded into this programme

This table consolidates the earlier LiveLens/TikTok plans. It does not absorb
the entire separate ALFRED, Noir, Loc8 or other product roadmaps.

| Earlier requirement | Where it lives now | Current boundary |
|---|---|---|
| Expand the existing community manager and retain useful CRM features | U00/U01, this application map; existing README | Redesign planned; existing CRM retained |
| Record selected lives with available audio/video and chat | C02/C03 | Provider/media route and recorder planned |
| Run collection on a VPS/server without depending on the desktop | C03/C04/S01 | No deployed unattended worker |
| Listen to several lives concurrently | C04 | Existing multi-room event UI is not multi-stream recording |
| Watch selected accounts and start when they go live | C04/P01 | Existing desktop notification poller is not remote auto-recording |
| Follow observed activity/appearances across captured sessions | U01/I01/I02 | Account observations, guest appearances and real-world identity remain distinct; no universal room locator |
| Independent speech-to-text and diarisation | A01 | Existing captions are not independent transcription |
| Reconstruct chat/speech context and review speaker identity | A01/U01/I01 | Anonymous tracks and explicit assertions, with retained originals |
| Search accounts/statements and compare captured sessions | F03/U00/U01/I01 | Literal API search exists; semantic comparisons planned |
| Build reports and evidence packs about observed activity | F03/U00/R01 | JSON/Markdown evidence reports exist; reviewed findings/PDF/redaction planned |
| General intelligence beyond an anti-bullying-only product | PLATFORM.md; I01/I02 | Broader product scope recorded; semantic analysis planned |
| Protect the owner and paying users | P01/S01 | Mission rules, alerting and commercial operation planned |
| Connect ALFRED and make jobs monitorable | F04/G01/G02; C03/U01 | Tested client exists; registered tools and collection controls planned |
| Bring in the eight researched repositories | F01; upstream lock/reuse register | All pinned; research import is not operational adoption |
| Grow towards hundreds of users | S01; capacity plan below | Design target, not measured capacity |

The original `PRD.md` remains retained as the earlier source of requirements.
`PLATFORM.md`, this document and the measured backlog describe the expanded
programme. Do not silently remove prior requirements when implementing a slice.

## Server and growth outcome

The intended commercial product is one shared service with isolated customer
workspaces. Browser clients do not each require their own recorder or speech
server. Separate the interactive application/API from long-running collection,
speech and analysis workers, and scale worker capacity according to jobs.

Production target: authenticated web console and API, PostgreSQL, object storage
for media, durable scheduling/queues and bounded Node/Python worker processes.
Retain the event/source contracts established by the SQLite pilot. Add actual
customer login, roles and case permissions, workspace quotas, metering, billing,
retention/deletion, audit visibility, encryption and backup recovery in S01.

Hundreds of registered users, simultaneous app users, recording streams and
speech jobs are different capacity measurements. Record those separately.
Stream quality, recorded minutes, storage retention and transcription/analysis
work determine much of the workload. Introduce per-workspace limits and usage
visibility before offering unbounded collection.

Release sequence: private operator app -> reliable recording/speech pilot ->
invited customer pilot -> measured paid service -> wider rollout. Before claiming
capacity for hundreds of users, test representative concurrent app traffic and
separate recording/inference loads, queue delays, workspace isolation, recovery,
storage growth and cost. No current benchmark establishes that capacity, and no
hosting supplier or paid infrastructure has been selected or provisioned here.

The best outcome is an application people can use independently, with ALFRED
adding a personal operational interface to the same engine. It has a complete
core journey first, then progressively richer intelligence and server scale.
