# 39. Ragie Provisioning / Simple Integration

**Tier:** Advanced Capabilities
**Priority:** 39 of 44
**Depends on:** #4 Containerize Control Plane, #13 Supabase DB Deployment
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Bootstrap the Ragie account, register the API key in Infisical via SprinkleRef, create `projects/libs/platform-ragie/` with the partition-per-tenant client, and validate ACL filter semantics against a live partition.

## What

The question mark in the task name is load-bearing. Ragie is not currently absent from this
repository — it is extensively designed in. The Phase 0 architecture
(`projects/docs/phase_0_architecture.md`) commits to Ragie as the managed RAG backend for the
permissioned document retrieval product: one partition per tenant, document ingestion with
metadata-encoded ACL scopes, retrieval via pre-computed filters, webhook-driven indexing status
updates, and the Phase 0 throwaway Connect source ingestion. `platform-ragie` is a planned
`projects/libs/` package with a wrapped Ragie client; the SprinkleRef contract ID
`secret://deployments/ragie/api_key` is already registered in
`build-tools/tools/deployments/external-deployment-requirements.ts` as the `ragie`
`ExternalDeploymentRequirementProfile`. The blocking `RAGIE_` ambient-env bypass check is
implemented. Gate 1 (`projects/docs/gate-1-plan.md`) is explicitly scoped to validating Ragie ACL
filter behavior (`$in` over array-valued metadata) against a live Ragie partition.

**What this task is therefore not** is "figure out if Ragie belongs in the stack." That decision
is made and recorded in accepted architecture.

**What this task actually is** is threefold:

1. **Ragie account provisioning.** Someone must create the Ragie account/workspace, generate the
   API key, and register it in Infisical under `secret://deployments/ragie/api_key` so that
   `sprinkleref --check` passes for any deployment package that declares the `ragie` external
   requirement profile. The architecture does not describe this as an OpenTofu-managed resource —
   Ragie does not expose a Terraform/OpenTofu provider — so partition creation is a runtime act,
   done by the worker when a new tenant is provisioned, not an IaC act. The account-level API key
   is a single shared credential; partition isolation is done at the API call level. This is
   therefore an operator-side bootstrap step, analogous to how Supabase project creation is
   described in task #13 as an operator act that feeds into the deployment secret runtime.

2. **Wiring the `platform-ragie` package.** The `projects/libs/platform-ragie/` directory is
   planned but not yet created. This task's scope is the initial package: a wrapped Ragie client
   that resolves its API key through the deployment secret runtime (not ambient `RAGIE_*` env),
   exposes typed calls for partition-aware document indexing and retrieval with pre-filters, and
   enforces that callers cannot import raw Ragie SDK clients. The Gate 1 plan's PR 1 scope already
   describes this surface in detail. The `platform-ragie/connect/` subdirectory is a separate Phase
   0 throwaway concern covered by the architecture's explicit throwaway containment rules.

3. **Gate 1 live validation.** Gate 1 passes when a real Ragie call against a test partition
   confirms `$in` any-overlap semantics on `acl_scope_ids`. Until the API key is provisioned and
   `platform-ragie` exists, Gate 1 cannot run end-to-end. This task is the prerequisite that
   unblocks the Gate 1 regression path.

The "simple integration" qualifier in the task name likely signals that this task should not
attempt to implement the full Phase 0 retrieval path (tenant-leak suite, Connect ingestion, GitHub
snapshot importer, source access service). The minimum viable deliverable is: API key provisioned
in Infisical, `platform-ragie` package with the wrapped client, a test partition created, and the
Gate 1 ACL filter behavior confirmed.

## Why Now

The dependency ordering is direct. Task #4 (containerize control plane) is needed because the
data-room web and worker processes that call Ragie must have a stable container runtime and
deployment admission path before live Ragie calls are plumbed into production. Task #13 (Supabase
DB) is needed because `ragie_documents` and `ragie_citation_mappings` are platform-owned tables
that must exist before the worker can record Ragie document references and webhook states.

Without those two dependencies closed, wiring Ragie into production deployments is premature. The
call pattern from worker to Ragie is straightforward; what makes it safe is the surrounding
contract: deployment-admitted secret resolution, database-backed document state, post-Ragie
fail-closed local validation, and the tenant-leak regression suite. None of those are in place
until #4 and #13 land.

Within the Phase 0 gate sequence, Gate 1 is explicitly the first gate. No later gate (Connect
throwaway, GitHub importer, full tenant-leak suite against live Ragie) can be declared open until
the ACL encoding is validated. This task enables Gate 1, which enables everything else.

## Risks

**Ragie ACL filter behavior differs from documentation.** The architecture documents this
explicitly as a blocking risk. If Ragie's `$in` operator does not have any-overlap semantics for
list-of-string metadata, the boolean-per-scope fallback must be implemented end-to-end: metadata
builder, filter constructor, citation mapping assumptions, and post-Ragie validation all change.
The fallback encoding is designed and documented, but it increases metadata key counts and
complicates filter construction. Discovering this late (after the Connect throwaway is implemented)
requires reindexing existing documents.

**Ragie partition management is runtime, not IaC.** Because there is no OpenTofu Ragie provider,
partition creation happens at tenant provisioning time in the worker. If the worker fails to create
a partition before retrieval is attempted, retrieval fails for that tenant. The architecture relies
on Supabase state (tenant status, Ragie partition name) to gate retrieval calls, but the partition
creation step must be idempotent and audited. An untested partition-creation failure path leaves
the worker in an unclear state.

