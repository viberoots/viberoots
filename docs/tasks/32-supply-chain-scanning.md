# 36. Supply-Chain Scanning

**Tier:** Security Hardening
**Priority:** 36 of 44
**Depends on:** #4 Containerize Control Plane, #35 SBOM Generation
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Add a `supply-chain-scan` CI stage running `govulncheck` on Go, `pnpm audit` on Node, and `grype`/`trivy` on the Nix-built OCI image, emitting evidence conforming to the existing `DeploymentCiAdmissionEvidence` supply-chain gate schema.

## What

Implement automated supply-chain vulnerability and license scanning across every language layer in
the monorepo, wired into the existing CI pipeline as a named stage. Scanning must cover all four
dependency ecosystems that are currently in use:

- **Node/pnpm** — `pnpm audit` against the 6,990-line `pnpm-lock.yaml`; ~75 packages at the
  importer level including `wrangler@4.17.0`, `pg@^8.20.0`, `@anthropic-ai/claude-code@2.1.128`,
  `@openai/codex@0.128.0`, and `zx@^8.0.0`, plus their transitive closure.
- **Nix closure** — `grype` or `trivy` run against the Nix store paths for the
  `control-plane` OCI image produced by
  `build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix`. The image bundles
  `pkgs.nodejs_22`, `pkgs.git`, `pkgs.openssh`, `pkgs.opentofu`, `pkgs.awscli2`, `pkgs.kubectl`,
  `pkgs.kubernetes-helm`, `pkgs.bashInteractive`, `pkgs.coreutils`, and `pkgs.cacert`, all sourced
  from the nixpkgs pin at rev `e0042dedfbc9` (last modified 2025-05-27). `syft` can produce a
  CycloneDX SBOM directly from the image as input to `grype`.
- **Go** — `govulncheck` against Go packages resolved through
  `build-tools/tools/nix/graph-generator.nix`. Go dependencies are managed via `gomod2nix.toml`
  and the gomod2nix flake input pinned at rev `47d628dc3b50`. There is no separate `go.mod` in the
  repo root; the planner walks `projects/libs/*/go.mod` and the nearest ancestor `gomod2nix.toml`
  for each target.
- **Python** — scan the `uv.lock`-resolved site packages materialized by the local
  `third_party/uv2nix` shim (pinned at version `0.0.3-local`). Python deps are installed into Nix
  derivations at build time; `pip-audit` or `grype` can consume the site directory or a SBOM derived
  from it.
- **C++/Emscripten and Rust (stubs)** — the C++ solver WASM (`projects/libs/pleomino-solver-wasm`)
  has no external C++ library dependencies beyond what Emscripten and nixpkgs provide; its toolchain
  (`pkgs.emscripten`, `pkgs.llvmPackages`) is covered by the Nix closure scan. Rust is represented
  in the build graph (`langs.nix` declares `rust` as a language) but no Cargo packages exist yet;
  no Rust-specific scanner action is required until a `Cargo.toml` appears.

