# LiveLens intelligence platform
Decision proposal, 2026-10-10. Independent product, not a CRM rebrand.

## Vision

Observe > Record > Understand > Investigate > Report.

LiveLens is a conversation and evidence intelligence platform initially
supporting TikTok LIVE. It can be useful for creator support, public statement
research, online abuse cases, disputed conversations, journalistic fact finding,
community moderation, live events and source-backed reporting.

**Account, stream, screen guest and speaker are different entities.**
Platform chat identifies a posting account; diarisation only produces speaker
A/B/C; matching a speaker to a displayed username needs supporting visual,
platform or operator-confirmed evidence. A username is not proof of a
real-world identity. Captured public appearances are not a complete account's
room-to-room history.

## Architectural layers

1. **Sources:** TikTok adapter first, additional platforms later. Each emits
   versioned immutable raw events (chat, captions, status, metadata, recording
   availability), not analysis.
2. **Orchestration:** queue and bounded scheduler handle configured public
   / authorised streams, live detection, retries, idempotency, quotas,
   cancellation and stop/finalise semantics.
3. **Media workers:** independent long-lived capture worker per room when
   an authorised audio/video source exists. Record segments, duration,
   source gaps, digest and media offset. Never say "recording" before durable
   bytes and a verified stream.
4. **Speech:** independent ASR, speaker diarisation and optional translation.
   WhisperLiveKit is the first candidate; pyannote is an accuracy comparator.
5. **Timeline:** align chat + audio + captions while retaining BOTH source
   event timestamp and local receipt clock. Never silently convert
   time adjacency into proof that someone replied to a comment.
6. **Evidence engine:** append-only evidence journal, stable provenance IDs,
   derived findings as separate records, replay capability, annotations,
   corrections, search and source-linked reports.
7. **Console:** multi-room Command, Live, Library, Evidence, Reports,
   Investigations, Automations, Settings and operational-cost tracking.
8. **ALFRED adapter:** independent, read-only-first specialist source.
   ALFRED may read permitted statuses, alerts, reports and their references.
   ALFRED is not granted write or monitor authority by model output alone.

## Data identity and provenance

Workspace > CollectionRule > StreamSession > RawSourceEvent
  > ChatMessage / MediaSegment / TranscriptSegment / SpeakerTrack
  > VerifiedIdentityAssertion / EvidenceFinding > Case > ReportExport

Minimum event envelope:
- version; provider; room_id; session_id; unique source_event_id; event_type
- original_source_ts; receipt_ts; media_offset_ms if known
- raw_payload_ref; source_url; media_digest when applicable
- capture_health; collection_gap; provenance_basis
- immutable original plus separately versioned correction/analysis records

An AI interpretation has \`basis=derived\`, source evidence references,
and a clear confidence/uncertainty note. It does NOT overwrite the observed
data, assert criminality or create identity facts on its own.

## Deployment

Start with a long-running Linux VPS for scheduler/API and isolated stream
workers; Postgres for metadata, object storage for media; an optional
separate CPU/GPU speech worker or hosted transcription API. Vercel can serve
the frontend but should not be the long-lived capture process.

Make recording opt-in/configured per source; do not attempt private room
bypasses, covert across-platform tracking, or invisible profile dossiers.
Apply data minimisation, access permissions, retention and audit hooks at
the core-data layer so the eventual product can be operated responsibly.

## ALFRED integration

ALFRED's existing \`alfred/capabilities.py\` contract on
EmotiveImpact/Alfred defines independent products, read-only capabilities,
stable observation IDs, observed_at original time, reported/derived bases,
bounded freshness and referenceable evidence. The candidate manifest at
\`integrations/alfred/manifest.v1.json\` matches its shape. A real
adapter, credential, endpoint and tests are **not yet built**.
ALFRED remains the supervisor, LiveLens the owner of original media and
conversation intelligence.

## Target release gates

**R0 source library**: all upstream SHA pins checked; no executable source
adopted; licence matrix + architecture + ALFRED contract.

**R1 useful capture**: two permitted LIVE channels isolated, one long-running
capture worker each; chat and durable media with reconnect/gap recovery;
health and storage visible, deterministic replay from a stored session.

**R2 speech**: independent audio transcription even when TikTok captions
are off, speaker A/B/C with confidence and reviewable manual username
mapping; stable audio/chat/video alignment.

**R3 intelligence**: topical questions, contradictions, notable claims,
contextual chat association, uncertainty, source-backed quotations,
reviewer notes and reproducible reports.

**R4 enterprise**: multi-user roles/workspaces, verified archive exports,
data isolation, cost caps, billing, provider contracts, ALFRED read adapter
and auditable, approval-gated commands.

No source integration, live recording, speech inference, deployment or
ALFRED data sharing is claimed by R0.
