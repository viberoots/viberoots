# Phase 0 Repo Build And Deployment Companion

**Date:** April 27, 2026  
**Companion to:** `phase_0_architecture.md` and `phase_0_engineering_companion.md`  
**Purpose:** Describe how the Phase 0 architecture should be adapted to this repository's layout, build system, and deployment model without changing the runtime architecture.

This document is intentionally narrower than the architecture. It does not replace the product or security design. Its job is to explain how the existing repo machinery should wrap that design so reviewers can tell where code, build targets, deployment targets, secrets, promotion rules, and deploy-blocking gates belong.

## 1. Summary

The Phase 0 runtime architecture stays as written:

```text
Vercel-hosted Next.js console
+ container-hosted data-room-web process
+ container-hosted data-room-worker process
+ WorkOS
+ Supabase
+ Ragie
+ OpenTofu-managed infrastructure
```

The adaptation is about repository shape and delivery mechanics:

- use `projects/apps` for deployable TypeScript processes
- use `projects/libs` for explicit package boundaries
- use `projects/deployments` for first-class deployment metadata
- keep project-specific infrastructure under deployment packages rather than a separate top-level `infra` tree
- build deployable artifacts through Buck/Nix rather than provider-side ad hoc builds
- publish through the repo-level `deploy` front door
- encode secrets, runtime config, OpenTofu provisioning, smoke checks, promotion, rollback, and deploy-blocking readiness gates in deployment metadata and CI
- use `SprinkleRef` as the stable secret contract and Vault as the production secret backend
- add a Vercel deployment provider so the console can stay on Vercel while still participating in the repo's deployment model

This keeps app-specific code out of platform-named packages while making the first application's boundary explicit. The split is a one-way CI-enforced import rule, not a multi-app framework: no `app_templates`, no recipes, no plugin registry. Platform packages contain whatever the data-room app currently needs from them; they grow when data-room needs new platform capabilities, not in anticipation of a second app.

## 2. What Should Not Change

This proposal does not change the load-bearing architecture:

- The console remains a Vercel-hosted Next.js app.
- Vercel API routes remain thin authenticated proxy routes. They do not own policy logic.
- The platform web process remains the public security boundary for MCP, console REST policy, Source Access, branded source redirects, and Ragie webhooks.
- The worker process remains a second process type in the same TypeScript codebase, responsible for ingestion, Ragie follow-up, lifecycle jobs, and cleanup.
- Supabase remains the source of truth for tenant state, ACL scope grants, agent connections, jobs, audit, and RLS.
- Ragie remains the retrieval provider, one partition per tenant.
- OpenTofu remains responsible for infrastructure provisioning such as DNS, runtime resources, secrets plumbing, Supabase resources, and S3/R2 state, but that provisioning is invoked through deployment-owned metadata rather than a separate project-specific `infra` tree.

The important distinction is that the repo deployment model does not replace Vercel, the container runtime, or OpenTofu. It coordinates them.

## 3. Naming And Package Boundaries

The architecture is a permissioned document retrieval platform whose Phase 0 application is a data room. Names are therefore platform-neutral for shared runtime and infrastructure concepts, and app-specific for data-room concepts such as vaults, sections, views, investor workflows, and data-room MCP tool names.

Both `projects/apps` and `projects/libs` stay flat. App-specific libraries are allowed under `projects/libs`; they are distinguished by clear names and dependency-boundary rules, not by nesting them under an `apps/` directory.

Recommended layout:

