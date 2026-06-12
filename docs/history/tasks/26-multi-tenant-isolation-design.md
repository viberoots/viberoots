# 29. Multi-Tenant Isolation Invariants / Design

**Tier:** Process & Governance
**Priority:** 29 of 44
**Depends on:** #4 Containerize Control Plane, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Produce a design document and follow-on ADR addressing open design questions for multi-tenant control plane operation: tenant identity, database isolation, API scoping, artifact namespace, Infisical credential boundaries, audit isolation, web UI scoping, and provisioning model.

## What

Produce a formal design document — and a companion ADR if design decisions bind future
implementation — that specifies how multiple independent organizations (tenants) safely share one
control-plane instance. The design must cover every layer where cross-tenant contamination is
possible: the Postgres schema, the API authorization surface, the artifact store, the Infisical
credential boundary, the audit trail, and the observed behavior of the read APIs and web UI.

The current deployment system already has per-deployment isolation defined in ADR-00004 (seven
interlocking rules: deployment-id isolation, single-provider per deployment, environment stage
isolation, preview isolation, lane policy isolation, artifact isolation, and secret isolation). That
model isolates deployments from each other within a single operator's context. It does not address
the case where two organizations — for example, viberoots itself and an external adopter such as
Bob's org — submit and operate deployments against the same shared control-plane instance.

The output of this task is a written design, not implementation code. The design must answer:

1. **Tenant identity.** What is the canonical tenant identifier? Is it an organization id from
   the auth provider (Supabase Auth org, WorkOS org), a control-plane-registered account, or
   something else? How is a tenant id bound to an inbound API request, and how is it validated
   fail-closed before any state is read or written?

2. **Database isolation model.** For each major table group (submissions, queue, deploy records,
   stage state, stage history, provider locks, artifact metadata, audit rows, sessions), specify
   which of the following isolation strategies applies and why:
   - a tenant column on every row with Postgres row-level security (RLS) enforcing the boundary;
   - a separate schema per tenant within one database;
   - a separate Postgres database (or Supabase project) per tenant.
     The design must justify the choice for the control-plane database specifically, separate from any
     application-layer database decisions made in task #13. ADR-00004 already asserts "there is no
     cross-tenant state sharing in the database schema"; the design must make that assertion
     structurally enforceable, not just policy.

3. **API authorization scoping.** Every read and write API endpoint must either scope its results
   by tenant id or explicitly declare why it does not (e.g., the `/healthz` and `/readyz` endpoints
   are tenant-agnostic by design). The design must address: how the service derives the effective
   tenant id from the authenticated principal; how a tenant id mismatch or absent tenant id is
   handled; whether a super-admin role is permitted to query across tenant boundaries for operational
   purposes, and if so, what audit evidence is required for that access.

4. **Artifact store isolation.** Artifact objects are currently stored in S3-compatible object
   storage by immutable key (PR-3 of the containerization plan). The design must specify the key
   namespace: whether object keys carry a tenant prefix, whether tenant A can construct or guess a
   key that resolves to tenant B's artifact, and how the worker verifies the artifact's tenant
   binding before using it in a publish run.

5. **Infisical credential boundary.** The control-plane plan's PR-1 already requires
   deployment-scoped Infisical credential files (pattern: `{deploymentId}-infisical-client-id`,
   `{deploymentId}-infisical-client-secret`) and multi-tenant lookup tests that prove two
   deployments can use different Infisical site URLs, projects, environments, and credential files
   on the same instance. The deployment secret metadata schema (`DeploymentInfisicalRuntimeConfig`)
   already carries per-deployment `siteUrl`, `projectId`, and `environment` fields. The design must
   formalize how the worker resolves credentials for a tenant's deployment without access to any
   other tenant's credential files, and how the credential directory is structured to make
   accidental cross-tenant file access structurally impossible rather than convention-dependent.

6. **Audit trail isolation.** Per task #17, audit records must be scoped and queryable by
   deployment id and environment stage before multiple teams share one control-plane instance. The
   design must specify: whether audit rows carry an explicit tenant id column; how the
   `GET /api/v1/audit-events` route enforces tenant scope so that tenant A cannot enumerate tenant
   B's audit events; and whether any cross-tenant audit surface is permitted for compliance or
   operational review, and under what constraints.

