-- Production-target schema. The running pilot remains SQLite until a deliberate migration.
BEGIN;
CREATE TABLE IF NOT EXISTS livelens_schema(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces(id text PRIMARY KEY, limits jsonb NOT NULL, retention_days integer CHECK(retention_days BETWEEN 1 AND 3650), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspace_members(workspace text NOT NULL REFERENCES workspaces(id),subject text NOT NULL,role text NOT NULL CHECK(role IN('owner','admin','analyst','viewer','revoked')),updated_at timestamptz NOT NULL DEFAULT now(),updated_by text NOT NULL,PRIMARY KEY(workspace,subject));
CREATE TABLE IF NOT EXISTS service_keys(workspace text NOT NULL REFERENCES workspaces(id),id uuid NOT NULL,subject text NOT NULL,token_sha256 bytea NOT NULL UNIQUE,scopes text[] NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS sessions(workspace text NOT NULL REFERENCES workspaces(id),id text NOT NULL,platform text NOT NULL,account text,source_url text NOT NULL,title text NOT NULL,started_at_ms bigint NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS evidence_events(workspace text NOT NULL,session_id text NOT NULL,id text NOT NULL,sequence bigint GENERATED ALWAYS AS IDENTITY,adapter text NOT NULL,provider_id text NOT NULL,kind text NOT NULL,text text NOT NULL,account text,speaker_id text,source_timestamp_ms bigint,captured_at_ms bigint,received_at_ms bigint NOT NULL,payload jsonb NOT NULL,content_sha256 text NOT NULL,payload_sha256 text NOT NULL,previous_sha256 text,entry_sha256 text NOT NULL,PRIMARY KEY(workspace,id),UNIQUE(workspace,session_id,adapter,provider_id),FOREIGN KEY(workspace,session_id) REFERENCES sessions(workspace,id));
CREATE INDEX IF NOT EXISTS evidence_session ON evidence_events(workspace,session_id,sequence);
CREATE INDEX IF NOT EXISTS evidence_literal_search ON evidence_events USING gin(to_tsvector('simple',text));
CREATE TABLE IF NOT EXISTS account_assertions(workspace text NOT NULL,event_id text NOT NULL,revision bigint GENERATED ALWAYS AS IDENTITY,account text NOT NULL,reviewer text NOT NULL,reason text NOT NULL,created_at_ms bigint NOT NULL,PRIMARY KEY(workspace,event_id,revision),FOREIGN KEY(workspace,event_id) REFERENCES evidence_events(workspace,id));
CREATE TABLE IF NOT EXISTS cases(workspace text NOT NULL REFERENCES workspaces(id),id text NOT NULL,title text NOT NULL,question text NOT NULL,created_by text NOT NULL,created_at_ms bigint NOT NULL,visibility text NOT NULL DEFAULT 'workspace' CHECK(visibility IN('workspace','restricted')),PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS case_events(workspace text NOT NULL,case_id text NOT NULL,event_id text NOT NULL,linked_by text NOT NULL,linked_at_ms bigint NOT NULL,PRIMARY KEY(workspace,case_id,event_id),FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id),FOREIGN KEY(workspace,event_id) REFERENCES evidence_events(workspace,id));
CREATE TABLE IF NOT EXISTS case_access_grants(workspace text NOT NULL,case_id text NOT NULL,subject text NOT NULL,permission text NOT NULL CHECK(permission IN('read','write')),PRIMARY KEY(workspace,case_id,subject),FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id),FOREIGN KEY(workspace,subject) REFERENCES workspace_members(workspace,subject));
CREATE TABLE IF NOT EXISTS media_segments(workspace text NOT NULL,job_id text NOT NULL,id text NOT NULL,session_id text NOT NULL,object_key text NOT NULL,started_at_ms bigint NOT NULL,duration_ms bigint NOT NULL CHECK(duration_ms>0),bytes bigint NOT NULL CHECK(bytes>0),sha256 text NOT NULL,encryption_key_id text,PRIMARY KEY(workspace,job_id,id),FOREIGN KEY(workspace,session_id) REFERENCES sessions(workspace,id));
CREATE TABLE IF NOT EXISTS audit_entries(workspace text NOT NULL REFERENCES workspaces(id),id uuid NOT NULL,sequence bigint GENERATED ALWAYS AS IDENTITY,actor text NOT NULL,action text NOT NULL,resource text NOT NULL,details jsonb NOT NULL,created_at_ms bigint NOT NULL,previous_sha256 text,entry_sha256 text NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS usage_ledger(workspace text NOT NULL REFERENCES workspaces(id),id uuid NOT NULL,job_id text NOT NULL,meter text NOT NULL CHECK(meter IN('recording_seconds','storage_bytes','speech_seconds')),amount numeric NOT NULL CHECK(amount>=0),receipt_sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace,id),UNIQUE(workspace,job_id,meter,receipt_sha256));
CREATE TABLE IF NOT EXISTS durable_jobs(workspace text NOT NULL REFERENCES workspaces(id),id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('recording','speech','analysis','report','notification')),session_id text,payload jsonb NOT NULL,state text NOT NULL CHECK(state IN('queued','leased','retrying','completed','stopped','failed')),attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 10),available_at timestamptz NOT NULL DEFAULT now(),deadline timestamptz NOT NULL,lease_owner uuid,lease_until timestamptz,stop_requested boolean NOT NULL DEFAULT false,error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,session_id) REFERENCES sessions(workspace,id));
CREATE INDEX IF NOT EXISTS durable_jobs_available ON durable_jobs(kind,available_at) WHERE state IN('queued','retrying');
CREATE UNIQUE INDEX IF NOT EXISTS one_recording_per_session ON durable_jobs(workspace,session_id) WHERE kind='recording' AND state IN('queued','leased','retrying');

-- Use a dedicated non-owner/non-superuser application role, SET LOCAL
-- app.workspace inside every transaction after authenticating the principal.
-- FORCE RLS prevents table-owner bypass; superusers remain deployment administrators.
DO $$ DECLARE tab text; BEGIN
 FOR tab IN SELECT unnest(ARRAY['workspace_members','service_keys','sessions','evidence_events','account_assertions','cases','case_events','case_access_grants','media_segments','audit_entries','usage_ledger','durable_jobs']) LOOP
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
   EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=tab AND policyname='workspace_boundary') THEN
     EXECUTE format('CREATE POLICY workspace_boundary ON %I USING (workspace = current_setting(''app.workspace'',true)) WITH CHECK (workspace = current_setting(''app.workspace'',true))',tab);
   END IF;
 END LOOP;
END $$;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='workspaces' AND policyname='workspace_boundary') THEN
   CREATE POLICY workspace_boundary ON workspaces USING(id=current_setting('app.workspace',true)) WITH CHECK(id=current_setting('app.workspace',true));
 END IF;
END $$;
INSERT INTO livelens_schema(version) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;
