# 30. Migration/Versioning Conventions for Infra + DB

**Tier:** Process & Governance
**Priority:** 30 of 44
**Depends on:** #4 Containerize Control Plane, #5 Kubernetes / OpenTofu Deployment
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Define and document consistent conventions across migration surfaces: SQL application migrations, the control plane Postgres schema, versioned JSON payloads, and NixOS module option deprecations.

## What

Define and document the naming, numbering, application, and validation rules for every category
of schema or infrastructure change in the repo. Three distinct migration surfaces are in scope:

**1. Application database SQL migrations (Supabase Postgres)**

The repo already has a working migration bundle mechanism but no written conventions for authors
of new migrations. `platform-db/migrations/` and `example-db/migrations/` are Buck `filegroup`
targets labeled `kind:migrations` and `deployment:migration-set`. The `migration_bundle` rule in
`build-tools/deployments/migration_bundle_rules.bzl` assembles them into a deterministic bundle
artifact whose `manifest.json` carries `schema_version: "deployment-migration-bundle@1"` and an
`ordered_migration_sets` list that is the authoritative apply order. The production adapter in
`foundation-migration-production.ts` delegates to a `supabase-migration-runtime` binary that has
not yet been pinned as a Nix derivation. The `FoundationMigrationOutcome` type records
`migrationList`, `dependencyGraphFingerprint`, and `bundleIdentity` for every apply run.

What is missing is a written convention for the people adding SQL files:

- File naming and numbering scheme (the bundle rule currently derives order from Buck dependency
  declaration, not from filename; this must be documented explicitly so authors know which governs)
- Rules for backward-compatible vs. destructive changes — the deployment system already enforces
  that `release_actions` must declare one of `backward_compatible`, `forward_only`,
  `reversible`, or `manual_recovery_required`, and that destructive changes must fail closed unless
  a separately reviewed destructive-intent workflow is present; this must be surfaced as a plain
  authoring rule
- The prohibition on applying ad hoc SQL outside the migration bundle to any environment (doing
  so will cause the post-apply `migration_ordering` check to fail on the next reviewed apply)
- When and how to write a reviewed destructive exception in deployment metadata before a
  destructive migration can be admitted to a protected/shared environment
- The `supabase-migration-runtime` binary must be a reviewed Nix derivation in the foundation
  deployment package before any protected/shared apply; document what that means and where it goes

