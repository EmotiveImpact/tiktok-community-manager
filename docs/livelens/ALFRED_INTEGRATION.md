# ALFRED integration contract

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
retention and a traceable completion receipt. No such control API is implemented
by this milestone.