```text
projects/
  apps/
    data-room-console/    # Vercel Next.js management console
    data-room-web/        # MCP + REST + Source Access + Ragie webhook endpoint
    data-room-worker/     # ingestion + Ragie sync + lifecycle jobs

  libs/
    platform-domain/      # Tenant, identities, agent connections, scopes, grants
    platform-db/          # platform-owned tables, migrations, RLS test helpers
      migrations/         # tenants, agent connections, scopes, jobs, audit, source-access
      rls-tests/
    platform-auth-workos/ # AuthKit session verification + MCP token verification
    platform-authz/       # generic authz primitives: scope intersection, agent bounds,
                          # tenant-status checks, tool-scope verification
    platform-ragie/       # wrapped Ragie client and Ragie document sync
      connect/            # Phase 0 throwaway Connect implementation, isolated and tagged
    platform-github/      # GitHub App auth, installation-token minting, repo tree/content reads
    platform-source-access/ # grants, branded redirect handler, signed URL issuance
    platform-audit/       # audit_events and retrieval_events writers (the rail)
    platform-storage/     # Supabase Storage wrapper
    platform-rate-limit/  # tenant/user/agent rate limits
    platform-mcp-runtime/ # MCP auth/session/tool-catalog runtime primitives
    platform-jobs/        # platform_jobs runner, leases, idempotency
    platform-test-fixtures/ # shared tenant/agent/security fixtures (no vault/view)

    data-room-domain/     # Vault, Section, View, Document, Citation app types
    data-room-db/         # data-room-owned tables, migrations, RLS test helpers
      migrations/         # vaults, sections, documents, views, view-scopes, access-requests,
                          #   connector-connections, github-repository-connections
      rls-tests/
    data-room-authz/      # resolveRetrievalConstraints, resolveSourceAccess,
                          #   resolveReviewPreview, view inference, base-view inheritance
    data-room-mcp-tools/  # list_vaults, list_data_room_sections, search/fetch tools
    data-room-console-api/ # REST route handlers for the data-room console; imported
                          #   by apps/data-room-web at startup
    data-room-ingestion/  # data-room document ingestion policy and defaults; composes
                          #   generic ingestion primitives from platform-ragie
    data-room-test-fixtures/ # Admin / Investor A / Investor B and tenant-leak fixtures

  deployments/
    platform-shared/      # lane policy, admission policy, shared governance
    platform-foundation-{dev,staging,prod}/
                          # provisioner-only deployments: DNS, Supabase, secret paths, state
    data-room-console-{dev,staging,prod}/
                          # Vercel publisher + opentofu-stack provisioner (project/domain/env)
    data-room-web-{dev,staging,prod}/
                          # container runtime publisher + opentofu-stack provisioner
    data-room-worker-{dev,staging,prod}/
                          # container runtime publisher + opentofu-stack provisioner
```

### 3.1 The split is pragmatic and unidirectional

The platform/data-room split is a CI-enforced naming and import discipline, not a multi-app framework. The rule has one direction:

- `platform-*` libraries **must not** import from `data-room-*` libraries
- `data-room-*` libraries **may** import from `platform-*` libraries directly, with no intermediating abstract interfaces

What this is **not**:

- Not a multi-app framework. There are no `app_templates`, recipes, plugin registries, or app loaders. The architecture's deferral of multi-app abstraction stands.
- Not speculative. Platform packages contain whatever the data-room app currently needs from them. They grow when data-room needs new platform capabilities. They do not grow because we imagine a hypothetical second app needing something.
- Not a shape requirement. Platform-side code is not asked to define abstract types, generic interfaces, or pluggable behaviors that exist only to support apps the platform might someday host. If a single concrete API serves the data-room app, that's the API.

What this **is**:

- A naming and import discipline. `Vault`, `Section`, `View`, `Document` (in the data-room sense), and the MCP tool catalog (`list_vaults`, `search_documents`) live in `data-room-*`. `Tenant`, `AgentConnection`, source-access grants, audit events, jobs, rate limits, the Ragie wrapper live in `platform-*`.
- A clear line in practice: a concept belongs in `platform-*` if its definition makes sense without knowing what a "vault" is. A concept belongs in `data-room-*` if its definition fundamentally references vault/section/view/document.

### 3.2 Package contents by side

- `projects/libs/platform-*`: tenant identity, WorkOS auth, agent-connection lifecycle, tool-scope mechanics, storage, audit, rate limits, jobs, retrieval provider wrapper, Source Access grant mechanics, MCP runtime primitives, deployment-neutral primitives
- `projects/libs/data-room-*`: vaults, section maps, views, data-room document policy, investor workflows, review-queue semantics, data-room MCP tool names and response shapes, data-room ingestion policy, demo fixtures
- `projects/apps/data-room-console`: the deployable Vercel console app for the Phase 0 data-room product; imports both layers
- `projects/apps/data-room-web` and `projects/apps/data-room-worker`: the data-room app's web and worker runtime processes. They compose `platform-*` runtime libraries (MCP server, Source Access Service, the worker job runner) with `data-room-*` libraries (tool catalog, authz, ingestion) at their entry points. Because they are `data-room-*` apps, they are free to import from both layers; the boundary rule applies to `platform-*` packages, not to apps. There are no `apps/platform-*` directories.

### 3.3 Where external-source data crosses the line

`platform-ragie/connect/` is a Phase 0 throwaway that ingests files via Ragie Connect. Its data flow naturally spans the platform/data-room boundary: Connect ingests files (platform concern) into data-room documents (data-room concern). The split is preserved by composition at the data-room app layer:

- `platform-ragie/connect/` exposes generic primitives only: "ingest a file with this metadata," "handle a webhook event for this connection." It imports nothing from `data-room-*`.
- `data-room-ingestion` defines data-room-specific behavior: lands documents in `'review_pending'`, applies the most-restrictive default ACL scope, registers with the review queue.
- `apps/data-room-worker` wires the two together: it receives a Connect webhook, looks up the `connector_connections` row (a data-room table), invokes the Connect ingestion primitive, then hands the result to `data-room-ingestion` to complete the document creation.

This means `connector_connections` is a data-room table (it references `vault_id`) and lives in `data-room-db`; `ragie_documents` and `ragie_webhook_events` are platform tables and live in `platform-db`. The Connect throwaway tag (`// PHASE 0 THROWAWAY — replace before first paying customer`) lives on every file in `platform-ragie/connect/`.

GitHub follows the same composition rule but is not a throwaway Ragie Connect path. `platform-github` owns only generic GitHub App mechanics: installation callback validation, installation-token minting, selected-repository reads, default-branch tree/content reads, and optional webhook signature verification. It imports nothing from `data-room-*`. `data-room-ingestion` owns GitHub source policy: `github_repository_connections`, path hygiene, sanitized snapshot Storage paths, review-pending status, Ragie metadata, and audit events. Deployment metadata declares only the platform GitHub App runtime credential profile; selected repositories, installation IDs, refresh state, and import snapshots remain runtime product state. `apps/data-room-worker` composes them. No MCP package may import `platform-github`; GitHub content reaches agents only through the published-document retrieval path.

### 3.4 Schema ownership and migrations

Schema ownership follows the package split. Migrations defining data-room tables live with `projects/libs/data-room-db/migrations/`; migrations defining platform tables live with `projects/libs/platform-db/migrations/`. A single ordered migration bundle is generated by the migration runner from package-owned migrations; the order is encoded as Buck dependencies between migration files, not maintained by hand. Composite tenant-aware FKs cross between platform and data-room tables, so the bundle generator must handle the dependency order deterministically (platform-referenced-by-data-room first, then data-room, then any platform tables that reference data-room).

Project-specific infrastructure does not live in a sibling top-level `infra` area. If it belongs to this product, it is owned by the relevant deployment package or by a clearly named foundation deployment under `projects/deployments`.

## 4. Build System Context For Reviewers

This repo uses Buck2 and Nix together:

- Buck2 is the source of truth for target structure, dependency graph, declared inputs, and impacted-test selection.
- Nix provides hermetic toolchains and deterministic artifacts.
- Language macros under `build-tools` expose build targets for Node, Go, Python, C++, Rust, and related artifact types.
- Deployment targets point at build targets rather than running provider-specific builds directly from arbitrary source checkouts.

For Phase 0, this means:

- `projects/apps/data-room-console` should expose a Buck target that produces a Vercel-compatible console artifact.
- `projects/apps/data-room-web` should expose a deployable Node service artifact or image.
- `projects/apps/data-room-worker` should expose a deployable Node service artifact or image, ideally built from the same source graph and image family as `data-room-web` but with a different runtime entry point.
- Platform and app packages should be built and tested as repo-local libraries so dependency boundaries are visible to Buck and enforceable in CI.

The goal is not to make developers stop using framework-native commands during local development. The goal is that CI and protected/shared deployment consume hermetic, declared, reproducible artifacts.

## 5. Deployment System Context For Reviewers

Deployments in this repo are first-class project-owned targets under `projects/deployments/<deployment-id>/TARGETS`.

A deployment target describes:

- provider family, such as `vercel`, `cloud-run`, `fly`, `render`, `railway`, or `kubernetes`
- provider target identity, such as project/environment or service/region
- component artifact target
- component kind, such as `static-webapp`, `ssr-webapp`, or `service`
- protection class: `local_only`, `shared_nonprod`, or `production_facing`
- secret and runtime config requirements
- provisioner configuration, when infrastructure changes are part of the deployment
- smoke or release-health checks
- lane policy, environment stage, and admission policy for protected/shared targets
- preview, rollback, retry, promotion, and provision-only behavior when the provider supports them

The repo-level `deploy --deployment <label>` command is the front door. For protected/shared deployments, the mutating publish path should consume admitted immutable artifacts and frozen execution snapshots, not a developer laptop's current filesystem state.

The deployment model is intentionally single-provider per deployment. A system that spans Vercel plus a container runtime is modeled as multiple coordinated deployments, not one cross-provider deployment object.

