# 13. Supabase DB Deployment

**Tier:** Developer / Stakeholder Enablement
**Priority:** 13 of 44
**Depends on:** #2 Supabase Project Provisioning, #5 Kubernetes / OpenTofu Deployment, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Decide whether the Supabase project is provisioned by OpenTofu or out-of-band, then wire the existing Buck migration bundle machinery to apply schema migrations on each protected/shared deploy.

## What

Provision a Supabase Postgres project as the reviewed, externally managed database backend for the
viberoots application layer — and settle the question of whether that provisioning is itself a
deployment target in the repo system, or an out-of-band operator act recorded as external
prerequisite state.

There are two things this task must accomplish even before writing a line of schema:

1. **Decide the provisioning model.** `cloud-control-design.md` identifies three legitimate roles
   for Supabase: control-plane Postgres, artifact store (Storage), and identity provider (Auth).
   For the DB/schema scope, the open question is whether creating and configuring a Supabase project
   is owned by an `opentofu-stack` provisioner in `platform-foundation-*` — which the
   external-deployments plan (PR-19) explicitly describes — or whether a bare Supabase project is
   stood up by an operator once and then treated as an external prerequisite. The plan currently
   describes the latter as acceptable for Phase 0 but the former as the reviewed long-term model.

2. **Wire the migration bundle and apply runtime.** The repo already has the full infrastructure:
   `platform-db/migrations/` and `data-room-db/migrations/` are Buck `filegroup` targets with
   `kind:migrations` and `deployment:migration-set` labels; `migration_bundle_rules.bzl` assembles
   them into a deterministic bundle artifact; `foundation-migration.ts` defines the
   `FoundationMigrationAdapter` interface, `runFoundationMigrationApply`, and the post-apply check
   contract; `foundation-migration-production.ts` implements the production adapter that delegates
   to a `supabase-migration-runtime` binary. What is missing is: (a) the concrete deployment
   packages under `projects/deployments/platform-foundation-{dev,staging,prod}/` that attach the
   migration bundle artifact, (b) the `targetSupabaseIdentity` values for those environments, and
   (c) the reviewed `secret_requirements` that give the foundation-migration apply step access to
   Supabase service-role credentials through the deployment secret runtime.

The migration apply step runs at the `provision` lifecycle step. Supabase service-role credentials
must be declared as `secret_requirements` scoped to `provision` and resolved through the reviewed
secret runtime — never from ambient environment variables. Post-apply checks (`rls_tenant_isolation`,
`composite_tenant_fk`, `migration_ordering`, `required_extension_settings`) run automatically after
each successful apply and are recorded in the deployment outcome.

The actual migration SQL is placeholder-only at this point (`select 1;` in both
`platform-db/migrations/001_platform_foundation.sql` and
`data-room-db/migrations/001_data_room_foundation.sql`). This task does not require real schema;
it establishes the reviewed provisioning path and the wiring so that real schema additions flow
through the same deployment model.

## Why Now

The control plane itself needs an external Postgres database. `cloud-control-design.md` Phase 1
("Prove external persistence") is explicitly: "Create a managed Postgres target, likely Supabase
Postgres." Phase 2 is "Point the legacy self-hosted service and workers at external Postgres."
Without a provisioned and tested Supabase Postgres target, Phase 1 and 2 cannot close, the legacy
self-hosted control-plane host cannot be made cloud-shaped, and task #4 (Containerize Control Plane)
cannot reach its cut-over gates.

On the application side, any service that reads or writes durable state — the data-room web and
worker services downstream of this task — cannot be tested against a real schema until the Supabase
project exists and the migration bundle has been applied at least once to a dev environment.

The migration bundle infrastructure is already built. The deployment package wiring (PR-19 in the
external-deployments plan) and the apply runtime (PR-21) are both designed and scaffolded. This
task is the operator-facing prerequisite that creates the managed resource those PRs consume.

## Risks

**Provisioning model ambiguity is the primary risk.** `cloud-control-design.md` lists
`supabase-db-migration` and `supabase-storage-static` as future provider entries that "need explicit
provider capability entries before protected/shared use" but does not establish them yet. The
external-deployments plan has `platform-foundation-*` wire Supabase provisioning through an
`opentofu-stack` provisioner (PR-19) and the apply runtime through PR-21 — but if the OpenTofu
Supabase provider's capabilities or state management are insufficient for the environment, the
foundation deployment package may need a different shape. Committing to a Supabase project identity
before the provisioner is reviewed locks in a name that may be hard to change.

**State backend and bootstrapping.** Creating a Supabase project creates a Postgres instance with a
stable connection string. That connection string becomes the external state for the control-plane
database and the target for migration apply. If the OpenTofu stack that provisions the Supabase
project uses Supabase Storage as its own state backend, there is a circular dependency: the bucket
cannot exist until the project is provisioned. The safe path is an external state backend (R2 or
S3) for the OpenTofu stack that creates the Supabase project.

