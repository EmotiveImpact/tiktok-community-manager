# LiveLens operator application

LiveLens implements the documented operator journey: select a source, retain a
conversation, reopen its media/context, investigate conflicting evidence, review
findings, run a protection mission and export a reviewed report. The continuation
is on `feat/livelens-first-release-2026-10-10`, draft
[PR #3](https://github.com/EmotiveImpact/tiktok-community-manager/pull/3).

The existing desktop/community/CRM application is preserved. The new React console
uses the shared authenticated service, grouped navigation, global evidence search,
readable session/evidence views and phone layouts. [Screenshots](SCREENSHOTS.md)
show the actual app with labelled fictional evidence and generated media.

## Working application

| Area | Implemented behavior |
|---|---|
| Overview | Persisted sessions, evidence, cases and gaps; recent conversations and actual capture states. |
| Sources/capture | Selected public TikTok accounts or permitted HTTPS media, explicit bounded schedules, two concurrent recorder slots, start/stop, leases, retries, quota admission and capture gaps. Configuring a source alone starts no polling. |
| Replay | Verified segments, continuous playback, evidence seek/context, chat/captions/transcripts, coverage labels, bookmarks and attribution corrections/history. Refresh preserves playback. |
| Media archive | Explicit verified-segment snapshots, encrypted configured storage, manifest/hash readback, durable retries and exact-original restoration. Missing/damaged media refuses replay until restoration verifies it. |
| Accounts | Literal observed/asserted account search and captured cross-session activity with source links. No universal guest locator is claimed. |
| Investigations | Source-linked notes, support/counterevidence, findings, immutable review history, stale-edit refusal and literal cross-session comparisons. |
| Context graph | Observed, operator-reviewed and inferred relationships remain distinct and reopen source evidence. Anonymous tracks retain session/job/engine/media provenance; operator-declared person references remain unverified and separate from account assertions. No automatic identity link is made. |
| Protection | Workspace missions select a protected account, retained sessions (with selected-source references) and contextual literal rules; explicit idempotent runs create in-app signals with surrounding context/gaps and retained reviews. |
| Reports | Editable brief, dependent-text redaction, JSON/Markdown/HTML and actual offline PDF when configured; originals and hash/source/media receipts are preserved. |
| Workspace | Independently enforced scopes/roles/case grants, revocation, usage/reservations/limits, explicit retention preview/apply and hash-chained audit. |
| Agent | Tool manifest and standalone ALFRED gateway with separate source-read, collection dispatch and model-egress policy. Registration and automatic memory acceptance are not claimed. |

## Optional engines and storage

Speech jobs snapshot verified media and write independent transcripts with media
ranges using a trusted configured recognizer. PocketSphinx 5.1.1 was measured on
three checksum-pinned English excerpts: 40 words over 15.186 seconds, 30% word
error rate and 3.895 seconds processing (0.256 processing/audio ratio). These small
samples do not establish live, multilingual or overlapping-speaker accuracy.
Diarisation remains unmeasured. See the [speech receipts](../../services/intelligence/speech/README.md).

An optional OpenAI-compatible provider receives integrity-verified case evidence
with separate `analysis:write` permission. Quotations are untrusted data, tool
calls are refused, exact source IDs are validated and proposal batches save
atomically as model-labelled drafts for review. Tests use an actual local HTTP
fixture; external semantic quality has not been measured.

SQLite is default. The optional pinned native PostgreSQL adapter preserves the
synchronous pilot schema/contracts. Actual PostgreSQL 17.6 checks cover clocks,
hashes, idempotency, restart, access, concurrent recording, scheduling and archive
recovery. This bridge is distinct from the scaffolded production RLS/distributed
queue target. Archive storage supports encrypted filesystem or S3 Signature V4;
signed HTTP fixtures validate protocol/corruption handling, not an external bucket
deployment. Encrypted SQLite backups have actual recovery tests; PostgreSQL
production recovery needs a separate operational receipt. See
[infrastructure](../../deployment/livelens/README.md).

## Reproduce

Use the existing isolated checkout, Node 24+, Python and verified FFmpeg. Keep
runtime data and populated credentials outside Git. From the repository root:

```bash
npm ci --no-audit --no-fund
npm test
npx --no-install tsc --noEmit
npx --no-install vite build
npm --prefix services/intelligence test
npm --prefix services/intelligence run demo
npm --prefix services/intelligence run demo:recording
node scripts/research/verify-upstreams.mjs
npm run console:fixture
```

The fixture binds to loopback. Its public demonstration login is `fixture` /
`fixture-operator-only`; its colour bars, tone and fictional statements are not
real live activity. SQLite, media and a private local archive key persist in the
ignored fixture directory. No external account is watched.

With Playwright 1.62.0 and Chromium installed:

```bash
python3 scripts/validation/browser_smoke.py
python3 scripts/validation/full_app_smoke.py
```

Both journeys use isolated fixture data and stop their servers. They verify media
playback/seek, source reopening, notes/review/counterevidence, graph, alerts,
redacted exports/PDF, desktop/phone/keyboard and restart. Optional PostgreSQL,
recognizer and PDF tests report skips unless configured; the executed receipt is
in [VALIDATION.md](VALIDATION.md). Skips are not passes.

Use [RUNTIME_CONFIGURATION.md](RUNTIME_CONFIGURATION.md) and the
[service API reference](../../services/intelligence/README.md) for private runtime
configuration. Console cookies are scoped and same-origin with CSRF protection;
broad keys, signing credentials, object keys and model secrets stay on the server.

## Remaining acceptance gates

- Real selected permitted TikTok LIVE discovery/recording remains unvalidated;
  no usable source was supplied. Generated recording and provider fixtures are
  separate receipts.
- A01 remains partial for diarisation/overlap and representative audio quality.
  I01 remains partial for external semantic quality; reviewed findings and literal
  comparisons work.
- G01/G02 gateway code is tested, but separate ALFRED registration is outstanding.
  That repository has not been changed.
- S01 remains partial for customer invitations/self-service account recovery,
  payments, target RLS/queue rollout, external objects, representative load/cost
  budgets and production disaster recovery. Manual limits are entitlements, not
  charges. Local API timings and two recording slots do not prove hundreds of users.
- S02 includes direct permitted media, but a second named platform is unvalidated.
  External alert delivery is not configured.
- Native Electron GUI/package execution is unverified in this container; bundles
  and actual archive HTTP contracts are tested separately.

Redaction preserves originals and conservatively masks dependent notes, findings,
editorial history and matching account provenance. Remaining identifiers,
paraphrases and media require review before sharing. Local hash chains are not
externally notarised proof. The branch is for review; no merge, hosted deployment,
unattended live monitoring or billing-account change was performed.