Infrastructure changes are still part of this model. The usual shape should be a built-in `opentofu-stack` provisioner attached to a deployment, so app release and infrastructure plan/diff are admitted, recorded, approved, and replayed together when appropriate. For infrastructure that has no app artifact, use a dedicated foundation deployment such as `platform-foundation-prod`; if needed, that deployment may use an `opentofu` provider or a no-app deployment shape whose publisher is effectively provision-only. The important rule is that OpenTofu execution remains deployment-owned and reviewed.

Provider and provisioner responsibilities should not overlap. A publisher such as `vercel` publishes an admitted application artifact to an existing declared provider target. A provisioner such as `opentofu-stack` creates or updates the infrastructure and provider configuration that makes that target exist. The `deploy` workflow sequences and records both; the Vercel publisher should not secretly run OpenTofu, and OpenTofu should not publish application artifacts.

## 6. Deployment Layout For Phase 0

Represent the runtime as three deployment families:

```text
projects/deployments/data-room-console-dev/
projects/deployments/data-room-console-staging/
projects/deployments/data-room-console-prod/

projects/deployments/data-room-web-dev/
projects/deployments/data-room-web-staging/
projects/deployments/data-room-web-prod/

projects/deployments/data-room-worker-dev/
projects/deployments/data-room-worker-staging/
projects/deployments/data-room-worker-prod/

projects/deployments/platform-shared/

projects/deployments/platform-foundation-dev/
projects/deployments/platform-foundation-staging/
projects/deployments/platform-foundation-prod/
```

`platform-shared` should hold the shared lane policy, stage branches, governance, and admission policies. The console, web, and worker deployments can then share the same `dev -> staging -> prod` promotion model while remaining separate provider-specific deployments.

`platform-foundation-*` should hold shared environment infrastructure that is not naturally owned by only the console, web, or worker deployment. Examples include base DNS zones, Supabase project resources, shared object buckets, deployment secret path scaffolding, and OpenTofu state configuration. Component-specific infrastructure should stay with the component deployment that owns it.

Conceptually:

```text
data-room-console-prod
  provider: vercel
  component: //projects/apps/data-room-console:app
  protection_class: production_facing

data-room-web-prod
  provider: chosen container runtime
  component: //projects/apps/data-room-web:service
  protection_class: production_facing

data-room-worker-prod
  provider: chosen container runtime
  component: //projects/apps/data-room-worker:service
  protection_class: production_facing

platform-foundation-prod
  provider or provisioner: opentofu
  component: none or infra-plan artifact
  protection_class: production_facing
```

The web and worker may use the same container image artifact if the chosen provider supports command or entrypoint overrides. If not, they can be built as separate artifacts from the same source packages. Either shape should preserve the architecture's "single TypeScript codebase, two process types" property.

## 7. Coordinated Release Behavior

The safest Phase 0 release model is coordinated but not artificially atomic across providers.

Recommended baseline:

- all three deployment families share one lane policy
- each prod deployment requires its own admission policy and required checks
- promotion advances the same reviewed source revision through `dev`, `staging`, and `prod`
- the deploy records preserve artifact identity separately for console, web, and worker
- prerequisites encode release ordering where needed

Likely ordering:

1. `data-room-worker`
2. `data-room-web`
3. `data-room-console`

The worker can usually be deployed first when it is backward compatible with existing jobs. The web process should deploy before the console if the console depends on new REST routes. The console should remain a thin client and should not be the only place where a security or policy change is enforced.

For risky changes, use feature flags or compatibility windows rather than assuming a single cross-provider transaction. The architecture already relies on the server-side policy boundary; deployment ordering should reinforce that boundary.

## 8. CI And Admission Gates

The companion architecture document's readiness gates should become CI and deployment admission checks where practical.

Always-on checks:

- TypeScript typecheck and unit tests for all touched packages
- migration ordering and schema checks across `platform-db/migrations/` and `data-room-db/migrations/`, including the cross-package Buck-dependency invariant (architecture §17.5)
- RLS tenant-isolation tests
- dependency-boundary lint for `data-room-mcp-tools`, console handlers, and worker handlers
- explicit check that `data-room-mcp-tools` cannot import from `platform-ragie/connect/`
- explicit check that `projects/libs/platform-*` does not import from `projects/libs/data-room-*` or from `projects/apps/` (architecture §17.1)
- explicit check that no app target imports from another app target (apps compose libraries, not each other)
- source response shape check that IP and user-agent forensics fields are not returned through MCP
- package-local tests for `platform-authz`, `platform-source-access`, `platform-jobs`, `platform-ragie`, `platform-github`, `platform-storage`, `data-room-authz`, `data-room-mcp-tools`, and `data-room-console-api`

