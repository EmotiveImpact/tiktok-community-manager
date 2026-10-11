# LiveLens operator application

LiveLens implements the documented operator journey: select a source, retain a
conversation, reopen its media/context, investigate conflicting evidence, review
findings, run a protection mission and export a reviewed report. The operator app and research/foundation PRs #1–#3 are merged into `redesign`.
Optional [invited workspace accounts](WORKSPACE_ONBOARDING.md) are implemented.
The current continuation prioritises a capture-first LIVE monitor.

The existing native Electron community/CRM application is preserved. Its browser
`?page=` bridge is a development demonstration, not a shared-server CRM; fan
records remain in the desktop's existing local storage. The new React console
uses the shared authenticated service, grouped navigation, global evidence search,
readable session/evidence views and phone layouts. [Screenshots](SCREENSHOTS.md)
show the actual app with labelled fictional evidence and generated media.

## Current product direction

The owner rejected the review-first home as the default experience. Collection
now leads: selected `@account` sources, bounded checks/watch schedules, explicit
Record/Stop, a large retained-recording preview with captured chat, and recent
recordings. Review and investigation remain available after capture. See
[LIVE_MONITOR.md](LIVE_MONITOR.md) for the exact operating guide and pinned
recorder/monitor design references.

Earlier application and browser receipts prove the named operations, replay,
restart and permission checks. They do not prove visual acceptance or a finished
design. Generated media and provider fixtures still do not establish a real
external LIVE. A retained recording preview is distinct from direct live-video
streaming; the latter is not claimed here. ALFRED registration is not inferred
from the standalone gateway and needs its own actual application receipt.

## Working application

| Area | Implemented behavior |
|---|---|
| Live monitor | Default selected-account/source watchlist; explicit bounded Check/Watch and Record/Stop; availability at last check; delayed verified recording preview with captured chat, active-job controls and recent recordings. |
| Review desk | Secondary retained-evidence, pending-signal and draft-finding inbox with exact support/counterevidence context, scoped acknowledgement and source replay. |
| Sources/capture | Selected public TikTok accounts or permitted HTTPS media, explicit bounded schedules, two concurrent recorder slots, start/stop, leases, retries, quota admission and capture gaps. Configuring a source alone starts no polling. |
| Replay | Verified segments, continuous playback, evidence seek/context, chat/captions/transcripts, coverage labels, bookmarks and attribution corrections/history. Refresh preserves playback. |
| Media archive | Explicit verified-segment snapshots, encrypted configured storage, manifest/hash readback, durable retries and exact-original restoration. Missing/damaged media refuses replay until restoration verifies it. |
| Accounts | Literal observed/asserted account search and captured cross-session activity with source links. No universal guest locator is claimed. |
| Investigations | Source-linked notes, support/counterevidence, findings, immutable review history, stale-edit refusal and literal cross-session comparisons. |
| Context graph | Observed, operator-reviewed and inferred relationships remain distinct and reopen source evidence. Anonymous tracks retain session/job/engine/media provenance; operator-declared person references remain unverified and separate from account assertions. No automatic identity link is made. |
| Protection | Workspace missions select a protected account, retained sessions (with selected-source references) and contextual literal rules; explicit idempotent runs create in-app signals with surrounding context/gaps and retained reviews. |
| Reports | Editable brief, dependent-text redaction, JSON/Markdown/HTML and actual offline PDF when configured; originals and hash/source/media receipts are preserved. |
| Workspace | Optional persisted accounts, expiring single-use invitations, password reset/revocation; independently enforced scopes/roles/case grants, revocation, usage/reservations/limits, explicit retention preview/apply and hash-chained audit. |
| Agent | Standalone gateway plus actual optional ALFRED authenticated tools/CLI in draft PR #20; separately granted reads, exact approved bounded collection and independent model-egress policy. Fixture integration is tested; production installation and automatic memory acceptance are not claimed. |

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
- G01/G02 optional actual ALFRED tools are implemented/tested in
  [draft PR #20](https://github.com/EmotiveImpact/Alfred/pull/20), commit
  `5b37ba41353cfcd0cae4243482520e25175e21d9`. The branch is unmerged/undeployed;
  [the integration guide](ALFRED_INTEGRATION.md) records configured fixture proof,
  private installation and current hosted-CI limits. No user's host is connected
  by publishing code.
- S01 remains partial for public self-service signup,
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
