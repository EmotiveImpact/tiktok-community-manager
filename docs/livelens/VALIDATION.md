# Validation receipt

Date: 10 October 2026. Source baseline:
`8731d5bdd4ec932c6bfe3c50bf02ace154aa616e`.
Runtime: Node `v24.19.0`; Python standard library; Linux.

| Check | Result | Practical scope |
|---|---|---|
| Original source materialisation | 168/168 fetched source files match their Git blob hashes | Source read through the connected GitHub API. Unchanged binary assets and other original files are preserved through the remote base tree, not substituted locally. |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed | Original locked dependencies; lifecycle scripts and Electron/FFmpeg binary installation not run |
| `npm test` | 78 tests, 9 files passed | Existing community-manager and LiveLens timeline regressions |
| `npm run build` | Passed | TypeScript, Vite renderer and Electron main/preload bundles; existing size/browser-data warnings remain |
| `npm --prefix services/intelligence test` | 15 passed | Persistent SQLite and real loopback HTTP; clients, scopes, workspace isolation, retries, corrections, report integrity and input boundaries |
| `npm --prefix services/intelligence run demo` | Passed | Synthetic evidence survives close/reopen and exports a source-linked report |
| `node scripts/research/verify-upstreams.mjs --checkouts` | 8/8 passed | Recorded Gitlinks, exact lock and actual upstream checkout HEADs agree |
| Old CI logs at prior head | Unavailable | GitHub reported failure; job log endpoint returned BlobNotFound. No old root cause is asserted. |

The service tests include a Python subprocess querying the running HTTP API.
They do not exercise ALFRED registration or a speech provider. All fixtures are
synthetic. No upstream applications/models, live account, external AI request,
recording, notification, merge or deployment occurred during validation.

This is pilot code. A local hash chain is not an external signature or trusted
timestamp and cannot withstand an administrator rewriting the entire database.
Storage lifecycle, recovery, encryption, commercial access controls and media
retention remain tracked work.

CI uses ignored-lifecycle installation for unit/build validation plus a separate
Node 24 service/source-pin job. Current-head results are reported in the PR;
publishing a workflow is not evidence that it completed successfully.
