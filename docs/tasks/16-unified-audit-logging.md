# 17. Unified Audit Logging

**Tier:** Observability & Reliability
**Priority:** 17 of 44
**Depends on:** #4 Containerize Control Plane, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Close gaps in the existing audit schema by adding missing event types, binding actor identity to the authenticated principal once #4 lands, and exposing audit records via a service API endpoint.

## What

Extend and unify the existing audit infrastructure so that every security-significant control-plane
operation produces a durable, actor-attributed, secret-safe audit record in the same Postgres
backend that owns queue, lock, idempotency, and stage-state.

The repo already has two audit tables and several write paths:

- `control_plane_audit_events` — one row per operation (submit, run-action, MCP read, web UI read),
  keyed by `event_id` with fields `actor`, `operation`, `idempotency_key`, `deployment_id`,
  `result`, `failure_summary`, `occurred_at`, and a `document_json` blob. Written by
  `deployment-control-plane-audit.ts` via four exported writers
  (`writeBackendControlPlaneAuditEvent`, `writeBackendControlPlaneRunActionFailureAuditEvent`,
  `writeBackendControlPlaneMcpAuditEvent`, `writeBackendControlPlaneReadAuditEvent`).

- `stage_state_audit_events` — append-only hash-chained rows per `(deployment_id,
  environment_stage)`, with `content_hash`, `event_hash`, `previous_event_hash`, and
  `audit_sequence` forming a tamper-evident chain. Written by `deployment-stage-state-audit.ts`
  for successful stage-state mutations (deploy, promotion, retry, rollback, cancellation,
  recovery). Event types are the closed set: `stage_state_updated`, `promotion_lineage_recorded`,
  `retry_lineage_recorded`, `rollback_lineage_recorded`, `cancellation_recorded`,
  `recovery_recorded`.

The gaps and required work are:

1. **Missing operation coverage.** The following server routes have no audit write of any kind:
   - `POST /api/v1/submission-challenges/artifact` (challenge issuance) — no audit row is written
     by `nixos-shared-host-control-plane-service-challenge.ts` or its callers.
   - `POST /api/v1/artifact-uploads/static-webapp` (artifact upload session creation) — no audit
     row is written by `static-webapp-upload-sessions.ts`.
   - `POST /api/v1/auth/login` and `GET /oidc/callback` (OIDC login session creation and
     callback) — `deployment-auth-session-service.ts` writes no audit row.
   - `GET /api/v1/auth/session` (session read) — no audit row.
   - Break-glass invocation and reconciliation — recorded in submission docs and observability but
     has no dedicated audit row in `control_plane_audit_events`.
   - Successful run-action outcomes — only failures are written by
     `writeBackendControlPlaneRunActionFailureAuditEvent`; approved, cancelled, superseded, and
     resumed runs produce no `control_plane_audit_events` row.

2. **Actor field is unresolved for read paths.** `writeBackendControlPlaneReadAuditEvent` hardcodes
   `actor: "service:deployment-control-plane"` regardless of whether the request was authenticated
   by a bearer token or an OIDC web session. After #6 lands, the resolved principal identity must
   be threaded through to the audit write so that read rows carry the same `oidc:<principal>` or
   `ci:<identity>` that mutating rows already carry via `requestedBy.principalId`.

3. **Retention policy is declared but not enforced.** `deployments-design.md` specifies minimum
   audit-retention windows (`production_facing`: 365 days; `shared_nonprod`: 180 days) and requires
   that "audit and authorization evidence must not expire sooner than the deployment records they
   justify." Neither table has a row-level TTL, archival job, or enforced retention boundary. This
   task should add at least a documented retention strategy — either a Postgres partition scheme,
   a scheduled archival job, or an explicit operator runbook — and optionally implement the
   minimal enforcement mechanism.

4. **No query surface for audit exports.** There is a `readBackendControlPlaneAuditEvents` function
   (queries by `deployment_id`) and a `readBackendStageStateAuditEvents` function (queries by
   `deployment_id` and optionally `environment_stage`), but no operator-facing API route exposes
   either. The web UI, MCP, and service API all lack an audit export endpoint. Security forensics
   and compliance review currently require direct database access.

