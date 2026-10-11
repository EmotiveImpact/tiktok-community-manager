# Local validation receipt

Validated on 2026-10-11 against the final service source, including archive quotas,
request-ID validation, accurate case counts and anonymous/person graph contracts.
No commit, hosted deployment, paid provider request or ALFRED registration was
performed by these checks.

## Complete service suite

The underlying command was `node --test services/intelligence/test/*.test.mjs`
with these selections set privately:

```text
LIVELENS_TEST_POSTGRES_URL=<private disposable database URL>
LIVELENS_TEST_PDF_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3
LIVELENS_TEST_PDF_CHROMIUM=/usr/bin/chromium
```

Result: **102 passed, 0 failed, 0 skipped**, elapsed **51.135 seconds**. This
included actual native PostgreSQL/HTTP persistence, independent FFmpeg jobs,
encrypted archive/restore, offline Chromium PDF and actual PocketSphinx CPU
recognition. A separate actual PostgreSQL graph check preserved an anonymous
speaker and manual unverified person reference across reconnect and enforced
workspace isolation. It was a functional check outside the 102-test count.

The database was official PostgreSQL 17.6, image digest
`sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`.
Native dependencies were exact `pg-native` 3.9.1 / `libpq` 1.11.0 on Node 24.19.0.
The optional service dependency inventory contains 62 exact npm distributions;
61 have retained licence evidence. Euler SDK 0.1.5 supplies MIT metadata without
a distributed licence notice and still requires review.

## Actual default container

The repository-root Docker build completed with the session CA mounted as a
BuildKit secret and TLS verification preserved. Its exact tested image was:

```text
sha256:9036e91db466d5d7052de0a6538e1d569b4aff1253c13c7cee44cc0fdd130e07
```

It ran as the image's non-root user with a read-only root filesystem, no Linux
capabilities, temporary `/tmp`, loopback-only published port and a synthetic
five-second file source. Actual checks demonstrated:

- Health 200 and anonymous API refusal 401.
- FFmpeg completion with three hash-verified segments.
- Encrypted archive completion and four authenticated envelope objects.
- Missing local replay refusal 410, followed by explicit restore of the exact
  original 103,815-byte segment and matching API replay SHA-256.
- Usage of 277,745 local bytes plus 279,167 encrypted archive bytes, with no
  pending jobs or reserved bytes after completion.
- Native PostgreSQL and pinned TikTok modules load; the PDF helper and relative
  deployment storage module are present in the image.

The API-only image's optional Chromium/Playwright/PocketSphinx derived-image
recipes were not built. Actual native PostgreSQL service behaviour was tested
on the host; an additional PostgreSQL-image container attempt could not start
when the workspace filled. No successful container-to-PostgreSQL connection is
claimed. The default SQLite container smoke completed successfully.

Task containers were stopped. To recover workspace capacity, the tested image
was exported and its manifest verified before removing only task images and
30 positively identified task build-cache records. No global prune was used.
The current task retains `/tmp/livelens-intelligence-tested.tar`; recovery is
`docker load -i /tmp/livelens-intelligence-tested.tar`. Its SHA-256 is:

```text
8e8c6c5be5fadca90223f18c0fb82d65623a873fce214e2304806a82211069a5
```

Temporary task exports are not a published container registry or a guarantee of
availability in a future cloud task. Source and reproducible build instructions
remain in the repository. Real public LIVE/provider access, real S3 credentials,
remote model egress, target PostgreSQL/RLS migration, paid billing and customer
capacity remain separate checks; fixture success does not establish them.