**Ragie Connect OAuth branding.** The engineering companion (`projects/docs/phase_0_engineering_companion.md`)
flags that Ragie branding may appear to the founder during Connect OAuth authorization flows. This
is an Enterprise feature requiring Ragie setup for white-labeling. If the branding is visible,
Connect demos are internal-only until the UX is routed through the platform's own UI. This is a
product risk that surfaces only with a real account, not during development against mocked clients.

**Throwaway Connect containment.** The architecture mandates that `platform-ragie/connect/` is
structurally isolated: nothing in `data-room-mcp-tools` may import from it, and every file carries
a throwaway tag. A CI boundary lint rule must enforce this before any Connect code is written.
Implementing the lint rule after Connect code exists is harder and creates a window where the
structural boundary is unenforced.

**Ragie's 1000-value metadata limit.** Each document's metadata is bounded by Ragie's internal
limits. The boolean-per-scope fallback encoding uses one key per ACL scope, which is bounded by
the number of scopes per tenant. For Phase 0 design partners, this is not a practical concern, but
any future per-document or per-view scope explosion must be evaluated against this limit before
the metadata policy is changed.

## Trade-offs

**One Ragie partition per tenant vs. per vault.** The architecture chooses one partition per
tenant and uses metadata filters for vault/section/view/ACL scoping. This minimizes partition
count (10 design partners → 10 partitions), simplifies webhook routing (partition uniquely
identifies tenant), and reduces Ragie pricing exposure. The cost is that a compromised
metadata filter could theoretically expose documents across vaults within the same tenant — which
is why the fail-closed local post-Ragie validation exists as defense in depth, and why the
tenant-leak suite must exercise this. Per-vault partitions are documented as a Phase 1 promotion
path if multi-vault tenants create pressure for stricter isolation, but this path requires
reindexing all documents.

**Ragie-managed embedding vs. self-hosted embedding.** Ragie is a managed RAG service; it owns
parsing, chunking, embedding, indexing, and reranking. The platform has no embedding model in the
production path. The architecture records this explicitly as a design principle: "No
platform-owned answer-generation model in the production path." The trade-off is that switching
away from Ragie requires reindexing all documents through a different pipeline and accepting that
quality differences are invisible until retrieval quality degrades. The architecture's mitigation
is that internal document IDs are ours (Ragie IDs are stored as provider references and never
leave the platform boundary), preserving the replacement path. This trade-off is accepted; this
task does not re-litigate it.

**Ragie holds Connect OAuth credentials in Phase 0.** The throwaway Connect implementation allows
Ragie to hold Drive, Notion, and Slack OAuth credentials. This is documented as a deliberate
Phase 0 shortcut that is one of the six triggers for the mandatory throwaway replacement. Accepting
this shortcut reduces Phase 0 implementation scope significantly (no OAuth flow for source
authorization, no source-credential rotation logic) but makes the platform unable to revoke or
rotate source-system credentials without revoking the entire Connect connection. For design
partners, acceptable; for paying customers, prohibited.

## Considerations

- The SprinkleRef contract ID for the Ragie API key is already established as
  `secret://deployments/ragie/api_key` in `external-deployment-requirements.ts`. Before any
  protected/shared deployment package that declares the `ragie` profile can be admitted, the
  corresponding Infisical path must be populated and `sprinkleref --check` must pass. This is the
  first operator act: create the Ragie account, generate the API key, register it in Infisical.

- The Gate 1 plan PR 1 scope (`projects/docs/gate-1-plan.md`) already specifies in detail what
  `projects/libs/platform-ragie` should expose for Gate 1: a wrapped client for indexing test
  documents and executing retrieval with metadata filters, dependency boundary lint rules
  preventing raw Ragie SDK imports outside the package, and a fixture path for developer
  validation that is explicitly separate from production secret resolution. Implement that scope
  before extending it.

- The `RAGIE_` ambient-env bypass check is already enforced in `ambientProviderEnvBypassErrors`
  (`external-deployment-requirements.ts`). Any deployment package declaring the `ragie` profile
  will fail validation if `RAGIE_*` env variables are present. The `platform-ragie` package must
  read credentials only through the deployment secret runtime; tests should inject a fake API key
  through the secret runtime fixture, not through environment variables.

- The `ragie_documents` and `ragie_webhook_events` tables are platform-owned (they live in
  `platform-db`), while `connector_connections` is data-room-owned (it lives in `data-room-db`
  because it references `vault_id`). Before any of this code is written, confirm these tables are
  in the placeholder migration SQL and that the RLS design is documented, because the post-apply
  `rls_tenant_isolation` check will run against them.

- The `platform-ragie/connect/` subdirectory must have its throwaway tag and boundary lint rule in
  place before any Connect code is written. Creating the directory without the lint rule creates a
  window where the structural boundary is unenforced and structural technical debt accrues silently.

- The Ragie partition name format is `prod_tenant_{tenant_id}` where `tenant_id` is a normalized
  lowercase UUID or alphanumeric key (Ragie partition names allow only lowercase alphanumeric, `_`,
  and `-`). The worker's partition-creation step must be idempotent: calling it twice for the same
  tenant must not fail or create duplicate state. The Ragie API should be checked for
  idempotent-create semantics before relying on it.

- The engineering companion's Connect branding check must be done with a real Ragie account before
  any external demo involves a Connect source (Drive, Notion, Slack). If Ragie branding appears
  in the OAuth flow, document this in the team's runbook and mark those source types as
  internal-only until the branding concern is resolved or the throwaway replacement is in place.

- `projects/docs/phase_0_engineering_companion.md` Gate 1 requires that a real Ragie call
  confirms `$in` any-overlap behavior on a test partition, and that the result is recorded in
  `phase_0_architecture.md` section 16 with evidence, date, and status. This is not optional
  documentation; it is the Gate 1 pass condition.
