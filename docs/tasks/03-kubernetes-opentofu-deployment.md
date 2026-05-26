# 5. Simple Kubernetes / OpenTofu Deployment to Bundle Control Plane

**Tier:** Foundation
**Priority:** 5 of 44
**Depends on:** #3 Kubernetes Cluster Provisioning, #4 Containerize Control Plane
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Deploy the containerized control plane to a Kubernetes cluster using the existing Helm-based provider and OpenTofu-managed infrastructure, replacing the current personal server as the primary control-plane host.

## What

Create a `projects/deployments/<id>/:deploy` Buck target that runs the containerized deployment
control plane on a Kubernetes cluster using the existing `kubernetes` provider family and, optionally,
an `opentofu-stack` provisioner for the namespace and ingress wiring.

The deployment must follow the existing reviewed patterns:

- `provider: kubernetes`, `publisher: helm-release`, component kind `service` or
  `third-party-service`
- `provider_target` declares `cluster`, `namespace`, `release`, and `stack_identity` /
  `state_backend_identity` when an OpenTofu provisioner is included
- Publish credentials declared as `secret_requirements` at the `publish` step, scoped to
  `secret_runtime`; ambient kubeconfig is rejected for protected/shared deployments
- Image reference pinned by immutable `@sha256` digest; mutable tags (`latest`, `staging`, `prod`)
  are rejected by the existing `kubernetes-capability-validation` path
- OpenTofu provisioner config lives under the deployment package `opentofu/` directory and
  declares separate reviewed `plan_json` and `apply_plan` artifacts (enforced in
  `opentofu-stack.ts` and `opentofu-stack-extract.ts`)

The minimum viable topology is one service replica and two worker replicas, matching the shape
already described in `cloud-control-design.md` and expressed in
`build-tools/tools/deployments/control-plane-host-profile/compose.yaml`. The Helm chart must
mount the same config, credential, records, artifact, and runtime paths the Compose profile and
NixOS container module already define.

A smoke check against `/healthz` on the service release is required after publish, using the
smoke URL derived from `<release>.<namespace>.<cluster>/healthz` or an explicit `smoke_url` in
the publisher config.

The OpenTofu stack, if included, is responsible for cluster wiring only (namespace, ingress,
service account). It is not a deployment authority. It runs through the existing
`maybeRunOpenTofuReviewedApply` path in `opentofu-apply-orchestration.ts`, which requires an
admitted provisioner plan fingerprint before any provider mutation.

## Why Now

