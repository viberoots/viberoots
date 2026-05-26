# 14. Unified Health/Readiness Contract for Services

**Tier:** Observability & Reliability
**Priority:** 14 of 44
**Depends on:** #11 Backend Service Build Template(s)
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Extract the existing control-plane `/healthz`/`/readyz` implementation into a shared contract document and reusable helper, enforce path names in the Kubernetes posture validator, and wire stubs into the service scaffold.

## What

Define and enforce a uniform health and readiness endpoint contract that every viberoots service
exposes, so load balancers, Kubernetes probes, and monitoring agents always know which paths to
call, what status codes to expect, and what JSON shape to parse.

The control plane already implements `/healthz` and `/readyz` in
`build-tools/tools/deployments/nixos-shared-host-control-plane-server.ts` and the backing logic
in `build-tools/tools/deployments/control-plane-process-health.ts`. What does not exist is a
shared document or shared code that makes this the canonical, reusable contract for future
services — today it is an implicit convention that a future backend service could deviate from
without any tooling or policy catching it.

The deliverables:

1. **Written contract document** (`docs/service-health-readiness-contract.md`) specifying:
   - `/healthz` — liveness probe: `200 { ok: true, instanceId, image }`. No external dependency
     checks. Must respond even when the database or object store is unreachable. Non-authenticated.
   - `/readyz` — readiness probe: `200` or `503` depending on dependency health. Response body
     carries structured JSON with one keyed sub-object per checked dependency (e.g. `database`,
     `artifactStore`, `workers`), each with at least `{ ok: boolean }`. Non-authenticated.
   - HTTP method: `GET` only.
   - No secret-bearing fields in either response body; error reasons may summarize but must not
     include credential values, raw database error text, or provider tokens.
   - Response content type: `application/json`.

2. **Shared TypeScript helper** that any new service can import to register the two routes without
   re-implementing the pattern. The control-plane's current implementation in
   `control-plane-process-health.ts` and `nixos-shared-host-control-plane-server.ts` (lines
   75–89) is the reference; the goal is to extract the route-registration pattern into a
   reusable helper so new services do not copy-paste it.

3. **Enforcement hook in `kubernetes-service-posture.ts`** — the file already rejects a `web`
   service deployment that omits `health_path`. Extend or confirm the validation to require that
   `health_path` matches `/healthz` for any service that opts into the contract, and add a
   parallel check that `readyz` is also declared or derivable from the same base path. This gates
   the Kubernetes provider path on contract conformance.

4. **Update `#11` scaffold template** — whichever template `#11 Backend Service Build Templates`
   produces should emit a stub `/healthz` and `/readyz` implementation that satisfies the contract
   out of the box rather than leaving health endpoints to each developer.

## Why Now

Three downstream requirements all converge on the same contract:

- **#5 Kubernetes/OpenTofu** already hard-codes `/healthz` as the Kubernetes smoke URL pattern
  (`<release>.<namespace>.<cluster>/healthz` in `kubernetes-config.ts` line 133). If a service
  deviates from this path the smoke check fails with a confusing 404 rather than a contract
  violation. Formalizing the contract before multiple services are deployed is cheaper than
  retrofitting them.
- **#18 Simple Monitoring** needs stable, predictable paths to scrape. Ad hoc paths per service
  mean per-service monitoring config; a shared contract means one scrape rule.
- **#41 Autoscaling** depends on Kubernetes knowing when a replica is healthy before traffic
  reaches it. Inconsistent readiness shapes break the liveness/readiness probe configuration at
  the cluster level.

The control plane already embodies the right design. Capturing it now — before `#11` emits the
first backend service scaffold — is a small addition that pays forward across every service
added afterward.

## Risks

**Contract drift after the fact.** If any existing code path is not covered by the written
contract, a future service author will follow the code rather than the doc and introduce a
variant. The risk is mitigated by making the contract document the canonical reference and
having the scaffold emit conforming stubs automatically.