Secret-backed or environment-backed checks:

- Ragie ACL array-filter semantics spike
- live tenant-leak suite against a real Ragie partition
- WorkOS MCP Auth end-to-end checks against target clients
- `fetch_full_document` grant lifecycle tests against real storage
- Connect metadata-shape and metadata-overlay validation
- Connect OAuth and source-update behavior validation for Drive, Notion, and Slack
- GitHub App selected-repository install, permission, hygiene, refresh, and retrieval-bakeoff validation

Not every live-system test needs to run on every local edit. The deployment admission model should distinguish fast PR checks from protected/shared release checks. No design partner should touch the direct-upload MCP experience until Gates 1-4 pass against real systems, and no external connector demo should happen until Gate 5 passes.

## 9. OpenTofu's Role

OpenTofu remains the infrastructure provisioning tool, but it should be entered through the deployment system. Project-specific OpenTofu stacks should live under `projects/deployments`, either attached to a concrete application deployment as a provisioner or grouped into a foundation deployment.

OpenTofu should own resources and relationships that are infrastructure state rather than application artifact state, such as:

- DNS and custom domains
- container runtime services and service accounts
- Vercel project, domain, environment-variable binding, and project-setting configuration
- Supabase project resources, buckets, storage policies, and database settings where supported
- WorkOS and Ragie environment setup where APIs and operational safety allow
- S3/R2 state
- secret backends and wiring metadata

The repo deployment system should own application release state:

- which artifact was admitted
- which provider target was mutated
- which source revision was reviewed
- which smoke checks passed
- which secrets and runtime config requirements were declared
- which deployment run can be retried, promoted, or used as rollback source

OpenTofu should not become the ordinary app deploy path for console, web, or worker artifacts. It should be a reviewed provisioner step around those deployments, with plan/diff artifacts bound into admission.

The boundary is:

- Vercel provider: upload/admit/publish prebuilt console artifacts, manage preview and production assignment, record Vercel deployment IDs and URLs, run smoke checks.
- OpenTofu provisioner: create/update the Vercel project, domain bindings, DNS, Vercel environment variable bindings, Supabase resources, container runtime services, secret path scaffolding, and state backend.
- OpenTofu foundation deployment: own shared infrastructure that is not naturally scoped to the console, web, or worker deployment.

### 9.1 `opentofu-stack` Provisioner

Add a built-in `opentofu-stack` provisioner contract if the existing `terraform-stack` / `cdktf-stack` support is not sufficient.

Requirements:

- deployment package owns the OpenTofu stack directory
- plan output is generated before protected/shared mutation
- plan fingerprint is bound into admission evidence
- routine deploy rejects destructive plans unless a reviewed destructive workflow or target exception is used
- apply consumes the exact reviewed plan or a fail-closed equivalent resolved-input snapshot
- state backend is declared and environment-scoped
- provider credentials are declared through `secret_requirements`, resolved through `SprinkleRef`, and read from Vault at execution time
- provision-only flows are first-class and audited
- promotion compatibility accounts for provisioner type, stack identity, state backend, and allowed environment-specific differences

Recommended deployment metadata shape:

```python
vercel_next_webapp_deployment(
    name = "deploy",
    component = "//projects/apps/data-room-console:app",
    team = "company",
    project = "data-room-console-prod",
    provisioner = "opentofu-stack",
    provisioner_config = "opentofu/stack.json",
    secret_requirements = [
        {
            "name": "vercel_api_token",
            "step": "publish",
            "contract_id": "secret://deployments/platform/vercel_api_token",
            "required": "true",
        },
        {
            "name": "vercel_api_token",
            "step": "provision",
            "contract_id": "secret://deployments/platform/vercel_api_token",
            "required": "true",
        },
    ],
    runtime_config_requirements = [],
)
```

In this shape, the Vercel provider uses the `publish` secret to deploy the admitted prebuilt artifact. The `opentofu-stack` provisioner uses the `provision` secret to plan/apply Vercel project and domain configuration. The two steps may reference the same underlying token contract, but they remain distinct lifecycle steps with distinct records.

### 9.2 Standalone OpenTofu Deployments

Some infrastructure does not belong to a single app component. Examples include the Supabase project, shared DNS zones, shared secret path scaffolding, or base container runtime accounts.

For those cases, use dedicated foundation deployments:

