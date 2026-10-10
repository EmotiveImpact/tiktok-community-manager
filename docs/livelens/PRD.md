# LiveLens: product requirements and architecture

Status: Product direction v0.1 / implementation slice in draft branch
Date: 10 October 2026
Working name: LiveLens

## Vision

A source-linked livestream intelligence system. Observe selected public or otherwise
authorised livestreams, collect available speech and chat evidence, understand
what was said and when, investigate claims and conversations, and export verifiable
reports. This is a general-purpose monitoring, research and evidence product.
Anti-bullying, harassment investigations and community safety are important use
cases, not the entire product.

Core verbs: **Observe > Record > Understand > Investigate > Report.**

The product should not pre-label a creator as an abuser or automatically declare
a finding of misconduct. It should show the source material and the reasoning.

## Product surfaces

1. **Operations console**: connected sessions, configured public LIVE channels,
   connection health, worker activity, retention volume, recording controls.
2. **Live room**: video/audio when available, time-synchronised chat and speech,
   speaker track, searchable transcripts, bookmarks, highlights and notes.
3. **Session library**: recordings, source URLs, timelines, transcript completeness,
   source clock calibration, comments and chat replay.
4. **Identity and speaker review**: diarisation speaker IDs, visual cues,
   verified or operator-assigned usernames, confidence and source of attribution;
   unresolved identities remain unknown.
5. **Context graph**: topics, claims, questions, quotations, preceding chat,
   contradictions and possible responses. Temporal adjacency alone is not proof
   of a response or affiliation.
6. **Case workspace**: group verified public session evidence, notes, findings,
   corrections and counterevidence into reviewable cases.
7. **Reports**: source-linked timeline, incident brief, topic digest, session
   executive summary, comparisons and export bundles (JSON, Markdown, PDF later).
8. **Automation**: scheduled monitoring of configured public LIVE accounts,
   automatic start on verified live-status transition, safe reconnect, stop on
   verified end, optional notifications and usage caps.

## Account and people model

A username is an account identifier, not proof of a real-world identity.
Keep separate objects for creator account, broadcast room, chat participant,
audio speaker, screen/guest panel and an optional operator-reviewed mapping.
An individual may use multiple accounts, and multiple speakers may be heard in
a single room. Linking them requires supported evidence.

Do not imply a comprehensive room-to-room location history: guest appearances,
chat messages and active viewer presence are not equivalent, and detection gaps
must remain visible.

## Collection pipeline

- Connector adapter accepts permitted provider events (existing Electron
  TikTok adapter currently supports chat and caption events).
- Record BOTH provider timestamp and receipt timestamp, plus monotonic
  capture clock where available, session ID, room ID and deduplication key.
- Video/audio ingest is a separate adapter; media must not be conflated with
  the chat event socket. Recording requires a usable source and rights.
- STT/diarisation adapter supplies bounded transcript segments, per-speaker
  anonymous IDs, timing and confidence. Real-time guest username matching
  is a later verified mapping layer, not a by-product of diarisation.
- Synchronisation stage aligns independent sources while preserving originals.
- Evidence journal writes append-only events; idempotent ingestion and crash
  recovery to be introduced for unattended VPS workers.
- Analysis workers create *suggested* topics and incident flags, always linking
  findings to evidence IDs. Findings cannot rewrite original events.
- Reporting stage exports provenance plus unknown/unconfirmed intervals.

## Data shapes (target architecture)

Workspace -> MonitoringRule -> StreamSession -> SourceEvent -> MediaSegment
                                                -> TranscriptSegment
                                                -> ChatMessage
                                                -> SpeakerTrack
                                                -> IdentityAssertion
                                                -> Finding -> Case -> Export

IdentityAssertion:
- asserted account
- audio speaker track / evidence segment(s)
- method (platform, operator, visual, enrolled voice)
- confidence, reviewer, change history

Finding:
- category (topic, question, claim, abuse concern, factual dispute, other)
- evidence event IDs and counterevidence
- reviewer status (proposed, reviewed, dismissed, uncertain)
- explanation and provenance, never a person "guilt" score

