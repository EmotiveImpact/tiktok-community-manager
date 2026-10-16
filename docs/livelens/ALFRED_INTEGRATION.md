# ALFRED integration contract

## Guided connection builder

The LiveLens Agent connection screen now prepares the real pinned ALFRED config
and CLI installation recipe. Choose exact session IDs (up to 200 recent sessions
are offered), supply an existing scope/private directory and download the files.
Read-only is the default; bounded collection requests a separate grant. No token
enters this UI, no supplied endpoint is contacted and nothing is installed by
exporting files. See [Aperture workflows](APERTURE_WORKFLOWS.md) for actual screens.

The builder's 23 tests cover invalid origins/paths, explicit source/session IDs,
private-file paths, bounded durations and literal shell quoting. Generated read-only
and collection configurations were also accepted by the pinned ALFRED's actual
in-memory LiveLensTools/LiveLensClient/LiveLensGateway validators without transport
requests. This does not establish private filesystem placement or a customer's
connection. The full ALFRED suite below belongs to its prior exact commit and was
not rerun for the LiveLens UI changes.

## Actual ALFRED integration — 11 October 2026

The optional first-party tools are implemented in
[ALFRED draft PR #20](https://github.com/EmotiveImpact/Alfred/pull/20), branch
`feat/livelens-tools-2026-10-11`, commit
`5b37ba41353cfcd0cae4243482520e25175e21d9`. This branch is pushed, unmerged and
undeployed. Hosted CI was started but its result is not established by the local
checks below. Follow the exact
[ALFRED operating guide](https://github.com/EmotiveImpact/Alfred/blob/5b37ba41353cfcd0cae4243482520e25175e21d9/docs/LIVELENS_INTEGRATION.md)
for private configuration, grant renewal, invocation and disconnect.

This is an actual ALFRED runtime integration, through `alfred.livelens.LiveLensTools`
inside the existing authenticated Desk HTTP transport and the ordinary
`python3 -m alfred.desk livelens` operator command. It does not relax or replace
the ICS/VCF local-export connector registry. Installing it is explicit:
`livelens-connect` reads owner-selected private configuration and a private
mode-0600 token file outside Git/vaults; `serve` loads that configured provider.
Installation starts no polling and grants no model egress or accepted-memory import.

The configured ALFRED host exposes:

| Route | Function and authority |
|---|---|
| `GET /desk/livelens` | Authenticated discovery/current permissions; installed host reports `registeredInAlfred:true`, absent configuration reports `configured:false`. |
| `POST /desk/livelens/read` | Granted sessions/search/evidence/context/report/job reads, bound to configured workspace, sources and sessions. |
| `POST /desk/livelens/actions` | Owner proposes exact bounded start/stop parameters and reason; creates a durable action and fingerprint. |
| `POST /desk/livelens/actions/:id/approve` | Explicit approval of the returned fingerprint, bound to actor, configuration, credential generation and source-policy epoch. |
| `POST /desk/livelens/actions/:id/dispatch` | Rechecks current authority immediately before the write; returns accepted or uncertain outcome. |
| `POST /desk/livelens/actions/:id/reconcile` | Reads the original stable job ID after uncertainty; validates the original parameters without repeating the write. |

Host/Origin/fetch-metadata, HttpOnly session and CSRF checks remain active.
Source reads require strict current `read` and `connector.read` grants. Capture
requires owner authority, a separate `collection.control` grant and exact approval
for every start/stop. Model permission remains separate; no route automatically
sends evidence to a model. Source words retain untrusted-data receipts and never
become accepted ALFRED memory automatically. LiveLens owns original media/evidence;
ALFRED retains bounded action metadata and audit identifiers.

An ALFRED action marked completed means request acceptance/reconciliation. Inspect
the LiveLens job receipt separately for actual recording completion, retained
segments and hashes. Accepted jobs retain LiveLens's duration/stop/retention
bounds even if ALFRED access is later revoked. The CLI supports discover, reads,
actor-private actions, propose, approve, dispatch and reconcile against the same
installed tools.

The immutable
[redacted cross-repository receipt](https://github.com/EmotiveImpact/Alfred/blob/5b37ba41353cfcd0cae4243482520e25175e21d9/docs/evidence/livelens-2026-10-11/http-receipt.json)
records **36/36** actual authenticated HTTP/CLI checks, a six-second generated
capture, three independently hashed/decoded segments and 6,000 ms decoded media.
The full ALFRED backend suite passed **1,128 tests with zero skips**, and its Desk
and Knowledge browser checks passed **58 checks**. No external TikTok LIVE,
model call, email or third-party source-library execution was involved.
These receipts prove the configured fixture integration on that revision; they
do not configure a user's ALFRED host or establish external LIVE access.

LiveLens's `/v1/agent` and standalone gateway still correctly describe an adapter
without inferring another host's private installation. Registration truth comes
from the configured ALFRED `/desk/livelens` endpoint. Do not change a service-wide
manifest to claim every ALFRED host is connected.

## Historical standalone gateway and original integration plan

The standalone scoped read/control policy gateway is now implemented and tested in
[GATEWAY.md](../../integrations/alfred/GATEWAY.md). Registration in the separate ALFRED
application remains outstanding. The earlier client-transport milestone below is historical.

Inspected repository: `EmotiveImpact/Alfred`, main commit
`75947b8dd59a3161c862d2533850a032994778e2`.
Relevant sources: `README.md`, `AGENTS.md`, `alfred/connectors.py`.

The current registered connector interface is for owner-selected local calendar
and contact export files. Its manifests require `network=False`, `polling=False`,
`credentials='none'` and a fixed read-scope catalogue. A LiveLens HTTP manifest is
not compatible with that registry and must not be presented as installed.

## Implemented here

`integrations/alfred/livelens_client.py` is a standalone Python standard-library
client. It supports capabilities, sessions, literal evidence search and case
reports. It requires a caller-owned API token, permits HTTPS or explicit loopback
HTTP and refuses redirects. It does not start monitoring, register tools, modify
memory or send evidence to a model. A real HTTP acceptance test exercises it
against the LiveLens service using synthetic evidence.

Run after setting `LIVELENS_URL` and `LIVELENS_TOKEN` in the caller's private
environment:

```bash
python3 integrations/alfred/livelens_client.py capabilities
python3 integrations/alfred/livelens_client.py search --query "your topic"
python3 integrations/alfred/livelens_client.py report --case your_case_id
```

The separate manifest records implemented transport capability, planned ALFRED
registration, requested read scopes and inspected ALFRED revision.

## Next ALFRED job

1. Start from current ALFRED main and re-read its integration instructions.
2. Add an explicit HTTP-tool adapter through its independent policy layer rather
   than relaxing the local-export connector validator.
3. Bind one configured LiveLens workspace and source to ALFRED's personal/company/
   client scope. Store the token in its private runtime, outside any vault.
4. Recheck read grants at dispatch and render evidence IDs, source URLs, unknown
   speaker mappings, assertion status and collection freshness in tool results.
5. Preserve source revisions when importing reviewed records. A generated report
   does not become accepted ALFRED memory automatically.
6. Keep model-egress permission separate from source-read permission.
7. Test revoked grants, token rotation, service timeout, unavailable sources,
   cross-workspace refusal and untrusted transcript instructions.

Collection controls follow as a separate integration once LiveLens has a durable
job API. Their parameters need exact source IDs, duration/concurrency limits,
retention and a traceable completion receipt. Bounded recorder start/stop and independent dispatch policy are implemented in
the standalone gateway; registration in ALFRED remains outstanding.