**Migration ordering invariants.** The post-apply `migration_ordering` check enforces that
migrations applied to dev, staging, and prod are consistent and applied in reviewed order. Applying
ad hoc SQL outside the migration bundle to a dev Supabase project — to test a schema idea before it
is committed — will cause the ordering invariant check to fail on the next bundle apply. This is
correct behavior but requires operator discipline.

**Destructive migrations.** The apply runtime (`foundation-migration-production.ts`) requires a
reviewed destructive exception before any migration that drops tables, columns, or constraints. The
current Supabase migration binary interface has no built-in destructive detection; detection happens
at the deployment admission layer. Any column removal or table rename requires an explicit reviewed
exception in deployment metadata before the apply step runs in a protected/shared environment.

**Supabase Storage S3 compatibility.** `cloud-control-design.md` calls out that Supabase Storage
must pass a live compatibility test against the `ControlPlaneArtifactStore` implementation before
it is selected as the artifact store. This is a separate concern from the DB provisioning, but if
Supabase Storage is adopted alongside Supabase Postgres, both must be tested together. A failure in
Storage compatibility discovered late would require switching to R2 or S3 while the DB provisioning
is already locked in.

## Trade-offs

**Supabase project per environment vs. shared project with schemas.** The deployment model requires
`environment_stage` isolation: control-plane state is keyed by `(deployment_id, environment_stage)`
and RLS tenant isolation must be per-deployment. The cleanest model is a separate Supabase project
for dev, staging, and prod — matching the `platform-foundation-dev`, `platform-foundation-staging`,
`platform-foundation-prod` deployment package structure already described in PR-19. A single shared
project with per-environment schemas is harder to reason about for RLS isolation and creates a blast
radius across environment stages that ADR-00004 explicitly prohibits by default.

**OpenTofu Supabase provisioner vs. operator-created project.** Using an `opentofu-stack` provisioner
to create the Supabase project is the reviewed long-term model (PR-4, PR-19) and ensures the project
configuration is version-controlled, admitted, and replayable. The simpler alternative — an operator
creates the project in the Supabase dashboard, records the project reference as deployment metadata,
and uses the foundation migration apply path only for schema — avoids the OpenTofu Supabase provider
dependency for Phase 0. The trade-off is operational reproducibility: a manually created project
cannot be recreated from the repo alone.

**Control-plane DB vs. application DB.** The control plane itself needs an external Postgres target
(`cloud-control-design.md` Phase 1). It can share a Supabase project with the application layer or
use a separate one. Sharing a project reduces managed dependencies but couples control-plane schema
migrations to application schema migrations. Because the control-plane database has strict
ownership semantics (only the control-plane service and workers write to it), separating it from
the application Postgres is safer. This task should confirm which Supabase project the control
plane will use before the Phase 1 gate closes.

## Considerations

- The `targetSupabaseIdentity` field used in `runFoundationMigrationApply` and recorded in
  `FoundationMigrationOutcome` must be a stable, reviewed identifier for the Supabase project —
  not the connection string itself. The connection string (with the service-role key) is a
  `secret_requirements` value resolved through the deployment secret runtime at the `provision`
  step. The identity is a separate reviewed metadata field in the deployment package.

- The `VBR_SUPABASE_MIGRATION_BIN` / `VBR_DEPLOY_SUPABASE_MIGRATION_BIN` environment variable
  in `foundation-migration-production.ts` resolves the migration binary. This binary is not yet
  pinned through the Nix model. Before any protected/shared migration apply run, the
  `supabase-migration-runtime` binary must be declared as a reviewed Nix derivation in the
  foundation deployment package, not resolved from ambient `PATH`.

- The post-apply RLS check (`rls_tenant_isolation`) validates that every application table with
  tenant-scoped rows has Row Level Security enabled with the correct policy. The current migration
  SQL is placeholder-only. Before real schema lands, the RLS policy design must be agreed for every
  table so that the post-apply check can verify it without manual operator inspection.

- `sprinkleref --check` must show no missing deployment secrets for the foundation deployment
  before any protected/shared migration apply is attempted. The Supabase service-role credential
  contract IDs (`secret://deployments/platform-foundation-<env>/supabase/service_role_key` or
  equivalent) must be registered in Infisical and verified by `sprinkleref` before the apply step
  runs.

- The external-deployments plan PR-21 is the implementation PR for the apply runtime wiring. This
  task is the prerequisite operator act: provision the Supabase projects, register secret contract
  IDs, and confirm `targetSupabaseIdentity` values so that PR-19 and PR-21 have concrete values to
  wire against.

- Supabase Auth provisioning (task #6) may result in deploying to the same Supabase project that
  owns the application DB. If so, the Supabase project identity and the auth issuer URL will be
  linked. That linkage should be explicit in reviewed metadata, not implicit in a shared project
  dashboard.
