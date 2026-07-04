# 35. SBOM Generation

**Tier:** Security Hardening
**Priority:** 35 of 44
**Depends on:** #4 Containerize Control Plane
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Generate an SPDX or CycloneDX SBOM from the Nix-built control plane OCI image at CI build time and attach it to the admitted artifact record via the existing `sbomRefs` field in `DeploymentCiAdmissionEvidence`.

## What

Generate a Software Bill of Materials (SBOM) for the `control-plane` OCI image at Nix
build time and attach it to the admitted artifact record in the control plane.

Concretely this means:

1. **Generate the SBOM during `nix build`** for the `deployment-control-plane-image` derivation
   defined in `build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix`. The image
   is built with `pkgs.dockerTools.buildLayeredImage`, so its full Nix closure is available at build
   time via `nix path-info --recursive`. Either:
   - Run `pkgs.syft` against the finished image tarball to produce a CycloneDX JSON SBOM, stored
     alongside the image as a separate Nix derivation output, or
   - Use `nix path-info --recursive --json` on the closure and emit an SPDX JSON document from
     those store paths. The Nix store path graph is an inherently complete and reproducible
     component inventory; transforming it to SPDX is the lightest-weight path.
2. **Attach the SBOM reference to CI admission evidence.** The `DeploymentCiAdmissionEvidence` type
   (`build-tools/tools/deployments/deployment-ci-admission.ts`) already declares an optional
   `sbomRefs?: string[]` field. CI should populate this field with the immutable content-addressed
   reference (e.g. `oci://sbom/deployment-control-plane@sha256:<digest>` or a retained artifact ref
   from the control-plane artifact store) for the SBOM document generated in step 1.
3. **Store the SBOM in the artifact store and record its ref.** The control plane already persists
   `sbom.recordRef` in retention records (`deployment-control-plane-retention.ts`). When the
   control plane admits the CI submission it should upload the SBOM artifact alongside the image,
   record the `recordRef` in the deployment record, and surface it in the policy evaluation result
   (the `sbom?: DeploymentSbomFact` field on `DeploymentAdmissionPolicyEvaluation`).
4. **Wire the SBOM policy fields.** `admission_policy` already supports `sbom_required: true` and
   `accepted_sbom_formats: ["cyclonedx-json"]` or `["spdx-json"]` on `shared_nonprod` and
   `production_facing` deployments. The supply-chain evaluator
   (`deployment-admission-supply-chain-evaluator.ts`) already enforces these fields at admission.
   Enable the policy on the `sample-webapp` control-plane deployment.

No new infrastructure is required. `pkgs.syft` is available in `nixpkgs-unstable` (the locked
flake input already at `nixpkgs`). Nix store path introspection via `nix path-info` is already used
in the repo (`build-tools/tools/ci/run-stage.ts`, `build-tools/tools/dev/node-modules-build.ts`).

## Why Now

The deployment contract (`docs/deployments-contract.md`) already requires that CI admission
evidence optionally carries SBOM references, and the `admission_policy` schema already models
`sbom_required` and `accepted_sbom_formats` as first-class fields. The admission evaluator and
supply-chain evaluator enforce these fields at admission time. The gap is that the build pipeline
does not yet produce or submit an actual SBOM document.

Task #36 (supply-chain scanning) uses the SBOM as its input — it scans for vulnerabilities and
license violations against the SBOM generated here. Task #36 cannot be done without a machine-readable
SBOM. Task #43 (make viberoots public) requires that the project's supply-chain transparency story
be credible to outside contributors and enterprise users; an attached, content-addressed SBOM on
every admitted artifact is a minimum bar for that.