**2. Control-plane Postgres schema (the deployment control plane's own database)**

The control-plane schema is defined as a single TypeScript string in
`build-tools/tools/deployments/nixos-shared-host-control-plane-backend-schema.ts`. It is applied
at process startup by `initializeBackendSchema` in
`nixos-shared-host-control-plane-backend-db.ts`, which simply runs the entire SQL string via
`pool.query`. New columns are added with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` mixed
directly into the same string alongside the original `CREATE TABLE IF NOT EXISTS` statements.
There is no migration version tracking table, no numbered migration files, and no migration tool
such as goose or golang-migrate. The current approach works for an in-process schema that is
applied idempotently on startup, but it has no mechanism for detecting whether a running
database is at the current schema or a prior version, and it offers no rollback story.

When the control plane moves to a real external Postgres target (task #4's cloud migration phase),
this startup-time approach needs to be audited and either validated as sufficient or replaced.
The conventions needed:

- A decision on whether the current approach (idempotent DDL in one string applied at startup)
  is the reviewed long-term model, or whether a migration-tracking table and numbered SQL files
  are required for the external Postgres case
- If a tracked migration tool is adopted, a naming and numbering convention for those SQL files
  that is compatible with the chosen tool (e.g., goose's `NNNN_description.sql` convention or
  the Supabase CLI's own sequential numbering)
- A compatibility policy for rolling deploys: when a new control-plane image ships a schema
  change, both the old and new image versions must be able to run against the migrated database
  until the old replicas drain; the current `ADD COLUMN IF NOT EXISTS` pattern implies
  backward-additive changes only, and that constraint must be written down
- Documentation of what must happen if a non-additive change (column rename, table restructure)
  is ever needed

**3. Versioned JSON payloads stored by the deployment system**

The deployment system already has a working versioning convention for JSON documents: every
persisted payload must include a `schemaVersion` (or `schema_version`) field. Readers either
handle the stored version explicitly, migrate it via a keyed migration map, or fail closed with
a clear incompatibility error. The design spec states this rule explicitly:

> schema versions must be explicit values in the stored payload, not only implied by table
> names, code versions, or migration timestamps

The `readVersionedJson` helper in `deployment-schema-compat.ts` implements the read-time
migration pattern. Concrete examples already in production:

- `nixos-shared-host-record-compat.ts` registers `deploy-record@2026-04-04` and
  `deploy-record@2026-04-08` → current `deploy-record@2026-04-10`
- `vercel-records.ts` registers `vercel-deploy-record@2026-05-02` → current
  `vercel-deploy-record@2026-05-03`
- `app-store-connect-records.ts` registers `deploy-record@2026-04-09` → current
  `deploy-record@2026-04-10`

The convention string format is `<kind>@<date>` (e.g., `deploy-record@2026-04-10`) or
`<kind>@<integer>` (e.g., `nixos-shared-host-replay-snapshot@3`, `google-play-replay-snapshot@2`).
Both forms are in active use. The two-form situation should be resolved into one explicit rule.

What is missing:

- A written decision on when to use `@<date>` vs. `@<integer>` for schema version strings
- A rule for when a version bump is required vs. optional (is adding a nullable field a bump?)
- A rule for how long old migration functions must be kept before they can be deleted
  (there are currently live migration records on the control-plane Postgres that readers must
  still be able to decode)
- Documentation of the `readVersionedJson` pattern as the canonical approach, so future
  payload authors do not reinvent ad hoc schema checks

**4. NixOS module option versioning**

The NixOS container module at
`build-tools/tools/nix/deployment-control-plane-container-module.nix` is substantially written
and defines the option schema for the control-plane service (credential patterns, worker count,
nginx gate, etc.). As the module evolves, options may be renamed or removed. NixOS provides
`mkRenamedOptionModule` and `mkRemovedOptionModule` for backward-compatible option changes, but
no current conventions govern whether those helpers are required, when a module option change is
breaking, or what deprecation period is expected. This is a smaller surface but it matters
whenever a host configuration imports the module and the module's option shape changes.

**The deliverable for this task is a written conventions document** — analogous in style to
`docs/deployments-contract.md` and `docs/contributor-naming-conventions.md` — that captures
the rules above and points to the existing implementation files as examples. The document does
not implement anything; it makes the implicit conventions explicit so that contributors adding
migrations, schema changes, or NixOS module options have a single reviewed reference.

## Why Now

Task #4 (Containerize Control Plane) will move the control plane's own Postgres from a local
self-hosted instance to an external managed database. That transition involves a live migration of queue
rows, audit records, stage state, and submission history. A botched or partial migration during
that Phase 2 cutover could leave the control plane in an inconsistent state mid-deployment.
Having written conventions before that work starts means the migration is designed against a
reviewed model rather than improvised.

Task #5 (Kubernetes/OpenTofu) introduces OpenTofu as the infra provisioner. OpenTofu stacks have
their own state and their own lifecycle. Conventions for what counts as a breaking infrastructure
change — and how it must be staged — belong in writing before operators start recording and
applying plan artifacts against live environments.

The application database (task #13, Supabase DB Deployment) already has placeholder SQL files
and a working bundle/apply path. Real schema will land in `platform-db/migrations/` and
`example-db/migrations/` as soon as the Supabase project is provisioned. Without conventions,
the first real migration is likely to be written in whatever style the author prefers, setting a
precedent that is hard to change later.

The control plane's `deployments-contract.md` already requires that versioned payload contracts
exist at the boundary between Buck extraction, the CLI, and the control plane. It explicitly
states that schema versions must be explicit values in the stored payload. That rule is enforced
by code but is not explained to contributors in plain language anywhere. Without explanation,
the next person to add a new payload type will look at existing files and may choose the wrong
version string format or omit migration support entirely.

Priority 27 is appropriate: everything that writes new rows to the control-plane database or adds
new SQL files is upstream of this, and task #37 (backup/DR) needs to know the schema version at
restore time.

## Risks

**Control-plane schema change during cutover.** The current idempotent-startup approach works
because the control plane owns its database exclusively. If a schema change ships in a new image
at the same time as the self-hosted-to-cloud cutover, the window in which both old and new replicas
coexist on the same database could expose a compatibility gap. The conventions document must
address this explicitly: either require backward-additive-only schema changes or require a
separate schema migration step before the new image starts serving traffic.

**Bundle ordering is by Buck dependency, not filename.** The `migration_bundle_rules.bzl` rule
derives `ordered_migration_sets` from the order of entries in `migration_sets` (which is
determined by Buck dependency declaration), not from any filename prefix. A contributor who adds
a SQL file named `002_foo.sql` and assumes it runs second because of the filename number will be
wrong if the Buck dependency order differs. The conventions must make the authoritative ordering
mechanism explicit and forbid relying on filename-derived order.

**Destructive migrations in protected/shared environments.** The `foundation-migration.ts`
runtime requires a reviewed destructive exception, but the exception mechanism is not yet
documented for SQL migration authors. Until it is, a developer facing a legitimate schema change
(column removal, table rename) may not know how to get it reviewed and admitted, which could
encourage workarounds.

**`supabase-migration-runtime` binary is ambient PATH.** Until the binary is declared as a
reviewed Nix derivation in the foundation deployment package, any protected/shared migration apply
run depends on whatever binary happens to be on `PATH` at the `provision` step. A conventions
document that includes this as a hard requirement before any protected/shared apply creates a
clear gate.

**Two version string formats coexist.** Some schema constants use `<kind>@<date>` (e.g.,
`deploy-record@2026-04-10`) and others use `<kind>@<integer>` (e.g.,
`nixos-shared-host-replay-snapshot@3`). Both are valid today. Without a rule, future payloads
will continue to mix formats, and migration-function maps (which key on exact version strings)
become harder to audit.

## Trade-offs

**Document-only task vs. also fixing the control-plane schema approach.** This task is scoped
to writing conventions, not to migrating the control-plane backend schema to a tracked tool.
A tracked migration tool (goose, golang-migrate) would add operational overhead and require
a migration version table in the control-plane database. The document-only scope deliberately
defers that choice so it can be made with full context during task #4's cloud migration phases
rather than speculatively now. The conventions document should, however, make the requirement
for a decision explicit so that task #4 does not simply repeat the current startup-time approach
without conscious review.

**Single conventions document vs. embedding rules in existing docs.** The rules could be
added to `docs/deployments-contract.md`, `docs/deployments-schema.md`, and
`docs/contributor-naming-conventions.md` individually. Spreading them across three docs risks
partial coverage and makes the rules hard to find. A dedicated migration/versioning document
(like this task produces) gives contributors a single place to look and is consistent with how
the repo handles other cross-cutting standards (ADR-00007 for IaC, `docs/deployments-contract.md`
for deployment behavior).

**Addressing NixOS module option versioning now vs. later.** The NixOS module is substantially
written (task #4 PR-8) but not yet exercised on multiple real hosts. NixOS module option
breaking changes are low-frequency at this stage of the project, so the conventions for this
surface can be lightweight and defer to standard NixOS patterns (`mkRenamedOptionModule`) rather
than requiring a full versioning scheme.

## Considerations

- The authoritative ordering mechanism for migration sets is the Buck dependency graph declared
  in `migration_sets` attrs, not the SQL filename. The conventions document must say this plainly
  and include a worked example of declaring a new migration target in `TARGETS` with the correct
  dependency edge.

- The `readVersionedJson` helper in `build-tools/tools/deployments/deployment-schema-compat.ts`
  is the canonical pattern for reading versioned JSON payloads. Any new payload type should use
  it rather than hand-rolling a version check. The conventions document should point to it and
  show a minimal example of registering a migration function.

- The `deployments-contract.md` rule "schema versions must be explicit values in the stored
  payload, not only implied by table names, code versions, or migration timestamps" is already
  authoritative. The conventions document does not need to restate it — it should cite it and
  provide the implementation guidance that makes the rule actionable.

- The `data-compatibility` posture on `release_actions` (`backward_compatible`, `forward_only`,
  `reversible`, `manual_recovery_required`) is the deployment system's existing mechanism for
  declaring whether a stateful action (such as a schema migration) is safe to roll back. SQL
  migration authors need to understand that a `release_action` of type schema migration
  classified as `forward_only` will block rollback in protected/shared environments unless a
  reviewed exception is present.

- The post-apply checks (`rls_tenant_isolation`, `composite_tenant_fk`, `migration_ordering`,
  `required_extension_settings`) run automatically after every successful foundation migration
  apply. The conventions document should describe what each check validates in enough detail
  that a schema author knows what SQL patterns will fail them.

- There is no existing task for backup/DR (the described task #37 does not yet exist in the
  task directory). The conventions document should note that restore-to-a-prior-schema-version
  semantics are outside the current migration model and flag that the backup/DR work will need
  to establish those semantics explicitly.

- The `sprinkleref --check` requirement before any protected/shared foundation migration apply
  means that adding Supabase service-role credential contract IDs to Infisical is a prerequisite
  to the first real (non-placeholder) migration apply. The conventions document should include
  this as a pre-apply checklist item, consistent with how `docs/tasks/13-supabase-db-deployment.md`
  describes it.
