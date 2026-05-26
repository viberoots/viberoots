# ADR-00004: Tenant Isolation Model

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

viberoots manages deployments for multiple independent tenants and applications. Each tenant owns one
or more deployments that must not share mutable live state, secrets, admission context, or promotion
eligibility with other tenants by accident. The deployment system needed an explicit isolation model
so that isolation is the hard default and any cross-tenant sharing requires deliberate, reviewable
action.

Several forces shaped this decision:

- Buck2 owns deployment structure and the dependency graph. Every concrete deployment is declared at
  `projects/deployments/<deployment-id>/` with a canonical `:deploy` target, making deployment
  identity auditable at the source level.
- Deployments span multiple environment stages (dev, staging, production). Stage state must be keyed
  to a specific deployment so that a production promotion for one tenant cannot be confused with, or
  trigger, a promotion for another.
- Preview publication must not leak into normal live targets. Provider defaults and ambient git state
  are not reliable signals for distinguishing a preview from a normal publish.
- Secret namespacing must be per-deployment so that a misconfigured mapping does not expose one
  tenant's credentials to another.
- Admission evidence (source revision, artifact identity, trusted check results, builder identity)
  must be frozen per-deployment-per-environment before the mutating publish run executes.

## Decision

The isolation model is structured around seven interlocking rules, all of which are fail-closed by
default:

**1. Deployment-id isolation.**
Each deployment lives at `projects/deployments/<deployment-id>/` and owns exactly one normal mutable
live target. Sharing a normal live target across deployment ids is not permitted without an explicit
reviewed migration or alias exception. An alias exception is a first-class control-plane object with
explicit scope, lock-sharing semantics, and expiry or completion conditions.

**2. Single-provider per deployment.**
Each deployment is intentionally single-provider. A system that spans multiple provider families
must be modeled as multiple coordinated deployments, not as a single cross-provider deployment
object. This enforces isolation at the provider boundary and prevents one provider's failure or
misconfiguration from silently affecting another provider's state.

**3. Environment stage isolation.**
Deployments declare an `environment_stage` (e.g., dev, staging, production). Control-plane state is
keyed by `(deployment_id, environment_stage)`. Stage history is append-only. Promotions across
stages follow the lane policy's declared promotion edges; no ad-hoc cross-stage state sharing is
permitted.

**4. Preview isolation.**
Preview is `publish_mode = preview`, not a peer operation kind. Preview must publish only to an
explicitly isolated preview target. Preview identity requires explicit selectors; implementations
must not infer preview identity from ambient git state, branch name, or provider defaults.

**5. Lane policy isolation.**
Protected and shared deployments declare `lane_policy` sourced exclusively from reviewed `main`
metadata. Lane policy defines trusted reporter identities, approval boundaries, allowed promotion
edges, and artifact reuse mode. Long-lived `env/<family>/<stage>` branches are not authoritative
promotion inputs.

**6. Artifact isolation.**
Two artifact reuse modes are supported. In `same_artifact` mode the same admitted artifact promotes
across environments unchanged. In `rebuild_per_stage` mode the same admitted source revision
advances but produces a new stage-specific artifact. In both modes promotion eligibility comes from
control-plane stage state, not from mutable git refs or provider tags.

**7. Secret isolation.**
Deployments declare `infisical_runtime` and `infisical_secret_mappings` for per-deployment secret
namespacing within Infisical. Secret names are derived deterministically from contract IDs using
snake_case so that mappings are reviewable and collisions are structurally prevented.

**Admission isolation (cross-cutting).**
Each protected or shared first-run deploy goes through two sequential admission stages:

- Source admission determines the admissible revision and trusted artifact inputs.
- Target-environment run admission freezes the execution snapshot for the mutating publish run.

This ensures that the execution context is isolated per `(deployment_id, environment_stage)` pair
and that no ambient state from a concurrent deployment can contaminate the admitted snapshot.

**Control-plane database.**
State is keyed by `(submission_id, deploy_run_id)` and by `(deployment_id, environment_stage)`.
Stage history is append-only. There is no cross-tenant state sharing in the database schema.

## Consequences

### Positive

- Hard isolation is the default. A new deployment is isolated by construction; isolation does not
  depend on operator discipline.
- Promotion eligibility is auditable. Because stage state lives in the control-plane database keyed
  to `(deployment_id, environment_stage)`, every promotion decision has a clear, inspectable
  lineage.
- Preview safety is structural. Preview identity cannot be inferred from ambient git state; an
  implementation that attempts to do so will fail at admission rather than silently publish to a
  live target.
- Secret collisions are structurally prevented. Deterministic snake_case derivation from contract
  IDs means secret name conflicts surface at review time, not at runtime.
- Cross-provider coordination is explicit. Modeling multi-provider systems as multiple coordinated
  deployments means each provider surface is independently reviewable and auditable.

### Trade-offs

- Adding a legitimately shared live target requires drafting and reviewing an alias exception as a
  first-class control-plane object, which is more work than a simple configuration flag.
- Cross-provider coordinated deployments require operators to manage promotion sequencing across
  multiple deployment objects; there is no built-in cross-deployment transaction.
- `rebuild_per_stage` artifact mode requires additional build capacity per environment compared to
  `same_artifact` promotion.

### Obligations

- Every concrete deployment must declare `environment_stage`, provider-target identity, and (for
  protected or shared deployments) `lane_policy`, `admission_policy`, and any required secret
  mappings in authoritative Buck metadata.
- Implementations must reject any preview publish that lacks explicit preview identity selectors.
  Inferring preview identity from ambient git state or provider defaults is out of contract.
- Control-plane queries for current stage state must use backend-native identifiers
  (`submission_id`, `deploy_run_id`) through reviewed service surfaces. Filesystem mirror paths are
  not authoritative runtime inputs.
- Any alias exception that sanctions shared live targets must carry explicit scope, lock-sharing
  semantics, and an expiry or completion condition. Undocumented sharing is not permitted.
- Lane policy must be sourced from reviewed `main` metadata. Long-lived environment branches must
  not be used as authoritative promotion inputs.