**Worker service readiness is ambiguous.** The Kubernetes posture validator already distinguishes
`service_kind = "web"` from `service_kind = "worker"`. A background worker has no HTTP surface
and therefore cannot expose `/readyz`. The contract document must state explicitly which service
kinds are required to expose health endpoints and which are exempt. Getting this wrong in the
validator would cause `worker` deployments to fail admission for missing `health_path`.

**`/readyz` response semantics.** The control-plane returns `503` when `readiness.ok` is false.
This is the correct behavior for Kubernetes readiness probes. A service author who instead
returns `200` with `{ ok: false }` will pass the readiness probe despite being unhealthy. The
shared helper must own the status-code selection so this mistake cannot happen accidentally.

## Trade-offs

**Shared helper vs. documented pattern.** A lightweight doc-only contract is faster to write and
requires no new shared code. However, it creates drift risk: future services will re-implement
rather than import. A shared helper is the better long-term call given that `#11` already
introduces a scaffold path where the helper can be wired once and reused everywhere. The tradeoff
is that the helper becomes a dependency that must be kept stable as service runtimes evolve.

**Single contract across Go and TypeScript.** The repo has no Go services yet (all active
service code is TypeScript/zx). A future Go service would implement the same two endpoints but
through idiomatic Go HTTP handlers, not a shared TypeScript helper. The written contract document
must specify path and JSON shape in language-agnostic terms so Go services can conform without
importing TypeScript. The TypeScript helper is an implementation aid, not the contract itself.

**`/healthz` response detail.** The control-plane currently returns `{ ok, instanceId, image }`
from `/healthz`. Returning `instanceId` is operationally useful for diagnosing which replica
served a request. The contract should require `ok` and allow `instanceId` and `image` as
optional non-secret fields. Requiring them for all services would be premature generalization;
omitting them entirely loses a debugging aid the control plane already provides.

## Considerations

**Existing control-plane implementation is the authoritative reference.** The liveness handler at
`nixos-shared-host-control-plane-server.ts:75–82` and the readiness handler at lines 83–89, backed
by `checkControlPlaneReadiness` in `control-plane-process-health.ts:44–58`, already do the right
thing: liveness is cheap (no I/O), readiness checks database with `SELECT 1` and artifact store
with a metadata read against `control-plane/.health`. The written contract should describe this
behavior normatively rather than inventing a different shape.

**`kubernetes-service-posture.ts` already enforces `health_path` for web services.** The check
at line 29 requires that `service_kind = "web"` deployments declare `health_path`. This PR should
confirm that the required path convention aligns with `/healthz`, and add or extend a check that
the declared path matches the expected prefix. It should not change behavior for existing
deployments that already pass the check.

**Kubernetes smoke URL is derived from `health_path`.** In `kubernetes-config.ts` the default
smoke URL is constructed from `<release>.<namespace>.<cluster>/healthz` (line 133). If a service
declares `health_path = /healthz` the smoke URL will be constructed correctly by default. If a
service uses a non-standard path, the operator must set an explicit `smoke_url`. The contract
document should note this relationship so service authors understand why `/healthz` is the
conventional choice.

**Cloudflare Containers does not yet have a liveness/readiness probe mechanism.** Task #8 notes
that Cloudflare Containers may have cold-start latency and that the current smoke is an optimistic
pass-through. The health contract applies to Kubernetes and direct-host runtimes. For Cloudflare
Containers, the contract should specify that the service still exposes the endpoints (they are
useful for internal health checks and future Cloudflare probe support) but that the platform-level
readiness signaling is not currently enforced by the provider.

**No authentication on health endpoints.** The control-plane `/healthz` and `/readyz` responses
are unauthenticated. This is intentional and correct for infrastructure probes. The contract must
state this explicitly so service authors do not accidentally add a token requirement that breaks
Kubernetes liveness probes.