7. **Read API and web UI isolation.** The read APIs (`GET /api/v1/read/status`,
   `GET /api/v1/read/queue`, `GET /api/v1/read/deployments/{deploymentId}`,
   `GET /api/v1/read/auth-context`) and the web UI (task #22) must not leak tenant A's queue
   entries, deployment state, or stage history to tenant B. The design must specify the query
   filter applied at each endpoint and whether the RLS boundary (if adopted) is the enforcement
   mechanism or whether application-layer filtering is the primary guard.

8. **Onboarding and provisioning model.** How is a new tenant registered? Who can register a new
   tenant (only a viberoots admin, or any authenticated organization)? What control-plane objects
   are created at registration time (a tenant row, a credential-directory subdirectory, Infisical
   project bootstrap, auth-provider org membership)? What prevents a partially-provisioned tenant
   from submitting deployments before their credential boundary is fully established?

The design should reference ADR-00004 and the existing per-deployment isolation rules throughout,
making clear which invariants already hold at the deployment-id layer and which new invariants must
hold at the tenant-organization layer above them.

## Why Now

The containerization plan's PR-1 already mentions multi-tenant Infisical credential lookup and
requires a test proving "two deployments can use different Infisical site URLs, projects,
environments, and credential files on the same control-plane instance." The control-plane plan's
stated runtime requirement is explicit: "the containerized runtime must support both a dedicated
control plane for one Infisical account and a shared control plane that hosts deployments using
multiple Infisical accounts, projects, site URLs, and Universal Auth identities."

That requirement is in scope for the infrastructure being built now. If the database schema and API
authorization model land without a tenant isolation design, retrofitting RLS, tenant columns, and
scoped query filters after the fact is significantly more expensive and risky than designing for
them from the start. Task #17 (unified audit logging) already records a direct dependency on this
task: "before multiple teams can share one control-plane instance, each team's audit records must
be scoped and queryable by deployment id and environment stage."

Task #6 (auth provider) is a prerequisite because tenant identity flows from the authenticated
principal's organization claim. Until the auth-provider abstraction lands with a stable
organization-id claim, the tenant identity source is undefined. Task #4 (containerize control
plane) is a prerequisite because the Postgres schema shape, artifact store key namespace, and
credential directory structure are all being established in that work; the multi-tenant design must
inform those decisions before the relevant PRs are merged, not after.

