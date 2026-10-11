# Measured local read probe

Receipt from `node deployment/livelens/capacity-probe.mjs 10 200`, run in the
development container on 11 October 2026. This is an isolated synthetic HTTP
read test over 1,000 evidence events in an in-memory SQLite database.

```json
{
  "requestConcurrency": 10,
  "requestCount": 200,
  "errors": 0,
  "elapsedMs": 452.85,
  "requestsPerSecond": 441.64,
  "latencyMs": {"p50": 20.24, "p95": 37.94, "p99": 66.42},
  "recordingConcurrency": "not measured by this probe",
  "speechConcurrency": "not measured by this probe",
  "customerCapacity": "not established",
  "billedCost": "not measured"
}
```

Request concurrency is not registered users or sustained customer traffic.
Disk/WAL load, browser sessions, worker recording, model inference, object
storage, multi-node recovery and long-duration workloads require separate
measurements on the intended hosting configuration. Re-run the probe for a
local comparison; do not use these figures to advertise hundreds of users.