The containerized control plane (task #4) produces a reviewed Nix-built OCI image with stable
`service` and `worker` entrypoints. Without a deployment target, that image cannot actually run
anywhere except the current personal server or a hand-configured host. This task is the first step of the
`cloud-control-design.md` Phase 3: "introduce cloud host."

Several downstream tasks are blocked on having a real cloud host for the control plane:

- Supabase Auth / WorkOS auth provider integration needs a live service endpoint that is not the current personal server
- Production monitoring and alerting needs a stable service URL to scrape
- Preview deploy support for external targets needs the cloud-hosted workers to run those deploys

Running the control plane on Kubernetes is also the path the design doc explicitly endorses for
"containerized cloud services" under the deployment provider direction section. This task
exercises the full reviewed execution path (admission, provisioner plan, publish, smoke) using
infrastructure already present in the codebase, without introducing a new provider or capability
entry.

## Risks

**Helm chart scope creep.** The Helm chart could accumulate cluster-specific policy, sidecars, or
certificate management that make it difficult to reproduce elsewhere. The chart must stay thin:
mount config and credentials, set resource requests, expose the service port. Everything else
belongs in OpenTofu or cluster policy.

**kubeconfig credential handling.** The existing `kubernetes-publisher.ts` writes the
`kubernetes_publish_kubeconfig` credential to a temp file before passing it to Helm. The
kubeconfig must come from Infisical through the `secret_requirements` path, not from an ambient
env or developer laptop. For `production_facing` protection class this is enforced by
`kubernetes-publish-credentials.ts`, but the deployment metadata must explicitly declare it.

**OpenTofu state backend.** The `stateBackendIdentity` field in the provisioner metadata must
name a backend that workers can reach at execution time. If the state backend is behind the same
cluster that is being provisioned, a bootstrapping failure could leave the cluster in an
unrecoverable state. The initial deployment should use an external state backend (S3-compatible
or Terraform Cloud) that is not gated on the cluster itself.

**Image digest pinning.** The `kubernetes-capability-validation` path already rejects mutable
image tags. The reviewed image digest must come from a published registry (not a local tarball
path), pinned by SHA-256. The OCI image packaging PR (#4) must produce and record this digest
before this deployment target can be wired up.

**Smoke URL resolution.** The default smoke URL pattern
`<release>.<namespace>.<cluster>/healthz` only works if the cluster uses a DNS convention that
matches that pattern. A real cluster may need an explicit `smoke_url` in the publisher config.
A wrong or unreachable smoke URL will fail-close the deploy at the smoke step with a retry
budget, which is the correct behavior but needs operator attention to configure correctly.

**OpenTofu plan freshness.** The existing `opentofu-stack.ts` requires a pre-recorded
`plan_json` and `apply_plan` binary artifact checked in under the deployment package `opentofu/`
directory. These must be regenerated any time the infrastructure shape changes. If a plan drifts
without being re-recorded, the fingerprint mismatch in `runOpenTofuReviewedApply` will reject
the apply. This is correct but requires an explicit operator workflow to update them.

## Trade-offs

**Helm as publisher vs. direct Kubernetes API.** The existing Kubernetes provider implementation
uses Helm (`helm upgrade --install`) as the publisher. This is the only reviewed publisher type
for the Kubernetes provider (`publisher: helm-release`). Using raw `kubectl apply` would require
a new publisher type and a new provider-capability entry. Start with Helm.

**One deployment target vs. per-environment targets.** The existing pattern in
`contract-extract-kubernetes.ts` derives `provider_target_identity` from
`kubernetes:<cluster>/<namespace>/<release>`. Staging and production will be separate
`projects/deployments/<id>/` packages with separate `provider_target` blocks, not a single
parameterized target. This matches how all other multi-environment deployments are handled in the
repo.

**OpenTofu provisioner as optional vs. required.** The Kubernetes provider supports deployments
with no provisioner. For the initial cloud host, including OpenTofu for namespace and ingress
provisioning is reviewed but not mandatory. A cluster where the namespace and ingress are
pre-existing can skip the provisioner block entirely. The provisioner should be added when the
cluster wiring is not already managed outside the repo.

**Protection class.** The control plane deployment should use `production_facing` protection
class, which enforces that publish credentials come from `secret_runtime` only, ambient
kubeconfig is rejected, and exact-artifact retry or rollback must go through the reviewed
control-plane front door. Using `shared_nonprod` for an initial staging host is acceptable while
the smoke and rollback paths are being validated, but `production_facing` must be set before
traffic from `the deployment control plane endpoint` is cut to the cloud host.

## Considerations

**Deployment package location.** Follow the convention in `projects/deployments/` for the Buck
target. The package will need a `BUCK` file (or `TARGETS`), a `publisher_config` YAML or JSONC
file for Helm values (the `chart` field is required; `smoke_url` is recommended), and an
`opentofu/` subdirectory if an OpenTofu provisioner is included.

**Credential wiring.** The publish-step `secret_requirements` must name the
`kubernetes_publish_kubeconfig` credential. The Infisical deployment scoped to this deployment
must provision that credential through the reviewed Infisical Universal Auth path. The kubeconfig
secret is the only worker-side secret the Kubernetes publisher reads (`kubernetes-publisher.ts`
line 29). OpenTofu provision credentials are separate and resolved through `enterStep("provision")`
in `opentofu-apply-orchestration.ts`.

**Helm chart ownership.** The Helm chart is a provider-local artifact, not a Buck artifact. It
can live in the `opentofu/` or a `helm/` directory within the deployment package, or point to a
chart hosted in an OCI registry. The `chart` field in the publisher config is a Helm chart
reference (path or OCI URL). If the chart is repo-local, it must be checked in and treated as
a provider-local publish-only input, not an independently admitted deployment artifact.

**NixOS module parity.** The NixOS container module at
`build-tools/tools/nix/deployment-control-plane-container-module.nix` and the Compose profile at
`build-tools/tools/deployments/control-plane-host-profile/compose.yaml` already define the
config, credential, records, artifact, and runtime mount paths. The Kubernetes deployment must
use the same path conventions inside the container. Config mounts at
`/etc/deployment-control-plane/config.yaml`, credentials at
`/run/deployment-control-plane/credentials`, and writable state under
`/var/lib/deployment-control-plane/`.

**Validation gates before cut-over.** Per `cloud-control-design.md`, before moving
`the deployment control plane endpoint` to the cloud host the following must pass: `sprinkleref --check` shows no
missing deployment secrets, `/healthz` and `/readyz` return 200, worker heartbeats are visible,
artifact write/read/head fixture passes, database queue and lock fixture passes, and one
protected/shared staging deploy succeeds end to end.

**OpenTofu plan recording workflow.** An operator must run `tofu plan -out=<binary>` and
`tofu show -json <binary> > plan_json` against the target cluster before the deploy can be
admitted. The `opentofu-stack.ts` reader validates that `apply_plan` is a binary plan artifact
(first byte must not be `{` or `[`) and that `plan_json` is valid JSON. A helper script or
documented runbook step is needed so operators can regenerate these without accidentally checking
in a plaintext secrets dump.

**sprinkleref.** After wiring the deployment secrets in Infisical, run `sprinkleref --check` to
confirm all `secret_requirements` contract refs are satisfied. The `sprinkleref-check.ts` tooling
scans deployment metadata for declared secret references and cross-checks them against the
Infisical project. Missing refs fail the check and block protected/shared deploy submission.