Doing this immediately after the OCI image lands (#4) means the SBOM is generated from the same
Nix derivation graph that already exists, while that derivation is freshly implemented and its
closure is well-understood.

## Risks

**SBOM generation method choice.** `nix path-info --recursive --json` yields the exact store
closure, which is complete and reproducible, but the output is Nix-native and requires a post-processing
step to produce a standards-compliant SPDX or CycloneDX document. `syft` applied to the finished
image tarball is simpler to produce as a CycloneDX document but operates on the OCI layer contents
rather than the Nix closure graph, so it may miss transitive dependencies resolved through symlinks
at the Nix store level. Either approach needs a review step to confirm coverage before the policy is
enabled in enforcement mode.

**SBOM format acceptability.** The supply-chain evaluator validates the SBOM format string against
`accepted_sbom_formats` from the admission policy. If the format emitted by the build step does not
exactly match the declared format string (e.g. `cyclonedx-json` vs `application/vnd.cyclonedx+json`),
admission will fail closed. The format normalization between build output and policy declaration must
be verified before enabling `sbom_required: true` on any protected deployment.

**Artifact store upload in CI.** The SBOM must be uploaded to the control-plane artifact store and
its content-addressed ref submitted as part of CI admission evidence before the mutating publish run
begins. If CI uploads the image but fails before uploading the SBOM, and the admission policy
requires an SBOM, the run is rejected. CI retry semantics and idempotency around partial uploads
must be confirmed before the policy is enforced.

## Trade-offs

**`nix path-info` + custom SPDX emitter vs. `syft`.** The Nix closure approach is guaranteed
complete for a Nix-built image, is already reproducible by construction, and avoids adding a
container-scanning tool to the build toolchain. The tradeoff is that the SPDX emitter is a small
bespoke script rather than a maintained tool. Using `syft` gives an immediately standards-compliant
CycloneDX document without custom code, but requires adding `pkgs.syft` as a build-time input and
running it against the image tarball, which is slower and slightly less precise than closure
introspection. Either is acceptable; the choice should be documented in the Nix expression.

**Enforcement vs. non-enforcement on first landing.** Landing the SBOM generation step with
`sbom_required: false` and the ref attached only as advisory evidence allows the pipeline to prove
correctness before failing closed on a missing or malformed SBOM document. Switching to
`sbom_required: true` is then a one-line policy change once the ref is confirmed present and
correctly formatted across several CI runs. This staged approach is lower risk than enabling
enforcement immediately.

**Separate derivation output vs. embedded label.** Producing the SBOM as a separate Nix derivation
alongside the image (a second output from the build expression) keeps the image layer content
stable. Embedding the SBOM path as an OCI image label is an alternative but pollutes the image
config and changes the image digest on every SBOM update even when the runtime content is
unchanged.

## Considerations

**The image derivation is already the right anchor.** The `deployment-control-plane-image.nix`
expression already exposes a `runtime` derivation and an `image` derivation. Adding a third
derivation output for the SBOM (e.g. `sbom`) alongside `image` keeps the build expression coherent
and lets CI handle them as a unit: build image, build SBOM, upload both, submit refs together.

**The admission evidence shape is already correct.** `DeploymentCiAdmissionEvidence.sbomRefs` is a
`string[]` to allow for the possibility of multiple SBOM formats (e.g. both SPDX and CycloneDX).
For the initial implementation, one format is sufficient. The fixture tests in
`deployment-ci-admission.test.ts` and `nixos-shared-host.deploy.jenkins.exec.test.ts` already
exercise the `sbomRefs` field using a synthetic `oci://sbom/sample-webapp@sha256:beef` ref; the real
implementation should produce an analogous immutable content-addressed ref.

**The supply-chain evaluator is already implemented.** `deployment-admission-supply-chain-evaluator.ts`
already validates the SBOM format string against policy and rejects invalid or missing SBOM
material with `DeploymentAdmissionError("no_longer_admitted", ...)`. No evaluator changes are
needed for the initial SBOM format.

**Retention is already modeled.** `deployment-control-plane-retention.ts` already includes
`sbom?: { recordRef?: string }` in the retention record shape. Populating `recordRef` when the
SBOM is uploaded to the artifact store is all that is required to make the SBOM durable and
auditable across rollback and replay flows.

**Minimum retention applies.** SBOM records are supply-chain evidence and must be retained for at
least the artifact retention window: 30 days for `shared_nonprod` and 180 days for
`production_facing`. The artifact store upload should tag the SBOM with the same retention class as
the image artifact it describes.