Scanning is distinct from SBOM generation (task #35), which produces the artifact. This task
consumes SBOMs produced by #35 as scanner input where applicable, and additionally runs scanners
that generate findings independently (e.g., `pnpm audit`, `govulncheck`).

Scanning is split across two admission gates that already exist in the deployment admission model
(`deployment-admission-supply-chain.ts`):

- `build_admission` — runs immediately after image build; blocks promotion if critical CVEs are
  present.
- `publish_admission` — runs before a deployment is admitted to a target environment; enforces
  license allowlist compliance.

The supply-chain gate evidence format (`DeploymentSupplyChainGateEvidence`) is already defined and
the evaluator (`deployment-admission-supply-chain-evaluator.ts`) already enforces that named gates
pass before admission proceeds. This task is about populating that evidence with real scanner
output rather than fixture data.

**Deliverables:**

1. A new `supply-chain-scan` CI stage in `build-tools/tools/ci/run-stage.ts` and
   `Jenkinsfile` that runs `pnpm audit`, `govulncheck`, and `grype` (against the image SBOM from
   #35) in sequence and fails the build on high/critical findings.
2. A scanner runner script (TypeScript/zx, consistent with existing CI tooling) that collects
   findings, writes structured JSON results, and maps them to
   `DeploymentSupplyChainGateEvidence` records with `status: "passed" | "failed"` for downstream
   admission consumption.
3. License compliance: a declared allowlist (e.g., MIT, Apache-2.0, ISC, BSD-2-Clause,
   BSD-3-Clause) checked against pnpm and Go dependency metadata; `publish_admission`-gated.
4. Documentation of the scanner cadence, the exemption process, and how findings are triaged.

## Why Now

The deployment admission system already has the supply-chain gate policy schema, evaluator, and
enforcement path in place. Tests like `deployment-admission.supply-chain.test.ts` already verify
that admission fails closed when gates are missing or have `status: "failed"`. What is missing is
the scanner infrastructure that produces real evidence to fill those gates. Without it, the gates
cannot be activated in any production admission policy, and the supply-chain protections are
unreachable.

This must land before viberoots goes public (#43). A public product that deploys third-party
artifacts without CVE gating exposes both the operator and tenants to known-vulnerability risk at
the moment of launch. The compliance requirement is not retroactive — the scanning infrastructure
needs to be in place before public launch, not patched in afterward.

The dependency on #4 (Containerize Control Plane) is concrete: `grype`/`trivy` scanning of the
control-plane OCI image requires the image to be built and accessible by digest. The image
expression exists at
`build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix`, but #4 is what
produces a real, promoted image with a known digest to scan against. The dependency on #35 (SBOM
Generation) is that scanning a Nix closure efficiently requires a pre-generated SBOM as input; ad
hoc scanning of raw Nix store paths is slow and produces noisier results.

## Risks

**pnpm audit false positive rate.** The `pnpm-lock.yaml` records ~75 direct dev dependencies and
their full transitive closure (~200+ packages). Many of the resolved packages (e.g.,
`@anthropic-ai/claude-code@2.1.128`, `@openai/codex@0.128.0`) are themselves AI tooling clients
that may pull in packages with advisories that are not exploitable in the viberoots build context.
Naively blocking CI on any advisory will produce friction immediately. An allowlist-based exemption
process must exist before the stage is wired into CI as a hard gate.

**govulncheck scope ambiguity.** The repo has no top-level `go.mod`. The planner walks per-target
`gomod2nix.toml` files anchored at package directories under `projects/libs`. Running
`govulncheck` at the repo root will fail or produce no results. The scanner script must discover
and scan each Go module root independently, mirroring the planner's own `gomod2nix.toml` discovery
logic in `build-tools/tools/nix/graph-generator.nix`.

**Nix image scan accuracy depends on SBOM quality.** `grype` scanning of a Nix-built OCI image
via a CycloneDX SBOM (from `syft`) produces coverage that is only as accurate as the SBOM's
component inventory. Nix store paths use content-addressed names without conventional package
metadata; `syft`'s Nix cataloger may miss packages or misattribute versions. Findings must be
manually validated against the nixpkgs pin before being treated as actionable.

**License data gaps.** Go and Python dependencies sourced through gomod2nix and uv2nix do not
include canonical SPDX license metadata in the Nix derivations. Determining license compliance
requires either querying upstream package metadata (network-dependent) or maintaining a local
license inventory alongside the lockfiles. Neither approach is currently implemented.

**CI runtime impact.** `pnpm audit` is fast. `govulncheck` is moderate. `grype` against a Nix
image SBOM can be slow on first run before the vulnerability database is cached; the CI matrix runs
across `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux`, and Grype's database download must
be handled per-agent or via a shared cache. A scanning stage that adds more than ~3 minutes to the
matrix build will have sustained adoption friction.

## Trade-offs

**Single hard-gate stage vs. advisory-only reporting.** Starting with scanning in advisory-only
mode (findings reported as JSON artifacts but not blocking CI) reduces friction during the initial
rollout but delays the security value. The supply-chain gate model already distinguishes
`build_admission` (pre-promote) from `publish_admission` (pre-deploy), which maps well to a phased
rollout: make the stage report-only first, then promote `vuln/critical` to a hard `build_admission`
gate once the exemption process is established.

**Per-ecosystem scanners vs. a unified scanner.** Running `pnpm audit`, `govulncheck`, and `grype`
separately produces best-in-class results per ecosystem but requires maintaining three different
tool versions and output-format adapters. A unified scanner like `trivy` can cover Node, Go, and
containers from one tool, at the cost of shallower findings (e.g., `trivy` does not run the same
go.sum–aware analysis as `govulncheck`). The recommended approach is per-ecosystem scanners for
accuracy, with a shared evidence serializer writing to the `DeploymentSupplyChainGateEvidence`
schema.

**Scanning the built image vs. scanning source lockfiles.** Source-lockfile scanning (`pnpm audit`,
`govulncheck`) catches vulnerabilities in the declared dependency graph before a build. Image
scanning (`grype` against the OCI image SBOM) catches vulnerabilities in what was actually
included in the image closure, including transitive Nix dependencies. Both are required; they
answer different questions and neither is a substitute for the other.

**Exemption granularity.** CVE exemptions can be scoped to a specific CVE ID, a specific package
version, or a vulnerability category. Fine-grained per-CVE exemptions are auditable but
operationally heavy; coarse category-level exemptions are easier to manage but hide detail. The
supply-chain gate policy model supports named gates (e.g., `vuln/critical`) which naturally
encodes category-level semantics; per-CVE exemption detail should live in a sidecar JSON file
alongside the scanner script, not in the gate policy itself.

## Considerations

**The admission gate schema is already wired.** `DeploymentSupplyChainGatePolicy`,
`DeploymentSupplyChainGateEvidence`, and `evaluateSupplyChainGatePolicies` in
`deployment-admission-supply-chain.ts` and `deployment-admission-supply-chain-evaluator.ts` are
production code. The scanner's job is to emit a JSON record conforming to
`DeploymentSupplyChainGateEvidence` for each named gate (`vuln/critical`, `license/allowlist`,
etc.) with `status: "passed"` or `status: "failed"`, a `recordRef` pointing to the raw findings
artifact, and an `evaluatedAt` timestamp. The evaluator will then enforce these at admission time.

**nixpkgs pin is the Nix security baseline.** All Nix-sourced packages (Node.js 22, OpenSSH,
OpenTofu, AWS CLI v2, kubectl, Helm, Emscripten, TinyGo, Python 3) come from the nixpkgs pin at
rev `e0042dedfbc9`. Updating the pin is the primary remediation path for Nix-sourced CVEs. Routine
lockfile bumps (`nix flake update`) should be part of the CVE triage workflow, not a separate
process.

**buck2 provides no scanning hooks.** The CI pipeline in `Jenkinsfile` is orchestrated through
`run-stage.ts` stages and `buck2 test //...`. There is no existing security stage. A new stage
name (e.g., `supply-chain-scan`) should be added to the `Stage` type in `run-stage.ts` and to
the Jenkins matrix alongside the existing stages. The scanner can run independently of the Buck
build graph, consuming lockfiles and the image SBOM directly.

**Python scanning scope is limited by the uv2nix materialization model.** The local uv2nix shim
(`third_party/uv2nix`) materializes Python packages from `uv.lock` files at Nix build time using a
vendored source strategy. The shim outputs a `BUILD-INFO.json` with patch provenance. There is no
central `uv.lock` at the repo root; Python lock files live per-project. The scanner must enumerate
`uv.lock` files across `projects/` and run `pip-audit` (or extract packages for `grype`) per
project.

**Rust scanning is deferred.** `langs.nix` includes a `rust` entry and the planner has a
`rust.nix` adapter, but there are no `Cargo.toml` files in the repo today. The scanner should log
a no-op result for the Rust ecosystem and produce a `passed` gate evidence record so that the
`vuln/critical` gate does not block on a missing Rust scan. When Cargo dependencies appear, the
gate evidence logic should be updated to invoke `cargo audit`.

**Keep scanner output artifacts in the deployment records directory.** The control-plane already
maintains a records directory at `/var/lib/deployment-control-plane/records`. Scanner output JSON
(raw findings and gate evidence) should be stored as deployment run artifacts following the same
naming convention as other deployment evidence, so that the admission evaluator can resolve
`recordRef` pointers consistently.
