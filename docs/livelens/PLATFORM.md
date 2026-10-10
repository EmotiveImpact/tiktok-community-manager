# LiveLens: live conversation intelligence

Product direction, 10 October 2026. The goal is an operational intelligence
platform that can serve the owner, paying users, creator teams, investigators and
ALFRED. TikTok is the first source adapter. The community manager is an existing
collection and interface asset within the wider product.

The latest requirement is a complete application and a substantial design
overhaul, with eventual server operation for hundreds of users as a measured
target. Read [APP_BLUEPRINT.md](APP_BLUEPRINT.md) for the full navigation/screen
map, design direction, earlier-plan consolidation and commercial growth gates.
U00 introduces a real operator app over the existing API alongside C01; U01
later completes media replay and worker operations. Backend-only progress does
not satisfy the full app brief.

## The product question

With the existing application and all eight source repositories available, what
should we build that none of them supplies together?

**A continuous conversation-to-evidence-to-action system.** Collect available
media and events, reconstruct conversations, investigate what matters, preserve
supporting and conflicting evidence, and make the same capabilities available to
human operators and authorised agent tools.

Protecting a person or community is one mission. Others include public debate
research, creator intelligence, documenting disputes, topic monitoring and
cross-session analysis. Reports describe observed activity and source-supported
claims. They do not assign a universal judgement about a person.

## Platform areas

| Area | Product behaviour | Current status |
|---|---|---|
| Operations | Active sources, worker health, capture gaps, backlog, storage and spend | Existing desktop event monitoring; server console planned |
| Collection | Selected accounts, LIVE status, scheduled collection and concurrent capture | Existing desktop connector; server workers planned |
| Conversation | Replay synchronised media, chat, captions, independent speech and speaker turns | Desktop chat/caption timeline implemented; independent speech planned |
| Observed accounts | Search statements and comments associated with captured accounts across sessions | Backend account-filtered evidence search implemented; account activity UI planned |
| Context graph | Claims, topics, appearances and source-supported links with relationship status | Planned; no inferred identity graph exists |
| Investigations | Questions, evidence, counterevidence, notes, reviewer decisions and timelines | Durable case/evidence links implemented; full analyst workspace planned |
| Reporting | Evidence exports, reviewed findings, redaction and shareable briefs | Backend JSON/Markdown evidence reports implemented; AI findings/PDF/redaction planned |
| Protection missions | Named protected account, selected sources, detection rules and reviewed alerts | Planned |
| Agent gateway | Scoped queries and later bounded collection/report jobs from ALFRED | HTTP API and read-only clients implemented; ALFRED registration planned |
| Commercial operation | Workspaces, access controls, quotas, subscription metering and retention | Pilot workspace isolation implemented; full commercial controls planned |

## Shared architecture

```mermaid
flowchart TD
    Sources["Livestream source adapters"] --> Workers["Capture and speech workers"]
    Workers --> Core["Evidence and investigation service"]
    Core --> Analysis["Context and review workers"]
    Analysis --> Core
    Console["Operator console"] <--> Core
    Alfred["ALFRED tool gateway"] <--> Core
    Core --> Media["Media and report storage"]
```

The interfaces share one source-linked data model. Media remains separate from
the event journal. Speech engines emit anonymous tracks; an account mapping is
its own assertion. Analysis results retain evidence IDs and their review status.
Captured text is data supplied to analysis, never an instruction that can grant
an agent new authority.

Production target: React/TypeScript console; long-running Node/Python workers;
PostgreSQL for indexed entities; object storage for segmented media; durable
queues and bounded schedulers. The new SQLite service proves the event/case/API
contract before that migration. It is not a capacity benchmark for the target.

## Connection with ALFRED

ALFRED is the personal operational interface and coordinator. LiveLens is a
specialist source and conversation engine. Keep those responsibilities distinct
while giving ALFRED the same scoped tools used by the operator console.

Examples of the intended interaction:

- "Show what was actually said about this subject in our captured sessions."
- "Prepare a brief with the quotations, context and unresolved identities."
- "Compare this account's observed statements across these sessions."
- "Create a collection job for these sources with a two-hour cap."
- "Tell me when a reviewed rule is triggered in this protection mission."

The first two query capabilities can use the current client once its service is
configured. Collection jobs, semantic comparisons, alerts and memory import are
future work. ALFRED's inspected `alfred/connectors.py` at
`75947b8dd59a3161c862d2533850a032994778e2` only registers local ICS/VCF exports.
The included client is not installed or silently registered in that repository.
Read `ALFRED_INTEGRATION.md` for the concrete integration sequence.

## Build sequence and release gates

1. **Persistent intelligence foundation:** pinned source library, event contract,
   durable evidence, account search, case exports and scoped clients. Implemented
   in this draft and tested with synthetic fixtures.
2. **A complete recorded session:** one accessible media source plus chat; durable
   recording job, source/receipt clocks, segment hashes and crash recovery. Start
   with the recorder patterns from the imported Node and Python projects.
3. **Independent conversation processing:** speech worker, anonymous diarisation,
   uncertainty and synchronised replay. Benchmark on reference recordings before
   making username attribution claims.
4. **Server operations and two concurrent sessions:** LIVE-status scheduler,
   idempotent start/stop, leases, bounded retries, recording gaps and quotas.
5. **Investigation console:** session library, account activity, evidence viewer,
   speaker correction, case notes and a report editor over the same API.
6. **Context intelligence:** source-linked claims, topics, possible incident flags,
   counterevidence and human review. Search results and AI findings remain distinct.
7. **ALFRED operation:** register the read interface, then add separate collection
   controls and explicit memory-source ingestion through ALFRED's policy layer.
8. **Paid pilot:** case permissions, metering, retention/deletion, storage recovery,
   notifications, billing and measured service limits before customer deployment.

The next useful vertical slice is one replayable recorded conversation that
survives a worker restart and produces a report whose evidence can be reopened.
That gives the larger console and ALFRED reliable material to work with.

Begin the operator app U00 alongside C01 rather than delaying every interface
improvement until the entire recording/speech stack exists. Keep its available
features grounded in real service data; complete C02/C03 for recording, then
expand the same app through A01/C04/U01 and the later intelligence milestones.
