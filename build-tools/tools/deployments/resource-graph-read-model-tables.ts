#!/usr/bin/env zx-wrapper

export const RESOURCE_GRAPH_READ_MODEL_TABLES = [
  "resource_graph_imports",
  "resource_graph_nodes",
  "resource_graph_edges",
  "resource_graph_runtime_evidence",
] as const;

export const PRESERVED_CONTROL_PLANE_TABLES = [
  "submissions",
  "snapshots",
  "queue",
  "idempotency",
  "artifact_challenges",
  "run_actions",
  "locks",
  "deploy_records",
  "current_stage_state",
  "stage_state_history",
  "stage_state_audit_events",
  "control_plane_audit_events",
  "artifact_cleanup_janitor_records",
  "artifact_objects",
  "worker_heartbeats",
  "control_plane_web_sessions",
  "deployment_auth_sessions",
  "static_webapp_upload_sessions",
] as const;

export function controlPlaneTableClassification() {
  return {
    indexedReadModelTables: [...RESOURCE_GRAPH_READ_MODEL_TABLES],
    preservedAuthoritativeTables: [...PRESERVED_CONTROL_PLANE_TABLES],
  };
}
