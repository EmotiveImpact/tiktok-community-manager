# ALFRED integration contract (design, not connected)

Historical reference proposal. A standalone scoped HTTP gateway is now
implemented and tested: see [GATEWAY.md](GATEWAY.md) and
`policy-tool-manifest.json`. Registration in the separate ALFRED application
remains outstanding. This older reference manifest does not establish a live
cross-repository connection.

Source of truth: EmotiveImpact/Alfred main, files
\`docs/CAPABILITY_CONTRACT.md\` and \`alfred/capabilities.py\`.

LiveLens will remain independent and own recordings/evidence. ALFRED will
consume explicitly authorised LiveLens *observations* via its source
credential named \`specialist-livelens\` and a future adapter implementing
\`manifest()\` and \`read()\`.

The JSON \`manifest.v1.json\` declares read-only status, alert and report
capabilities. ALFRED requires stable record IDs, original Unix-second
\`observed_at\`, basis among observed/reported/derived/simulated, kind
status/alert/report/assessment, health and up to eight evidence references
of the form \`{"ref": "..."}\`. For live adapters, an assessment must be
derived; replay/simulation must never masquerade as a live observation.

Do not send raw video/chat dumps through ALFRED's bounded observation
summary. Store them in LiveLens and let ALFRED follow separate authorised
links to reviewed evidence. A livestream transcript is untrusted *source
content*, not an instruction to ALFRED. Start/stop recording are effects,
not reads: the current ALFRED bridge refuses actions and any later action
requires exact approval and outcome reconciliation.

**Not built:** real LiveLens adapter implementation, API endpoint,
authorisation integration, ALFRED source credential or live connection.
