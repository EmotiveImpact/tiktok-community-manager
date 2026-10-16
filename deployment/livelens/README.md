# Infrastructure and recovery

The default service uses SQLite and local recorder files. An optional native
PostgreSQL bridge and encrypted media archive are implemented and tested. These
modules do not claim the target PostgreSQL/RLS migration, a deployed paid service,
billing-provider connection, or a customer-capacity guarantee.
The service container packages the actual API/recorder/native database runtime;
see [CONTAINERS.md](CONTAINERS.md) for build, private configuration and explicit
optional frontend/PDF/speech mounts or derived-image recipes.
The actual local service/native-database/container results and their limits are
recorded in [VALIDATION.md](VALIDATION.md).

The optional service governance layer persists workspace members/roles, private
case grants, limits, actual retained-media/speech usage, retention previews and
local hash-chained audit receipts. Configure `LIVELENS_WORKSPACE_MEMBERS` as
`[{"workspace":"your_workspace","subject":"your_operator","role":"owner"}]`.
Member changes affect the next request. Role authority and API scopes are checked
independently. Re-seeding configuration does not undo persisted revocations.
Manual entitlements set usage limits; they are not financial charges.

Retention is disabled until configured. Setting days creates no automatic
deletion. Preview, select up to 100 eligible sessions, then apply the exact
preview hash with a reason. Investigations, bookmarks, relationship/mission/alert
references and pending workers protect retained evidence. Changed previews refuse
application. Deleted-session receipts and audit remain. Per-recording physical
cleanup tasks commit before filesystem work and survive restart. Failed removal
retains its known-byte storage reservation. In Workspace → Retention, inspect the
task, correct the underlying filesystem problem and retry that task with a reason.
Retries refuse changed directories, symlinks and reused recording identities;
they do not restore deleted sessions. See the [Operations guide](../../docs/livelens/OPERATIONS.md).

`object-storage.mjs` implements workspace-scoped filesystem and S3 Signature V4
adapters and an AES-256-GCM envelope wrapper. Configure `LIVELENS_OBJECT_STORAGE`
to enable explicit archive and restore jobs over verified recorder segments.
Replay continues to validate local original files; archive/restore never silently
changes its source. Keys stay in the private runtime. The bounded-buffer
interface limits one object to 1 GiB; production large-object streaming and
multipart uploads need a separate measured migration.

The SQLite backup command includes a consistent snapshot and hash-verified media, encrypted
with AES-256-GCM. Stop recording and speech jobs before creation and complete all
pending/failed retention cleanup. Backup refuses `finish_retention_cleanup_before_backup`
because cleanup tasks bind filesystem identities that cannot be replayed safely
against a new restore root. Admission is checked again on the completed database
snapshot. Retain the
32-byte base64url `LIVELENS_BACKUP_KEY` separately from the archive; losing it
prevents recovery. Neither the CLI nor receipts print the key.

```bash
node deployment/livelens/backup.mjs create /absolute/intelligence.sqlite /absolute/media /absolute/private-backup.llbackup
node deployment/livelens/backup.mjs restore /absolute/private-backup.llbackup /absolute/new-recovery-directory
```

Restore accepts a new directory only, authenticates the complete archive before
extracting, rejects links/traversal, verifies SQLite integrity and every media
hash, and does not start a service. Repoint an explicitly stopped service only
after reviewing the recovery receipt. This command does not back up PostgreSQL
or external object storage. Use PostgreSQL's separately managed backup/recovery
and retain the object store plus encryption keys. Test restore regularly; an
archive receipt alone is not proof of recovery.

The [pilot drill](../../docs/livelens/PILOT_DRILL.md) runs a bounded on-disk mixed
workload with actual concurrent generated-media captures. It removes its own
original temporary database/media after backup, then verifies original events,
reviewed investigations, reports and byte-identical decodable media through a
fresh restored API process. Run `node deployment/livelens/pilot-drill.mjs --output
/tmp/livelens-pilot-drill.json` with an unused output path. Its receipt measures
that fixture only; it is not a production capacity or crash-recovery guarantee.

`postgres/001_core.sql` preserves workspace/source clocks and evidence contracts,
adds forced workspace row policies and independent case grants. `002_queue.sql`
uses `FOR UPDATE SKIP LOCKED`, leases, bounded retries and expiry recovery.
Application authentication must bind `SET LOCAL app.workspace` in every
transaction; create a non-owner/non-superuser application role. This target schema
differs from the current optional bridge, which preserves the existing pilot
tables and writer semantics. See [POSTGRES.md](POSTGRES.md) for its tested contract.

`compose.infrastructure.yml` is a loopback-only PostgreSQL/MinIO evaluation
scaffold with private-network health checks and named volumes. Images and actual
container execution are not validated by the Node unit tests. Supply private
environment credentials and deliberately review/start it before migration;
no infrastructure is provisioned or started by application setup.

The ALFRED local gateway is in `integrations/alfred/livelens_gateway.py`. It checks
explicit source-read and collection grants for every dispatch, re-reads its
runtime token, bounds job duration, returns evidence receipts as untrusted data,
and checks model egress separately. It registers nothing in the separate ALFRED
repository and cannot write accepted memory.
