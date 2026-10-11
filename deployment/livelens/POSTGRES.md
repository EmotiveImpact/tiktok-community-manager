# Optional PostgreSQL pilot bridge

Set private `LIVELENS_POSTGRES_URL` to select `PostgresDatabase` rather than the
default SQLite database. The Node 24 service uses one persistent synchronous
`pg-native`/libpq connection. It does not launch a query subprocess. Remote
connections require `sslmode=verify-full`; explicit loopback connections may use
a local development database. Passwords and URLs are never returned by the API.
Host/host-address/service overrides, duplicate query options and unknown options
are refused before connection. Ambient `PGHOSTADDR`, `PGSERVICE` and
`PGSERVICEFILE` are also refused. The bounded accepted URI options are `sslmode`,
`sslrootcert`, `sslcert`, `sslkey`, `sslpassword`, `application_name`,
`channel_binding` and `connect_timeout`; connection timeout is fixed at five
seconds. This prevents libpq options from changing a validated loopback host
into a remote plaintext destination.

The existing source clocks, hash chains, idempotency keys, workspace parameters,
investigations, jobs, memberships, case permissions and audit contracts remain
the same. The bridge uses its own schema, default `livelens`, containing the
pilot table layout. PostgreSQL BIGINT/numeric values must fit JavaScript's safe
number range. Camel-case selected aliases and mutation row counts are retained.

Only the project's explicit SQLite SQL subset is translated: numbered
parameters outside quoted text, integer/serial definitions, `INSERT OR IGNORE`,
schema introspection, table-info introspection and the used scalar maximum.
Unknown SQLite pragmas/functions fail instead of silently changing meaning.
DDL and all values remain separate; captured text never becomes SQL.

`BEGIN IMMEDIATE` acquires a PostgreSQL transaction advisory writer lock. This
deliberately preserves the pilot's serialized mutation semantics across service
connections. Native calls block the Node event loop during a query, with bounded
statement/lock timeouts. This bridge is a tested persistence option, not proof of
scaled distributed writes. `postgres/001_core.sql` and `002_queue.sql` describe a
separate production schema/row-policy/queue target; they are not silently applied.

The service has its own exact npm lock, leaving the desktop lock unchanged.
Optional runtime selections are `pg-native` 3.9.1 and `libpq` 1.11.0 (MIT), plus
the existing TikTok connector route 2.1.0 and Euler SDK 0.1.5. Installed service
package versions, integrities, licence metadata and available notices appear in
`services/intelligence/runtime-lock.json` and `runtime-licences/`. Provider terms,
missing distributed notices and model/FFmpeg redistribution remain separate
commercial review obligations.

On a conventional Linux host, install a trusted libpq development package,
compiler, Python and Node 24, then run:

```bash
npm --prefix services/intelligence ci
```

SQLite can run when this optional native module is absent. Selecting PostgreSQL
without it returns a specific unavailable configuration error; no fallback can
quietly create an unrelated SQLite database.

Actual parity was validated against the official PostgreSQL 17.6 container,
image digest `sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`.
The native module was built on Node 24.19.0 using verified Debian libpq development
headers extracted into the writable workspace; no host system package was edited.
The tests exercise the service's real native connection and actual HTTP:

- Atomic event retries/conflicts, original clocks, hash verification, case exports
  and reopening persisted data with a new connection.
- Roles, case grants, revocation, audits, private report/list isolation and usage.
- Two actual independent FFmpeg recordings and configured-source persistence.
- Verified encrypted archive readback, removal of a local media file, explicit
  restore and replay-byte verification, plus scheduler mission/lease persistence.

Run these tests only against a selected disposable database using a private URL:

```bash
node --test services/intelligence/test/postgres.test.mjs
```

Set `LIVELENS_TEST_POSTGRES_URL` privately first. Without it, the actual database
tests report skipped; the SQL translator test still runs. Test schemas are
randomly named and removed. This is no hosted deployment, provider validation,
PostgreSQL backup guarantee, RLS rollout or customer-capacity receipt.
