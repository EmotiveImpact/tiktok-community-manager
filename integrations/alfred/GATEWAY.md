# Scoped ALFRED tool adapter

`livelens_gateway.py` is a callable local adapter. The existing ALFRED export-file
registry does not accept an HTTP connector, so this repository does not register
tools, alter that policy layer or claim an installed ALFRED connection.

```python
from integrations.alfred.livelens_gateway import LiveLensGateway

gateway = LiveLensGateway(
    configured_url,
    configured_workspace,
    [{"id": "selected_source", "sessionIds": ["captured_session"],
      "recorderSourceId": "configured_recorder_source"}],
    token_provider=read_private_runtime_token,
    grant_check=check_current_alfred_policy,
    max_duration_seconds=600,
    receipt_sink=save_reviewable_receipt,
)
```

These callbacks are required integration points. `grant_check` receives
`{subject,workspace,sourceIds,permission}` and must return exactly `True`; no
configuration or source text can substitute for the policy decision.
`token_provider()` is called on every dispatch, permitting private token rotation.
The service validates the token and configured workspace independently.

`dispatch(subject, operation, parameters)` supports sessions, search, evidence,
context, report, start_recording, job and stop_recording. Every operation has a
closed parameter catalogue; user-supplied workspace, URL, credentials and tools
are refused. Searches require one configured session. Reports spanning an
ungranted session are refused. Evidence, surrounding context and returned
sessions are checked against the configured source/session catalogue.

Read operations require `source:read`. Start/stop require the independent
`collection:control` grant, rechecked immediately before the HTTP write. Start
also requires a stable job ID and explicit bounded duration. The LiveLens server
applies its own configured-source, workspace and quota constraints. Revocation
during a read prevents delivery; a write already accepted by the service remains
a bounded job with its own stop operation and receipt.

Receipts include workspace/source bindings, operation, receipt clock, result
hash and `trust: untrusted-source-data`. Captured words cannot select another
tool or grant authority. `model_payload(subject, receipt)` separately rechecks
read and `model:egress` grants and the result hash; it returns labelled data and
does not send it anywhere. Memory is never accepted automatically.

The actual-HTTP acceptance tests cover scoped service access, role revocation,
token rotation, separate egress grants, hostile source text, late collection
revocation, bounded control receipts, stop and bounded service timeout. No real
provider is contacted by these tests.
