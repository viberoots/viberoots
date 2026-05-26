# ADR-00002: Deployment Target Strategy

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

viberoots delivers software across heterogeneous provider families (Cloudflare Pages,
Cloudflare Containers, NixOS shared hosts, Apple App Store). Before this decision was
codified, there was no canonical answer to several structural questions:

- Where does authoritative deployment metadata live, and is the provider configuration
  file allowed to supplement or override it?
- Can a single deployment unit span multiple provider families?
- Who may mutate a protected or shared deployment, and through what interface?
- What is the canonical operator interface for executing a deployment?

Without explicit answers, teams risked configuration drift between provider-config files
and checked-in metadata, ad-hoc cross-provider deployments that are hard to reason about,
and unreviewed hand-authored deployment JSON reaching production.

## Decision

### 1. TARGETS is the sole authoritative source of deployment metadata

Every deployment's metadata is declared in `TARGETS` (Buck2). Provider-config files and
secret-backend configurations are never a second source of truth. Any property that
appears in a provider config must be derived from or consistent with what `TARGETS`
expresses; it may not introduce new authoritative state.

### 2. Every concrete deployment lives at a canonical path and exposes a canonical target

Each deployment occupies `projects/deployments/<deployment-id>/` and exposes a
`:deploy` Buck target. The deployment id is unique and stable across the lifetime of
the deployment. This layout makes deployments discoverable, diff-able, and addressable
by tooling in a uniform way.

### 3. Each deployment is intentionally single-provider

A deployment unit is scoped to exactly one provider family. Systems that must span
multiple provider families are represented as multiple coordinated deployments, each
with its own deployment id, `:deploy` target, and admission lifecycle. Cross-provider
deployments are out of scope for a single deployment unit by design.

**Supported provider families:**
| Family | Workload |
|---|---|
| `cloudflare-pages` | Static PWA and web app hosting |
| `cloudflare-containers` | Containerized workloads on Cloudflare |
| `nixos-shared-host` | NixOS-hosted services via shared control plane |
| `app-store-connect` | Apple App Store releases |

### 4. Environment classification governs admission and mutation policy

Every deployment is classified into exactly one environment:

- `personal_dev` — developer laptops; local builds are allowed.
- `shared_nonprod` — shared staging/QA; requires control-plane admission before
  any mutation.
- `production_facing` — production; requires full admission plus lane policy
  enforcement.

`shared_nonprod` and `production_facing` deployments are protected. They must go
through the shared control plane. Trusted CI may build, attest, and submit artifacts,
but CI is not a peer mutating authority. Direct local mutation of protected targets
is out of policy except under documented break-glass procedures.

### 5. Protected deployments declare lane policy sourced from reviewed main metadata

Any deployment classified `shared_nonprod` or `production_facing` must declare:
- `lane_policy`
- `environment_stage`
- `admission_policy`

Lane policy is sourced exclusively from reviewed `main`-branch metadata. Long-lived
environment branches are not a valid source for lane policy. Lane policy specifies:
the stage source-ref policy, allowed promotion edges, artifact reuse mode
(`same_artifact` or `rebuild_per_stage`), trusted reporter identities, and approval
boundaries.

### 6. Preview is a publish mode, not an operation kind

Preview is expressed as `publish_mode = preview`. It is not a peer `operation_kind`
alongside a normal publish. A preview publishes only to an explicitly isolated preview
target and does not share promotion edges with non-preview stages.

### 7. Rollback requires an explicit source run selection

Rolling back requires `--source-run-id` referencing a prior admitted run. Moving a
branch pointer backward or rebuilding from an earlier commit is not a rollback
mechanism and must not be treated as one by operators or tooling.

### 8. Buck2 owns structure and artifacts; live side-effects happen outside Buck actions

Buck owns deployment structure, validation, dependency graph, and build artifacts.
Live deployment side effects — actual provider mutations — happen outside Buck
actions, via the deploy CLI.

### 9. The deploy CLI is the canonical operator interface

```
deploy --deployment //projects/deployments/<id>/<variant>:deploy
```

Metadata is resolved from Buck-backed selectors. Hand-authored deployment JSON is
not a reviewed operator input and must not be used as a substitute for the
Buck-resolved metadata path.

## Consequences

### Positive

- **Single source of truth.** `TARGETS` is the only place deployment metadata is
  authored. Drift between config files and reality is structurally prevented.
- **Uniform discoverability.** Any deployment can be located at a known path and
  addressed via a canonical Buck target, enabling consistent tooling, auditing, and
  dependency tracking.
- **Clear blast radius.** Single-provider deployments limit the scope of any one
  deployment's failure or misconfiguration to a single provider family.
- **Policy enforceability.** Environment classification and lane policy declarations
  are machine-checkable properties in `TARGETS`, making admission and promotion rules
  auditable without manual inspection.
- **Operator interface is auditable.** The deploy CLI resolves metadata from reviewed
  Buck outputs; no unreviewed hand-authored JSON can silently influence a protected
  deployment.

### Trade-offs

- **Multi-provider systems require coordination across multiple deployments.** There
  is no single deployment unit that spans provider families. Operators must understand
  which deployment ids participate in a logical system and coordinate their promotion
  order explicitly.
- **Break-glass procedures require out-of-band documentation.** Because local mutation
  of protected targets is normally out of policy, emergency procedures must be kept
  current and separately documented.
- **Lane policy is tied to main.** Teams cannot use long-lived environment branches
  as the policy source, which may require process changes for teams accustomed to
  branch-per-environment workflows.

### Obligations

- Every deployment must declare its provider family and environment classification in
  `TARGETS` before any tooling or CI can act on it.
- Any deployment promoted to `shared_nonprod` or `production_facing` must have
  `lane_policy`, `environment_stage`, and `admission_policy` present and reviewed
  before the first admission attempt.
- Rollback procedures in runbooks must reference `--source-run-id` semantics and must
  not describe branch-reset or rebuild paths as valid rollback mechanisms.
- Provider-config and secret-backend files must be kept derivative of `TARGETS` and
  must not introduce authoritative state not reflected there.
