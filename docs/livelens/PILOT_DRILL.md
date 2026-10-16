# Pilot workload and complete recovery drill

`deployment/livelens/pilot-drill.mjs` measures a bounded, fictional operator
workload while two distinct synthetic audio/video sources are actually recorded.
It then stops the service, creates an encrypted SQLite/media backup, restores
into a new directory and reopens the complete investigation through a fresh
authenticated API process. It neither uses an existing database nor contacts a
provider, bucket, model, browser session or private account.

This is an operational fixture receipt. It does not establish production
capacity, hundreds of users, external LIVE access, speech quality, crash recovery
point, PostgreSQL recovery, a remote storage deployment or paid operating cost.

## Recorded local result — 16 October 2026

The [complete receipt](pilot-drill-validation.json) records a passing default
run against unchanged source hashes:

| Measurement | Result |
|---|---|
| Mixed requests / unexpected failures | 600 / 0 |
| Measured peak requests in flight | 6 |
| Request latency p50 / p95 / p99 | 11.871 / 30.956 / 58.390 ms |
| Actual concurrent captures | 2, overlapping for 11.903 sampled seconds |
| Preserved original events | 2,240, including 240 acknowledged workload writes |
| Recovered media | 16 segments, 630,730 bytes; all hashes matched and both tracks decoded |
| Decoded media across both sources | 32 seconds and 320 video frames |
| Backup / restore / reopen and verify | 164.447 / 113.159 / 2,054.230 ms |
| Access/isolation assertions | 7 before recovery and the same 7 after recovery |

The original fixture database, media and generated inputs were removed before
restore. The fresh service reopened only the recovered directory. Temporary
processes and artifacts were removed after acceptance. These are local fixture
measurements under a paced workload, not service guarantees.

## Run

Requires Node 24+, Python 3 and an installed FFmpeg with H.264/AAC encoding. Run
from the repository root:

```bash
node deployment/livelens/pilot-drill.mjs \
  --output /tmp/livelens-pilot-drill.json
```

The output destination is required and must not already exist. The command emits
a short result to stdout and a sanitized JSON receipt to that destination. A
failed assertion sets a nonzero exit status and records a bounded failure code;
raw server exceptions, tokens, private paths and media are omitted. Review the
receipt before copying it into the repository. A receipt from a failed run must
not be described as a pass.

The default uses file-backed SQLite in WAL mode with `synchronous=FULL`, two
fictional workspaces, six independently scoped principals, 2,000 original events
and 600 requests over a scheduled 12-second workload. Three principals perform
the workload: collector, investigator and reader. Other principals verify
owner-only operations, missing scopes and workspace isolation.

Six clients send concurrent request waves. The nominal request mix is:

- Append two new original events.
- Search captured text with a bounded page.
- List retained sessions.
- Reopen the reviewed investigation.
- Read actual recording receipts.

Each operation receives one fifth of requests, subject to rounding if the
request count is not divisible by five. The receipt records actual counts per
operation and actual peak requests in flight. Clients do not retry failures.
Each request has a five-second timeout; the workload has an additional
30-second wall-clock allowance. This is a paced workload, not a search for the
server's saturation point.

The service runs in a separate child process on an OS-selected loopback port.
Two configured file sources contain different generated bars and tones. Each
capture has a 16-second cap by default and writes real two-second segments. The
drill requires both captures to overlap for more than one sampled second,
complete with retained segments, remain bound to their own sessions, and produce
distinct segment hashes. No watch schedule is created.

Optional bounds are explicit:

```bash
node deployment/livelens/pilot-drill.mjs \
  --output /tmp/livelens-pilot-drill-larger.json \
  --duration 30 --concurrency 12 --requests 1800 --events 10000 \
  --ffmpeg /usr/bin/ffmpeg
```

Duration accepts 8–120 seconds, concurrency 1–32 clients, requests 20–20,000,
and seed events 200–20,000. Request count must be at least twice the client
count. `LIVELENS_FFMPEG_PATH` can select FFmpeg when `--ffmpeg` is omitted. The
recording cap is the selected duration plus four seconds. These options only
scale an isolated local fixture; they never select a live source or remote host.

