# Deployment Provider Capabilities

This document defines the required contract for each built-in deployment provider capability entry.

The goal is to keep provider behavior explicit, reviewable, and consistent across adapters.

Every built-in provider intended for protected/shared deployment use should have one authoritative entry
covering the fields below before it is considered in policy.

Normative-source note:

- this document is the authoritative reviewed registry for built-in provider capability support
- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) may summarize provider support for onboarding, but this document owns the normative provider-capability contract

## Required Capability Fields

| Field                            | Purpose                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `provider`                       | Stable provider family identifier.                                                                      |
| canonical target identity fields | Defines which `provider_target` fields establish live-target identity.                                  |
| canonical lock-key rule          | Defines how lock scope is derived from canonical identity.                                              |
| supported component kinds        | Defines which component shapes the provider can publish.                                                |
| supported rollout modes          | Defines which `rollout_policy` modes are valid.                                                         |
| default rollout mode             | Defines the provider's default rollout semantics when deployment metadata omits `rollout_policy`.       |
| preview support                  | States whether preview is unsupported, supported with restrictions, or fully supported.                 |
| preview isolation model          | Defines how preview target isolation is proven.                                                         |
| preview cleanup default          | Defines the concrete default cleanup/TTL behavior when deployment metadata relies on provider defaults. |
| preview lock-scope default       | Defines whether preview shares the normal lock by default or may use its own lock by default.           |
| smoke or release-health model    | Defines how built-in smoke/health checks work for this provider.                                        |
| retry/idempotency assumptions    | Defines when publish retry is safe.                                                                     |
| partial publish observability    | Defines whether partial publish state can be observed and recorded.                                     |
| multi-component support          | Defines whether multi-component deployments are supported.                                              |
| protected/shared eligibility     | States whether the provider is in policy for protected/shared use.                                      |

## Review Questions For Every Provider

- What exact `provider_target` fields determine the normal mutable live target?
- Can preview mutate an isolated target with its own cleanup and lock semantics?
- Which rollout modes are truly supported, and which must be rejected?
- What smoke or release-health checks are available by default?
- Under what conditions is retry safe or idempotent?
- Can the provider surface concrete publish identifiers and partial publish state?
- Does the provider require package-local executable hooks, or can it stay inside the built-in registry model?

## Capability Entry: `cloudflare-pages`

### Identity

- `provider`: `cloudflare-pages`
- canonical target identity fields:
  - `project`
  - `account`
- canonical lock-key shape:
  - `cloudflare-pages:<account>/<project>`

### Component Support

- supported component kinds:
  - `static-webapp`
- multi-component support:
  - not supported for protected/shared use
  - deployments must contain exactly one `static-webapp` component
- additional unsupported shapes:
  - complex multi-component systems
  - provider-specific arbitrary executable hooks in protected/shared paths

### Rollout Support

- default rollout mode:
  - `all_at_once`
- supported rollout modes:
  - `all_at_once`
- unsupported rollout modes:
  - `all_or_nothing`
  - `ordered_best_effort`
  - `parallel_best_effort`
  - `canary`
  - `blue_green`
  - `phased`
  - `store_staged`

### Preview Support

- preview support:
  - supported only when the deployment explicitly opts in with `preview` metadata
- preview isolation model:
  - provider-managed isolated preview target derived deterministically from deployment metadata plus run context
- preview cleanup default:
  - provider-managed cleanup with a default TTL of `7d`; deployment metadata may override when needed
- preview lock-scope default:
  - preview shares the normal deployment lock by default
  - a separate preview lock scope is allowed only when the preview satisfies the stronger independent-execution isolation bar
- required guarantees:
  - isolated effective mutable target identity
  - isolated smoke target
  - isolated cleanup path

### Smoke / Release Health

- default smoke model:
  - built-in HTTP smoke against the configured canonical URL
- preview override:
  - may use preview URL only when explicitly configured

### Retry / Idempotency

- publish retry may be allowed only for clearly transient network/provider failures
- if the provider cannot prove idempotent retry semantics after an ambiguous result, the adapter must reconcile remote state before retrying

### Partial Publish Observability

- the adapter should preserve:
  - provider-exposed deployment id or equivalent publish id
  - final publish result
- stronger partial-state guarantees are implementation-dependent and should not be assumed without explicit adapter support

### Protected/Shared Eligibility

- in policy for protected/shared single-component static-webapp deployments
- protected/shared execution must stay inside vetted built-in publisher, preview, and smoke-runner code

## Adding Another Provider

Before adding a new built-in provider for protected/shared use:

1. Define canonical target identity and lock-key semantics.
2. State supported component kinds.
3. State supported rollout modes.
4. State the default rollout mode.
5. Define preview isolation rules.
6. Define smoke/release-health rules.
7. Define retry/idempotency rules.
8. State whether partial publish state is observable.
9. State whether the provider is approved for protected/shared use.

Change-control rule:

- a built-in adapter must not widen provider support beyond the reviewed capability entry in this document
- when provider behavior changes materially, update this document first or in the same change

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