5. **Chain integrity is not verified on read.** The `event_hash → previous_event_hash` chain in
   `stage_state_audit_events` is written correctly but there is no read-path verifier that detects
   gaps or hash mismatches. The field exists; the verification function does not.

Concrete deliverables for this task:

- Add `control_plane_audit_events` writes to the five missing server paths listed above (challenge
  issuance, upload session, login, callback, session read, break-glass, successful run actions).
- Add actor-identity threading from the resolved auth session or bearer-token principal to
  `writeBackendControlPlaneReadAuditEvent` and the web session creation path.
- Add a `GET /api/v1/audit-events` read route (bearer-token or OIDC session required) that accepts
  `?deploymentId=` and returns the union of `control_plane_audit_events` and
  `stage_state_audit_events` rows in `occurred_at` order, redacted through the existing
  `redactOperatorText` boundary.
- Add a `verifyStageStateAuditChain` function that reads the chain for a given
  `(deployment_id, environment_stage)` and returns a pass/fail verdict with the first broken link.
- Document the retention strategy; if a scheduled archival job is added, add a monitoring alert for
  archival lag.
- Add or extend the existing `control-plane-coordination-audit.test.ts` with cases for the newly
  covered operation kinds and verify that the actor field is present and non-generic for
  session-authenticated requests.

## Why Now

Priority 16 is the earliest this task is unblocked: it requires the Postgres backend from #4 for
durable table storage, and actor identity from #6 to replace `"service:deployment-control-plane"`
fallbacks in read-path audit rows.

The practical pressure is threefold:

**Compliance.** `deployments-contract.md` mandates "required audit events, operational metrics,
alerts, and dashboards sufficient to operate the published resilience, locking, rollout, and
break-glass posture." `deployments-design.md` lists thirteen required event categories (submission,
admission granted/denied, approval lifecycle, lock acquisition/release, mutation step start/finish,
progressive-rollout phases, cancellation, supersedence, preview cleanup, break-glass, in-doubt
recovery). Several of these — challenge issuance, successful run actions, break-glass invocation —
have no current audit row. Making viberoots public (#43) requires demonstrable compliance with this
contract.

**Security forensics.** When a deploy is promoted or rolled back, the stage-state chain provides
a tamper-evident record. But if an artifact challenge is issued and then a submission is rejected
for an identity mismatch, there is no audit row for the challenge that an operator can correlate
with the rejected submission. Gap in coverage means gap in forensic reconstruction.

**Multi-tenant isolation (#29).** Before multiple teams can share one control-plane instance,
each team's audit records must be scoped and queryable by deployment id and environment stage.
The query surface does not exist today. Adding the API route now, under the current single-operator
model, is far cheaper than retrofitting it after tenancy is introduced.

## Risks

- **Actor identity threading for read paths depends on #6 landing cleanly.** If the auth provider
  work is delayed or the session → principal resolution API changes shape, the actor field in read
  audit rows may remain generic until the two tasks can be coordinated. Mitigation: add the
  threading plumbing but document that it only populates after #6 is merged.

- **Challenge and upload audit writes add latency to already-sequential paths.** The artifact
  challenge issuance path is used before every challenged submit. Adding a synchronous audit
  INSERT to that path adds one round-trip to the challenge critical path. Mitigation: use the same
  `ON CONFLICT(event_id) DO NOTHING` pattern already used everywhere, and consider making challenge
  and upload audit writes fire-and-forget (best-effort, non-blocking) since a failed audit write
  should not block artifact admission.

- **Audit export route surface area.** Adding `GET /api/v1/audit-events` creates a new
  authenticated read surface that could expose sensitive operation timing or deployment-id
  enumeration if not scoped correctly. The route must enforce the same bearer-or-session auth as
  all other read routes, must apply the existing redaction boundary, and must not return records for
  deployment IDs the caller is not authorized to inspect. Scope enforcement is simpler now (single
  operator) but must be designed with future scoped grants in mind.

- **Chain verification surface.** The `verifyStageStateAuditChain` function is a read-only
  diagnostic, but if exposed in the API it could become a vector for inferring the number and
  timing of events for a deployment. Expose it only through operator-privileged paths, not unauthenticated.

## Trade-offs

- **Synchronous vs. asynchronous audit writes.** The existing audit writes for submission and
  stage-state are synchronous and transactional with the mutation they record. Challenge issuance
  and upload session writes could be made asynchronous to preserve latency, but asynchronous writes
  risk losing the audit row if the process crashes between the operation and the write. The
  synchronous pattern used everywhere else is the right default; asynchronous is only appropriate
  for paths where audit failure must not block the operation (e.g., challenge issuance where the
  admission path itself has independent idempotency).

- **Single combined audit export endpoint vs. two separate endpoints.** Merging `control_plane_audit_events`
  and `stage_state_audit_events` into one `GET /api/v1/audit-events` response is useful for
  forensics but requires merging two schemas with different fields. The alternative is two
  separate routes. The merged view is simpler for callers; the schema union can carry both event
  shapes with a `schemaVersion` discriminator, matching the patterns already used in both tables.

- **Retention enforcement depth.** Implementing full Postgres table partitioning by `occurred_at`
  for time-based archival is correct long-term but nontrivial. For this task, a documented
  operator runbook plus an alert for tables that exceed the retention window is acceptable
  scope. Full partition-based archival is a follow-on.

## Considerations

- The `control_plane_audit_events` schema (`nixos-shared-host-control-plane-backend-schema.ts`)
  already has `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration guards for `stage_state_audit_events`.
  Any new columns added to either table must follow the same idempotent migration pattern so
  existing databases are upgraded without manual intervention.

- The `DEPLOYMENT_CONTROL_PLANE_AUDIT_SCHEMA = "deployment-control-plane-audit-event@1"` version
  constant must be bumped or a new schema version introduced if the event shape changes
  (e.g., adding an `authSessionId` field for session-authenticated reads).

- `writeBackendControlPlaneReadAuditEvent` currently accepts no `actor` parameter and always
  writes `"service:deployment-control-plane"`. The signature must be extended to accept an optional
  `actor` string without breaking existing callers, using the same `actor || fallback` pattern
  already used in `writeBackendControlPlaneRunActionFailureAuditEvent` and
  `writeBackendControlPlaneMcpAuditEvent`.

- The MCP audit path (`deployment-control-plane-mcp.ts`) already passes `actor` through correctly
  when it is resolvable from the request. The web UI read path does not. Both should follow the
  same resolution order: OIDC session principal → bearer token service identity → fallback.

- The `auditRecord` helper in `deployment-admin-keycloak.ts` produces a structured local audit
  object that is embedded in the sync/grant result JSON but is not written to
  `control_plane_audit_events`. Admin identity mutations (realm sync, user grant) should also emit
  a `control_plane_audit_events` row so they are visible alongside deploy operations in a unified
  query.

- Redaction must be applied to all new audit paths through the existing `redactOperatorText`
  boundary (or `safeText` wrapper already used in both audit modules). This applies especially to
  failure summaries derived from challenge or upload errors, which may contain artifact paths or
  submission IDs that look like internal references.

- The index `control_plane_audit_by_deployment ON control_plane_audit_events(deployment_id, occurred_at)`
  already exists. The audit export route should use `deployment_id` as the primary filter
  predicate so the existing index covers the query without a sequential scan.

- The `stage_state_audit_events` chain uses `COALESCE(audit_sequence, 0) DESC` ordering because
  the `audit_sequence` column was added via `ALTER TABLE`. Any chain verification function must
  handle rows where `audit_sequence` is NULL (pre-column-addition rows) by falling back to
  `occurred_at` ordering, consistent with the existing `readBackendStageStateAuditEvents`
  implementation.