## What the receipt measures

`load` includes completed request count, unexpected failures, successful writes,
elapsed time, requests/second, actual peak requests in flight and p50/p95/p99/max
latency for all requests and each operation. Expected 401/403/404 access checks
run outside this measured workload and are recorded separately.

`load.server` samples the service process every 100 ms: RSS, heap, pending jobs,
active captures and time with both capture processes active. Event-loop delay
uses Node's 20 ms histogram resolution; its percentile values include that
sampling interval. CPU usage and memory exclude the load generator and FFmpeg
child processes, so they are not total-host resource budgets. Disk sampling
runs every second and records database, WAL and retained-media bytes. Short
peaks between samples can be missed. The reported CPU count and memory are
visible host values, not an assertion about container resource entitlements.

`sourceSha256`, FFmpeg executable/version and both generated-source hashes pin
the material used by the run. Timings vary with the machine and other work.
Keep different runs as separate receipts rather than combining their best
numbers. The drill checks the recorded source hashes again at completion and
fails if the source changed during the run. Final release verification therefore
requires frozen source files.

## Recovery acceptance

Before backup, the fixture contains a restricted investigation with supporting
and conflicting original evidence, an analyst note, bookmark, an independently
reviewed finding with revision history, an edited brief, a redacted share copy,
explicit case access and a hash-chained workspace audit. Both recording jobs
must be terminal before the service stops and the existing backup helper runs.

The existing AES-256-GCM backup creates a consistent SQLite snapshot and verifies
the original local media. It refuses unresolved retention cleanup before
snapshotting and in the copied snapshot; finish that cleanup before creating a
backup. Packing includes the media-root files, so clearing only the database's
media references would not be sufficient. This drill creates no pending
retention cleanup. After creating the archive, the drill removes only its own
unique temporary original database, media and generated input files. Restore
authenticates and checks the archive before extracting into a previously
nonexistent directory. A new service process without configured capture sources
then reopens that restored database and media root.

The drill compares hashes of all of these pre-backup and restored results:

- Every paginated original event, including acknowledged workload writes.
- The complete investigation detail, notes, findings and review history.
- Report editor revisions and configured redactions.
- The exported reviewed/redacted content and source manifest.
- Saved bookmarks, explicit case grants and audit entries.
- Verified session chains, verified audit chain and complete recording receipts.

Fresh exports have a new generation timestamp. Each export's full report digest
is independently verified; comparisons exclude only `generatedAtMs`, that
digest, and `manifest.originalReportSha256`, which also includes an export
timestamp. Every persisted report field, original evidence hash and retained
media receipt still participates in the comparison.

Every restored segment is downloaded through authenticated HTTP, compared to
the original byte count and SHA-256, and decoded through FFmpeg with both video
and audio selected. Positive decoded frame and duration values are required and
recorded. This proves restored playable content, beyond restoring arbitrary
files with a media extension.

Anonymous access, another workspace's case/recording/search, missing read/write
scopes and a reader without access to the restricted case are checked both
before and after recovery. The case creator and explicitly granted investigator
retain their authorized access.

`recovery` records backup, restore and fresh-service verification duration,
compared-category hashes, verified media and the explicit recovery-point
boundary. That boundary is all acknowledged fixture writes and terminal
recordings before a quiesced backup. It does not claim the amount of in-flight
data lost during a crash or a production disaster-recovery SLA. Original response
hashes remain in the harness memory for comparison; the original files have
already been removed, so the fresh API must read the restored directory.

## Cleanup and limits

Fixture databases, generated inputs, retained media, encrypted archive and
decoded copies remain in a unique system temporary directory and are removed
after the run. Fixture API credentials and the random backup key exist only in
process memory/IPC; they are not written to the receipt or command line. Child
services stop before cleanup. Nothing remains running to monitor an account.

This drill complements the individual lease, interruption, corruption and
denied-write tests. It does not replace those tests or production-specific
PostgreSQL/object-storage backup tooling. Browser-user concurrency, inference,
long-duration soak, distributed queue behaviour, host disk exhaustion, external
object restoration, provider reliability and billed cost still need separately
declared workloads on the intended infrastructure.
