-- Call inside an authenticated workspace transaction. A separate privileged
-- scheduler may iterate permitted workspaces; do not disable RLS for app clients.
CREATE OR REPLACE FUNCTION claim_livelens_job(job_kind text, worker_id uuid, lease_seconds integer DEFAULT 30)
RETURNS SETOF durable_jobs LANGUAGE plpgsql AS $$
BEGIN
 IF lease_seconds NOT BETWEEN 5 AND 120 THEN RAISE EXCEPTION 'invalid_lease_duration'; END IF;
 RETURN QUERY
 WITH next_job AS (
   SELECT workspace,id FROM durable_jobs
   WHERE kind=job_kind AND state IN('queued','retrying') AND available_at<=now()
     AND deadline>now() AND attempts<max_attempts AND NOT stop_requested
   ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
 )
 UPDATE durable_jobs j SET state='leased',lease_owner=worker_id,
   lease_until=now()+make_interval(secs=>lease_seconds),attempts=attempts+1,updated_at=now()
 FROM next_job n WHERE j.workspace=n.workspace AND j.id=n.id RETURNING j.*;
END $$;

CREATE OR REPLACE FUNCTION recover_livelens_jobs()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
 UPDATE durable_jobs SET
   state=CASE WHEN stop_requested THEN 'stopped' WHEN deadline<=now() OR attempts>=max_attempts THEN 'failed' ELSE 'retrying' END,
   available_at=now()+make_interval(secs=>least(60,power(2,attempts)::integer)),
   lease_owner=NULL,lease_until=NULL,error_code='worker_lease_expired',updated_at=now()
 WHERE state='leased' AND lease_until<now();
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END $$;

-- Completion must carry workspace,id,lease_owner; an expired/reassigned worker
-- cannot acknowledge another worker's lease. Persist media/evidence and receipt
-- in that same transaction, then state='completed'.