```text
//projects/deployments/platform-foundation-dev:deploy
//projects/deployments/platform-foundation-staging:deploy
//projects/deployments/platform-foundation-prod:deploy
```

These can be modeled as either:

- an `opentofu` provider for infra-only deployments, or
- a deployment target with no app artifact and an `opentofu-stack` provisioner-only workflow

The provider route is cleaner if the deployment system needs normal deploy records, target identity, locking, status, retry, rollback, and provision-only semantics for infrastructure as the main artifact. The provisioner-only route is cleaner if we want to avoid adding a new provider kind and can express the workflow using existing provision-only machinery.

Either way, foundation infrastructure should still use the same lane/admission policy, Vault/SprinkleRef secret resolution, plan/diff review, and immutable execution snapshot model as app deployments.

## 10. Vault And `SprinkleRef` Requirements

Secrets must use this repo's existing `SprinkleRef` contract model.

The stable repo-owned surface is:

- deployments declare `secret_requirements`
- each requirement names a stable `contract_id`, such as `secret://deployments/platform/vercel_api_token`
- admission freezes non-secret admitted secret references
- runtime resolves secret values only for the lifecycle step that needs them
- Vault is the production backend behind the `SprinkleRef` contract
- local/test fixtures remain explicit non-production overrides, not the production path

For this project, secrets should be grouped by deployment family and purpose, not by implementation accident. Example contract IDs:

```text
secret://deployments/platform/vercel_api_token
secret://deployments/platform/container_runtime_api_token
secret://deployments/platform/opentofu_state_credentials
secret://deployments/platform/supabase_service_role_key
secret://deployments/platform/workos_api_key
secret://deployments/platform/workos_client_secret
secret://deployments/platform/ragie_api_key
secret://deployments/platform/github_app_private_key
secret://deployments/platform/github_webhook_secret
secret://deployments/platform/source_grant_hmac_secret
```

Provider API tokens, OpenTofu cloud/provider credentials, Supabase service-role credentials, WorkOS secrets, Ragie secrets, GitHub App private keys/webhook secrets, and HMAC signing material must not live in `TARGETS`, Vercel project settings committed to the repo, `.env` files, or CI variables that bypass the deployment secret runtime.

Each deployment provider and provisioner must:

- declare every needed secret in `secret_requirements`
- use step-specific secret requirements such as `publish`, `provision`, `smoke`, `preview_cleanup`, or release-action steps
- read secret values only through the deployment secret runtime
- record admitted secret references, not values
- fail closed if a required secret is missing, not authorized for the target scope, or resolved for the wrong deployment
- avoid ambient reads of provider credentials from `process.env` except inside the reviewed secret runtime boundary
- support secret rotation without changing the stable `contract_id`

`vault_runtime` metadata belongs in deployment metadata where needed to tell deployment tooling how to authenticate to Vault. It may contain public routing and identity metadata, but it must never contain secret values, Vault tokens, root tokens, or client secrets.

## 11. Required Vercel Deployment Provider

To keep the console on Vercel while using the repo deployment system, add a reviewed `vercel` provider family.

The provider should support repo-built prebuilt deployments. Vercel's documented flow supports building locally or in CI into `.vercel/output` via the Build Output API and deploying that output with `vercel deploy --prebuilt`. This is the key fit with the repo model: the repo can build, attest, and admit a specific artifact before Vercel publishes it.

References:

- [Vercel CLI deploy: prebuilt deployments](https://vercel.com/docs/cli/deploy)
- [Vercel CLI build: `.vercel/output` and Build Output API](https://vercel.com/docs/cli/build)
- [Vercel Build Output API](https://vercel.com/docs/build-output-api)

### 11.1 Provider Identity

The provider capability entry should define canonical target identity fields. Recommended fields:

```text
provider = "vercel"
canonical identity:
  team_id or team_slug
  project_id or project_name
  environment
```

`environment` should be a canonical value such as `preview`, `staging`, or `production`, not an inferred branch name. If Vercel's API requires additional internal IDs, the provider adapter should resolve and record them but not replace the repo's declared identity model with ambient Vercel defaults.

Canonical lock key:

```text
vercel:<team>/<project>#<environment>
```

For production deployments, the normal mutable live target should be the declared project/environment plus declared domain assignment policy.

### 11.2 Supported Component Kinds

Minimum useful support:

- `static-webapp` for static outputs
- `ssr-webapp` or `next-webapp` for Next.js console deployments

The Phase 0 console needs Next.js support. If the repo keeps component kinds generic, prefer `ssr-webapp` with a Vercel-specific runtime contract. If we want a clearer provider-specific contract, introduce `next-webapp` only if the deployment schema and provider capability registry intentionally accept that new kind.

For Phase 0, single-component deployments are enough.

### 11.3 Build And Artifact Contract

The provider must not rely on Vercel Git auto-builds as the authoritative protected/shared production path.

Required behavior:

- build through a Buck target under `projects/apps/data-room-console`
- produce a Vercel-compatible `.vercel/output` artifact or archive
- record a stable artifact identity from the finalized build output bytes
- submit that exact artifact to deployment admission
- publish with Vercel prebuilt deployment behavior
- record the Vercel deployment URL and deployment ID returned by the publish step

The adapter may internally run `vercel build` inside the hermetic build action if that is the safest way to produce `.vercel/output`. If so, all inputs that affect the output must be declared in Buck, and the build must not consume untracked local Vercel state. If `vercel pull` or project settings are required, those settings must become declared build inputs, runtime config inputs, or provisioning outputs from the deployment's reviewed `opentofu-stack` provisioner.

Important caveat: Vercel documents that system environment variables can be missing at build time when using `--prebuilt`. Therefore, the console must not depend on Vercel-only system environment variables for build-time behavior unless the provider explicitly declares and injects equivalent build inputs through the repo build path.

### 11.4 Secrets And Runtime Config

The provider must integrate with this repo's `secret_requirements` and `runtime_config_requirements` model.

Requirements:

- declare all Vercel runtime environment variables needed by the console
- declare all build-time public configuration separately from runtime secrets
- declare Vercel API credentials through `secret_requirements` with stable `SprinkleRef` contract IDs
- resolve Vercel publish credentials from Vault through the deployment secret runtime during `publish` and `preview_cleanup`
- leave Vercel project, domain, and environment-setting mutation to the deployment's `opentofu-stack` provisioner, which resolves any `provision` credentials through the same Vault/SprinkleRef runtime
- never store secret values in `TARGETS`
- support environment-scoped values for dev, staging, and prod
- fail closed when a required secret or runtime config value is absent
- record which secret contract IDs and runtime config inputs were used for the deployment run, without recording secret values

The console should generally need less secret material than `data-room-web`, because policy and privileged service-role operations belong in the web process. Vercel should receive only what the thin console needs, such as public base URLs, AuthKit browser-facing configuration, and non-secret feature flags.

The Vercel provider should not write durable Vercel project settings as part of the publish step. If Vercel environment variables or project settings must change, that mutation is provisioning and should be driven by an `opentofu-stack` provisioner. Runtime secret values should still originate from Vault/SprinkleRef and should not be hand-entered in the Vercel dashboard for protected/shared environments.

### 11.5 Preview Support

Vercel's preview model is useful, but the provider must adapt it to the repo's preview contract.

Requirements:

- preview is a publish mode, not a separate deployment identity
- preview targets must be isolated from the normal live production target
- preview deployments should be source-run scoped
- preview cleanup must be explicit and audited when the provider supports cleanup
- preview URLs must be recorded in deployment records
- preview must not bypass admission requirements for protected/shared targets unless the deployment is explicitly `local_only`

The provider should reject ambiguous preview operations where the target cannot be proven isolated.

### 11.6 Promotion And Production Assignment

The provider needs a reviewed model for making a deployment production-facing.

Acceptable shapes:

- deploy prebuilt directly to the declared production environment when admission has already approved the artifact
- deploy prebuilt to a staged Vercel deployment and then promote or alias it to the declared production target through a recorded provider operation

Whichever path is chosen, the provider must record:

- Vercel deployment ID
- deployment URL
- production alias or domain assignment result
- source run ID and artifact identity
- provider target identity
- smoke result

If Vercel domain assignment or promotion is eventually used, that operation must be part of the audited publish step, not an out-of-band dashboard action.

### 11.7 Rollback, Retry, And Idempotency

Required behavior:

- retry should reuse the recorded exact artifact or recorded Vercel deployment when possible
- rollback should select a prior successful normal deployment for the same canonical provider target
- rollback must not rebuild from the current branch
- ambiguous Vercel API outcomes must fail closed
- records should distinguish deployment creation from alias/domain production assignment

If Vercel supports re-aliasing a prior deployment without re-uploading bytes, the provider may use that as the preferred rollback path after verifying the prior deployment still exists and matches the recorded artifact identity. If not, rollback should republish the retained exact artifact.

### 11.8 Smoke Checks

Minimum smoke checks:

- declared console URL returns HTTP 200
- expected app shell is present
- AuthKit redirect or logged-out landing behavior is correct enough to prove routing
- configured console-to-web base URL is present and points at the intended environment

Smoke checks must not require privileged user credentials by default. Deeper authenticated checks can be separate release-health actions if the provider later supports them.

### 11.9 Provider Capability Registry

The Vercel provider is not complete until it has a reviewed provider capability entry covering:

- canonical identity fields
- lock-key rule
- supported component kinds
- rollout support and omission posture
- preview support and cleanup model
- smoke model
- retry and rollback assumptions
- partial publish observability
- provisioner support, if any
- release actions support, if any
- multi-component support posture
- protected/shared eligibility

This mirrors the existing provider capability standard and gives reviewers a concrete contract to compare against implementation.

## 12. Container Runtime Provider Requirements

This document focuses on Vercel because that is the new provider needed for the console. The architecture also needs a production container runtime for `data-room-web` and `data-room-worker`.

If the chosen production runtime is not already represented by a reviewed provider, add a provider with the same level of explicitness:

- canonical service identity
- immutable service artifact or image digest
- environment-scoped secrets and runtime config
- `SprinkleRef`/Vault resolution for provider credentials and runtime secrets
- `opentofu-stack` provisioner support when service infrastructure is deployment-owned
- health checks
- retry, rollback, and promotion behavior
- provision-only behavior if runtime resources are deployment-owned
- separate web and worker commands or separate service artifacts
- clear ingress model for web and no-public-ingress model for worker

The web process is a security boundary, so its provider contract should be reviewed as carefully as the Vercel provider.

## 13. Implementation Sequence

Recommended order:

1. Create repo-local package and app skeletons using the layout in this document.
2. Add initial Buck targets for platform libraries, data-room libraries, and test packages.
3. Split schema migrations and RLS tests between `projects/libs/platform-db` and `projects/libs/data-room-db`.
4. Add deployment metadata skeletons for console, web, worker, foundation, and shared lane policy.
5. Add or extend `opentofu-stack` provisioner support and foundation deployment support.
6. Define `secret_requirements` and Vault/SprinkleRef contract IDs for every provider, provisioner, and runtime secret.
7. Implement or select the container runtime provider for web and worker.
8. Implement the Vercel provider enough for `local_only` or dev deployment.
9. Add provider capability entries and validation for Vercel, OpenTofu/provisioning, and the chosen container runtime.
10. Wire CI checks for migration, RLS, package boundaries, and test suites.
11. Promote live-system readiness gates into protected/shared admission checks.
12. Only then enable external pilot access according to the architecture gates.

This keeps early engineering focused on schema, RLS, authz, and Ragie validation while still establishing the deployment rails before design partners touch the system.

## 14. Reviewer Checklist

Use this checklist when reviewing the implementation plan:

- Does the runtime topology still match the architecture?
- Are console, web, and worker modeled as separate deployments rather than one cross-provider deployment?
- Is project-specific infrastructure modeled under deployment packages rather than a separate top-level `infra` tree?
- Are OpenTofu stacks invoked through reviewed provider/provisioner contracts with plan/diff admission?
- Is there a clear boundary between `projects/libs/platform-*` and `projects/libs/data-room-*`?
- Are data-room concepts present in the data-room app layer rather than leaking into platform packages?
- Does the proposal avoid speculative app templates or plugin machinery beyond the explicit data-room app boundary?
- Does every deployable artifact have a Buck target?
- Does protected/shared deployment consume admitted immutable artifacts?
- Are secrets and runtime config declared in deployment metadata rather than hardcoded?
- Do all secrets use stable `SprinkleRef` contract IDs and Vault-backed runtime resolution?
- Is the Vercel provider based on prebuilt artifacts rather than Vercel Git auto-builds for production?
- Are readiness gates represented as CI or admission checks?
- Is Connect throwaway code structurally isolated under `platform-ragie/connect/`, with the throwaway tag on every file?
- Is GitHub App code structurally isolated under `platform-github`, with data-room-specific repository policy kept in `data-room-ingestion`?
- Does the platform/data-room split exist as a CI-enforced one-way import rule rather than a multi-app framework?
- Does the proposal avoid speculative `app_templates`, recipes, plugin registries, or app loaders?
- Do dependency-boundary checks prevent `platform-*` from importing `data-room-*`?
- Are app-layer compositions (e.g., `apps/data-room-worker` wiring `platform-ragie/connect/` or `platform-github` to `data-room-ingestion`) the only place data flows cross the platform/data-room boundary?
- Can rollback and retry happen without rebuilding from a developer workstation?