Making viberoots public (#43) requires that the control plane not expose one organization's
deployment state, secrets, or audit records to another. That guarantee cannot be declared until
this design exists and is accepted.

## Risks

- **Design is premature without a real second tenant.** The first multi-tenant scenario is
  viberoots itself plus Bob's org. If Bob's onboarding (task #24) is delayed, the design may be
  produced for a hypothetical tenant rather than a concrete one. Mitigation: scope the design to
  cover exactly the viberoots + one external org case first, with explicit placeholders for
  what changes when a third tenant is added.

- **Auth provider org claim is not yet stable.** The design must ground tenant identity in a
  specific claim from the auth provider, but task #6 has not yet resolved whether that provider is
  Supabase Auth or WorkOS, and their organization primitives differ materially (Supabase: team
  membership; WorkOS: organization with SSO). A design that assumes one provider's org model may
  require rework if the other is selected. Mitigation: define the tenant id as a control-plane
  concept bound to an auth-provider org claim at login time, with the specific claim name as a
  runtime config parameter rather than a hardcoded path.

- **RLS complexity in Postgres.** Row-level security is powerful but adds query-plan complexity
  and requires every table to be designed with the tenant column and the RLS policy in mind. A
  table added without an RLS policy reverts to unscoped reads. Mitigation: if RLS is chosen, the
  design must specify a post-migration check (analogous to the `rls_tenant_isolation` post-apply
  check already defined for application-layer deployments in tasks #13 and PR-21 of the
  external-deployments plan) that runs as a deployment-blocking check on every schema migration.

- **Separate database per tenant changes the operational model significantly.** A separate Postgres
  database or Supabase project per tenant eliminates cross-tenant data access structurally but
  multiplies the number of managed dependencies, migration surfaces, and connection pools. For a
  small initial tenant set this may be acceptable; at scale it creates operational overhead. The
  design must explicitly evaluate this trade-off and record a decision with a stated review trigger
  (e.g., "revisit at five tenants").

- **Artifact key namespace changes are breaking.** If PR-3 of the containerization plan lands with
  an artifact key namespace that does not include a tenant prefix, and this design later concludes
  that a tenant prefix is required, renaming existing keys in S3-compatible storage is non-trivial
  (objects are immutable by key; renaming requires copy-then-delete with careful lineage tracking).
  Mitigation: the design should be produced before or in parallel with PR-3 so the key namespace
  is agreed before any production artifacts are written.

## Trade-offs

- **Row-level security vs. application-layer filtering.** RLS enforced at the Postgres level makes
  cross-tenant data access a database error rather than a query-filter bug. It also adds schema
  design overhead: every table needs a tenant column, every query must set the RLS context variable,
  and integration test fixtures must simulate the RLS environment. Application-layer filtering is
  simpler to implement and test but depends on every query path being correct; a missing filter is
  a silent data leak rather than a database error. The existing `rls_tenant_isolation` post-apply
  check pattern (used for application-layer databases in tasks #13 and PR-21) suggests the repo
  already treats RLS as the preferred enforcement mechanism for tenant-scoped tables.

- **Shared schema with tenant column vs. separate schema per tenant.** A shared schema with a
  `tenant_id` column on every row is simpler to migrate and operate (one connection pool, one
  migration path). Separate schemas per tenant provide physical isolation at the schema boundary
  but require per-tenant migration runs, per-tenant connection strings or search-path switching,
  and a more complex onboarding flow. The control-plane plan's non-goal list includes "no
  production-managed local Postgres profile in the first implementation," which suggests a shared
  schema with RLS is the preferred starting point for the control-plane database.

- **Tenant-scoped artifact key prefix vs. content-addressed key.** Content-addressed keys (e.g.,
  SHA-256 of artifact content) are naturally deduplicated across tenants but leak information about
  whether two tenants submitted identical artifacts. Tenant-prefixed keys eliminate that information
  channel but forfeit cross-tenant deduplication. For a deployment system where artifacts include
  tenant-specific secrets or provider config, content-addressed cross-tenant sharing is not safe;
  tenant-prefixed keys are the correct default.

- **Admin cross-tenant visibility vs. strict per-tenant read isolation.** An operations admin
  monitoring the full queue or auditing across tenants is a legitimate use case. Granting that
  visibility through a super-admin role weakens the tenant isolation guarantee if the role is
  broad. Granting it through an explicit, audited cross-tenant read action preserves isolation while
  allowing legitimate operations. The design must choose a model and record the audit requirement
  for any cross-tenant read.

## Considerations

- ADR-00004 states "there is no cross-tenant state sharing in the database schema." This task must
  make that assertion structurally verifiable: either through RLS policies that are checked by a
  post-migration gate, or through a documented structural separation (separate schema/database)
  with a stated review trigger. An assertion in an ADR without a structural enforcement mechanism
  is a policy statement, not an invariant.

- The `DeploymentInfisicalRuntimeConfig` type (fields: `siteUrl`, `projectId`, `environment`,
  `machineIdentityClientIdFileName`, `machineIdentityClientSecretFileName`) already exists in
  `build-tools/tools/deployments/deployment-secret-metadata.ts` and carries the per-deployment
  Infisical identity. The multi-tenant design should use this as the existing foundation for the
  Infisical credential boundary, rather than introducing a parallel tenant-level credential
  abstraction that could conflict with it.

- The control-plane plan's PR-1 acceptance criterion — "one control-plane instance can resolve
  credentials for deployments using different Infisical accounts without global tenant defaults" —
  must remain valid under the design. The design must not introduce a global tenant-level Infisical
  account assumption that contradicts per-deployment credential scoping.

- The audit logging design (task #17) records that audit records must be scoped by deployment id
  and environment stage. The multi-tenant design should decide whether `deployment_id` is a
  sufficient tenant discriminator in the audit table (given that deployment ids are globally unique
  within one control-plane instance) or whether an explicit `tenant_id` column is also required for
  operational querying.

- If the design concludes that Postgres RLS is the enforcement mechanism, it should specify the
  exact RLS policy shape for at least the submissions, deploy records, stage state, and audit rows
  tables, as a concrete starting point for the implementation. The post-apply check should be
  analogous to the `rls_tenant_isolation` check already defined for application-layer deployments.

- The design should explicitly address the viberoots-using-viberoots case: viberoots's own
  deployments are managed through the same control-plane instance that serves external tenants.
  This is not just a theoretical scenario. The design must specify whether viberoots's internal
  tenant is provisioned through the same onboarding path as external tenants, and what prevents
  the viberoots admin role from being conflated with the control-plane super-admin role.

- No implementation should begin in parallel with this design task. Implementation PRs in the
  containerization plan that touch the database schema (particularly schema migrations and the
  artifact store key scheme) should be held or explicitly scoped to avoid decisions that the design
  must later reverse.
