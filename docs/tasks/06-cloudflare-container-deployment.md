# 8. Container Deployment Provider

**Tier:** Core Providers + Auth
**Priority:** 8 of 44
**Depends on:** #4 Containerize Control Plane
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Wire a container deployment provider into a live, admission-gated path that can push a Nix-built OCI image and produce a complete, auditable deploy record.

## What

Wire the existing `cloudflare-containers` provider skeleton into a live, admission-gated deployment path that can push a Nix-built OCI image to Cloudflare Containers and record a complete, auditable deploy run.

The skeleton that exists today covers:

- Metadata extraction and validation (`contract-extract-cloudflare-containers.ts`) — ingress mode, domain/zone-id cross-checks, `workers.dev` exception policy, component-kind gating.
- Wrangler config preparation (`cloudflare-containers-config.ts`) — reads `wrangler.jsonc`, validates `containers[0].max_instances` and `sleep_after` against TARGETS metadata, injects the canonical worker name, and fingerprints the rendered config.
- A local-fake deploy (`cloudflare-containers-deploy.ts`) — calls `admitKubernetesComponentArtifacts` to record the OCI image digest or artifact directory, runs routing smoke (pass-through without a `connectOverride`), and writes a local JSON record. No Cloudflare API call is made.
- A smoke helper (`cloudflare-containers-routing-smoke.ts`) — does live HTTP smoke only when `connectOverride` is supplied; public-ingress paths without an override mark smoke as `passed` optimistically.
- A front-door gate (`cloudflare-containers-front-door.ts`) — hard-blocks `preview`, `publish-only`, `rollback`, and `provision-only`. Protected/shared mutations route through the context-selected control-plane service client and reject direct local backend flags; `local_only` deploys still use the local fake `submitCloudflareContainersDeploy` path.
- A provider capability entry (`provider-capabilities/cloudflare-containers.ts`) — registered in the capabilities registry, reviewed for metadata extraction and `local_only` use; `protectedSharedEligibility` explicitly states that live mutation fails closed until a reviewed live publisher exists.

What is missing and must be built:

1. **Live Wrangler publish step** — call `wrangler deploy` (or the Cloudflare Containers API) with the admitted OCI image digest and the rendered `wrangler.jsonc`. The publisher must inject the pinned image reference so no ambient workspace state reaches Cloudflare.
2. **Live control-plane execution for protected/shared deployments** — the front-door now submits protected/shared requests to the context-selected control-plane service with selection evidence. The service-side Containers executor still needs a reviewed live publisher, evidence binding to the immutable Cloudflare request, and snapshot freeze before protected/shared Containers deploys can mutate Cloudflare.
3. **Credential plumbing** — Cloudflare API token must arrive through the reviewed `secret_requirements` / Infisical path, not from ambient `~/.wrangler` or environment state.
4. **Real routing smoke** — after a live publish, resolve the canonical URL from the deploy record and execute an HTTP check rather than the current optimistic pass-through.
5. **`publish-only` / rollback support** — the front-door currently hard-errors on both; the capability entry defers them to "a later reviewed Cloudflare API integration."
6. **Capability entry update** — once the live publisher is reviewed, the `protectedSharedEligibility` bullet and `retryIdempotency` bullets in `provider-capabilities/cloudflare-containers.ts` must be updated to reflect the live publisher contract; the provider-capabilities doc must be re-rendered in the same change.

## Why Now

This task is priority 6 because it depends on the containerized control plane (#4) being available for admission. Once the control plane runs in a container, the same admission path used by `nixos-shared-host` and `cloudflare-pages` for protected/shared deployments can be extended to cover `cloudflare-containers`. Without this task, any backend service that targets Cloudflare Containers is limited to `local_only` fixture deploys — it cannot reach `shared_nonprod` or `production_facing` classification. The backend service deployment template (#12) lists Cloudflare Containers as a target option and is blocked until the live publisher and admission path exist.

## Risks

- **Cloudflare Containers API maturity.** Cloudflare Containers is a new offering. The Wrangler CLI surface and the Containers-specific REST API may change between the time this task starts and when the live publisher is finalized. Pin the Wrangler version and document the minimum compatible release in the capability entry.
- **OCI image push path is unreviewed.** `admitKubernetesComponentArtifacts` accepts an image-digest file or a directory artifact, but does not itself push an image to a registry. The live publisher needs a reviewed path for pushing the Nix-built image to a registry that Cloudflare Containers can pull from. If the push target is a Cloudflare-managed registry the credential model may differ from a standard OCI registry.
- **Smoke reliability on cold starts.** Cloudflare Containers may have a non-trivial cold-start latency. The optimistic public-ingress smoke pass in the current skeleton will not catch start-up failures. A live smoke must retry with appropriate backoff or Cloudflare must expose a readiness signal.
- **Secret credential scope.** The Cloudflare API token needed to call `wrangler deploy` must be scoped to the specific account and worker. Using a broad token here would be a security regression versus the `cloudflare-pages` pattern, which already enforces per-deployment account scoping.

## Trade-offs

- **Wrangler CLI vs. direct API.** Using `wrangler deploy` is the fastest path to a working live publisher and inherits Cloudflare's own retry and error handling, but it adds a runtime dependency on the Wrangler version and makes the publish step harder to unit-test. A direct REST API call would be more testable but requires maintaining the API client as the Containers API evolves.
- **Extending `admitKubernetesComponentArtifacts` vs. a dedicated admit function.** The current deploy code reuses `admitKubernetesComponentArtifacts` because the artifact contract (image digest file or directory with identity JSON) is compatible. Keeping this reuse avoids duplication but couples the Containers and Kubernetes artifact paths. If the Cloudflare-managed registry requires a different artifact shape, a separate admit function will be needed.
- **Smoke connect-override pattern.** The existing `CloudflareContainersSmokeConnectOverride` type allows injecting a test endpoint for smoke testing against a locally running container. This is useful for integration tests, but it means the live smoke path is a different code branch from the test smoke path. Any changes to smoke behavior must be tested on both branches.

## Considerations

- The `ingressMode` field has three values: `public`, `private`, and `none`. The live publisher must handle all three. `private` mode has a placeholder `x-cloudflare-containers-private-route` header in the smoke helper but no reviewed live publish contract.
- The `workersDevException` flag requires an active reviewed `target_exception` entry before a non-local-only deployment can use `workers.dev` instead of a custom domain. Ensure the live publisher enforces this check consistently with the extraction-time validation already in `contract-extract-cloudflare-containers.ts`.
- The `deploy-cli-provider-dispatch.ts` entry for `cloudflare-containers` passes only `artifactDirFlag` to the front-door, while other providers pass `publishOnly`, `sourceRunId`, `admissionEvidence`, and `smokeConnectOverride`. When admission and rollback support are added, the dispatch call must be expanded to pass those flags so the front-door can act on them.
- The provider capability entry explicitly sets `multiComponentKinds: []`, meaning multi-container deployments are out of policy for the initial live slice. Do not extend this without a separate reviewed capability update.
- The rendered `wrangler.jsonc` (written to `outputPath` in `prepareCloudflareContainersWranglerConfig`) is already fingerprinted and included in the deploy record as `workerConfigFingerprint`. Preserve this fingerprint in the live publisher record so admission evidence can bind config drift.