## VPS system shape

Web dashboard (React / Vite)
    -> control API (authenticated)
    -> job queue + scheduler
    -> bounded isolated connector/recording workers
    -> timestamp normaliser + event journal
    -> cloud STT/diarisation or local inference
    -> analysis workers
    -> database and object storage
    -> report/export service

Run workers on a long-lived Linux host, not an ephemeral frontend function.
Use Postgres for indexed entities, object storage for audio/video, and a durable
queue for retries. Scale horizontally by stream, with concurrency quotas and
per-session cost metering.

For each configured account, distinguish scheduled poll -> live discovered ->
source accessible -> capture started -> active -> ended -> finalised. Do not
claim recording started until media has been durably written and verified.

## What can be reused from tiktok-community-manager

Verified in repository source at 10 October 2026:
- Electron + React/Vite app and multi-room event display
- TikTok LIVE event session connector, including chat and optional captions
- go-live poller, currently 5-minute polls and notifications
- local session event storage, export utilities and summary logic
- video stream player / clip buffer when a usable HLS source is available

**Important limitations of that existing foundation:**
- The current transcript is TikTok captions, only when enabled by host;
  there is no independent speech-to-text/diarisation engine.
- The existing multi-room pane is event monitoring, not independent full
  recording + transcription + report generation for every room.
- The go-live poller sends notifications; it does not create remote VPS
  recording jobs.
- The existing local session store is a desktop session implementation and
  is not a multi-tenant server-side evidence journal.
- Unofficial LIVE access can fail on changed signing or expired stream URLs.

## Current branch slice (0.1)

- A new LiveLens panel in Live Tools, deep-linkable via
  ?page=live&tool=livelens
- Merges existing chat + final caption event types into sorted evidence rows
- Keeps both original and caption-latency-adjusted timestamps
- Per-caption **manual** username assertion, visibly labelled as manual
- Nearby preceding chat inspector explicitly labelled "temporal only"
- Search and source/channel filters
- Source-linked Markdown and JSON report exports
- Unit tests for ordering, deduplication, unattributed speech, manual identity,
  time offsets, temporal proximity and report provenance

This initial slice does NOT perform independent audio transcription, automatic
guest mapping, unattended VPS collection, media recording or permanent case
storage. Current-view manual mapping is intentionally ephemeral. Its purpose
is to prove the shared data model and in-app evidence UX safely on the existing
event feed. The code changes do not alter existing TikTok capture semantics.

## Acceptance gates

### Slice 0.1
- Live tool opens without breaking the existing CRM.
- Chat identities come only from chat-source account fields.
- No host/guest assumed for an unattributed caption.
- Source timestamps retained through alignment.
- Reports clearly label manual assertions and gaps.
- Search/filter/export run on connected data and show empty states correctly.
- Type-check, build and focused unit tests pass on the branch.

### Multi-stream server milestone
- At least two separate configured LIVE rooms handled concurrently with
  distinct IDs and event clocks.
- Reconnect and duplicate events are idempotent.
- Auto-capture only reports success when durable media exists.
- Jobs end deterministically and do not continue indefinitely.
- No mixing of identities or events between separate sessions.
- At least one session can be replayed with synchronised chat and speech.

### Reporting milestone
- Every factual report assertion links to captured evidence.
- Unknown speaker identity stays unknown unless supported.
- Analysts can correct transcript and attribution without replacing originals.
- A reviewer can recreate exports from immutable source records.

## Positioning and customers

Creator and community teams; professional moderators; livestream researchers;
journalists; evidence reviewers; trust-and-safety operations. Expand to other
streaming platforms through source adapters rather than platform-specific
business logic.

## Future decisions

- Product name and branding
- Independent repository vs extracting a reusable shared library
- TikTok source-access strategy and reliability
- Audio STT vendor vs own GPU inference
- Background recording quality, caps and storage retention
- Stronger case-review roles and export authenticity
- Deployment target and production security requirements
