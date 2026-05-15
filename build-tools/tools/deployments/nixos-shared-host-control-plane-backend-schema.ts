#!/usr/bin/env zx-wrapper

export const NIXOS_SHARED_HOST_CONTROL_PLANE_BACKEND_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS submissions (
    submission_id TEXT PRIMARY KEY,
    submission_path TEXT NOT NULL,
    execution_snapshot_path TEXT NOT NULL,
    lock_scope TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    deploy_run_id TEXT,
    completed_at TIMESTAMPTZ,
    document_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS submissions_by_deploy_run_id ON submissions(deploy_run_id);
  CREATE TABLE IF NOT EXISTS snapshots (
    submission_id TEXT PRIMARY KEY,
    execution_snapshot_path TEXT NOT NULL,
    document_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS queue (
    submission_id TEXT PRIMARY KEY,
    enqueued_at TIMESTAMPTZ NOT NULL,
    claimed_by TEXT,
    claim_token TEXT,
    claim_expires_at BIGINT,
    completed_at TIMESTAMPTZ
  );
  ALTER TABLE queue ADD COLUMN IF NOT EXISTS claim_token TEXT;
  CREATE TABLE IF NOT EXISTS idempotency (
    kind TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY(kind, key_hash)
  );
  CREATE TABLE IF NOT EXISTS artifact_challenges (
    challenge_id TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    expires_at_ms BIGINT NOT NULL,
    used_at TIMESTAMPTZ,
    principal_id TEXT NOT NULL,
    key_id TEXT NOT NULL,
    binding_json JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS run_actions (
    action_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    action TEXT NOT NULL,
    request_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locks (
    lock_scope TEXT PRIMARY KEY,
    holder_id TEXT NOT NULL,
    fencing_token TEXT NOT NULL,
    lease_expires_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deploy_records (
    deploy_run_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    record_path TEXT NOT NULL,
    document_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deploy_records_by_submission_id ON deploy_records(submission_id);
  CREATE TABLE IF NOT EXISTS current_stage_state (
    deployment_id TEXT NOT NULL,
    environment_stage TEXT NOT NULL,
    current_run_id TEXT NOT NULL,
    document_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(deployment_id, environment_stage)
  );
  CREATE TABLE IF NOT EXISTS stage_state_history (
    deployment_id TEXT NOT NULL,
    environment_stage TEXT NOT NULL,
    deploy_run_id TEXT NOT NULL,
    document_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(deployment_id, environment_stage, deploy_run_id)
  );
  CREATE TABLE IF NOT EXISTS stage_state_audit_events (
    event_id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    environment_stage TEXT NOT NULL,
    deploy_run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content_hash TEXT,
    event_hash TEXT,
    audit_sequence INTEGER,
    document_json JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
  );
  ALTER TABLE stage_state_audit_events ADD COLUMN IF NOT EXISTS content_hash TEXT;
  ALTER TABLE stage_state_audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
  ALTER TABLE stage_state_audit_events ADD COLUMN IF NOT EXISTS audit_sequence INTEGER;
  CREATE TABLE IF NOT EXISTS control_plane_audit_events (
    event_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT,
    deployment_id TEXT NOT NULL,
    result TEXT NOT NULL,
    failure_summary TEXT,
    document_json JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS control_plane_audit_by_deployment
    ON control_plane_audit_events(deployment_id, occurred_at);
  CREATE TABLE IF NOT EXISTS artifact_cleanup_janitor_records (
    record_id TEXT PRIMARY KEY,
    submission_id TEXT,
    deployment_id TEXT,
    reason TEXT NOT NULL,
    document_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS artifact_objects (
    object_key TEXT PRIMARY KEY,
    bucket TEXT NOT NULL,
    digest TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_type TEXT NOT NULL,
    provenance_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    status TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS control_plane_web_sessions (
    session_id TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    principal_json JSONB NOT NULL,
    grants_json JSONB NOT NULL,
    idempotency_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  );
`;
