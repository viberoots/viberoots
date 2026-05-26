# ADR-00007: Infrastructure as Code Standard

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

viberoots needs a consistent, reproducible way to define, build, and deploy its infrastructure and services. The choices must satisfy several requirements simultaneously:

- Artifact builds must be hermetic and reproducible across developer machines and CI.
- Hosts viberoots controls must be declaratively configured with no configuration drift.
- Service containers must carry only explicit, reviewed dependencies — no mutable base images.
- Secrets must never be baked into image layers or checked into the build graph.
- A single development environment must be shareable by all contributors without per-machine setup steps.
- Go dependency locking must integrate cleanly with Nix's hermetic model without vendoring `.go` source files.

Several IaC approaches were considered: traditional Terraform/Pulumi for infra, Kubernetes YAML/Helm for workloads, standard Docker base images for containers, and package-manager-native toolchains for the devshell. These approaches were rejected because they introduce mutable, externally-managed state layers, imperative drift, or opaque base image contents that conflict with the reproducibility and auditability goals above.

## Decision

**Nix/NixOS is the primary IaC standard for viberoots. Buck2 is the build-graph layer on top of Nix.**

The decision decomposes into six binding rules:

### 1. Nix is the hermetic build layer

All artifact assembly is expressed as Nix derivations. `flake.nix` is the repo entry point: it declares pinned inputs (`nixpkgs` unstable, `buck2`, `gomod2nix`) and exposes devshell and build outputs. `flake.lock` pins every input to an exact revision. The question "can this recipe produce this artifact hermetically?" is answered by Nix; the question "what needs building right now?" is answered by Buck2.

### 2. NixOS for hosts viberoots controls

NixOS is the required OS for any host viberoots directly owns or controls. Non-NixOS hosts are permitted only as OCI substrates — they run Nix-built images but are not themselves declared in NixOS modules. Hosts are configured declaratively; no imperative provisioning scripts are used.

### 3. Nix-built OCI images for all viberoots-owned containers

Every viberoots-owned long-running service container is built with `dockerTools.buildLayeredImage` (or equivalent Nix OCI tooling). Image contents are assembled exclusively from reviewed nixpkgs derivations and repo derivations. No mutable base distro images (`node`, `alpine`, `ubuntu`, etc.) are used as a base. No credentials are baked into image layers. No host-specific configuration is baked into image layers. In production, image identity is pinned by immutable digest.

### 4. Minimal image shape; full NixOS is host-only

Service containers follow a minimal shape: one process entrypoint, a Nix-assembled closure, no init system. Full NixOS (systemd inside a container) is explicitly not done — NixOS belongs at the host layer. The same Nix-built OCI image runs on any OCI-compatible cloud runtime (Kubernetes, Compose, Podman, Docker, Cloudflare Containers) without modification.

### 5. No second IaC layer for viberoots-owned infrastructure

No Kubernetes YAML, Helm charts, Terraform, or Pulumi are introduced for infrastructure viberoots owns. NixOS declarative configuration and Nix-built OCI images are the complete IaC story. Provider-native configuration (e.g., Cloudflare DNS, Pages project settings) is expressed as provider-native input and is not wrapped in a second IaC framework.

### 6. Go dependencies locked via gomod2nix; devshell via `nix develop`

Go dependencies are locked in `gomod2nix.toml`; `.go` source files are not vendored into `third_party/go/`. The `gomod2nix` tool converts the Go module lock to a Nix-compatible format consumable by hermetic derivations. `nix develop` provides the single reproducible development environment for all contributors, with Buck2, Go, Node, and all other toolchain tools pinned to exact versions. `flake.nix` declares `allowed-impure-env-vars` (e.g., `BUCK_GRAPH_JSON`, `NIX_GO_DEV_OVERRIDE_JSON`) to permit local dev overrides without breaking CI hermeticity.

## Consequences

### Positive

- Builds are hermetic and reproducible: the same `flake.lock` and source tree produce the same artifacts on any machine, eliminating "works on my laptop" failure classes.
- Image contents are fully auditable: every package in a viberoots container traces to a reviewed Nix derivation with a known hash.
- Host configuration is declarative and version-controlled: NixOS module files are the authoritative source of truth for every controlled host; drift is structurally impossible.
- The devshell removes per-contributor toolchain setup; `nix develop` is the only prerequisite.
- A single OCI image artifact runs unmodified across all supported cloud runtimes, eliminating per-target build variants.
- No credentials or host-specific config in image layers reduces the blast radius of image registry compromise.

### Trade-offs

- Nix has a steep learning curve. Contributors unfamiliar with the Nix expression language or flakes model face a significant initial investment.
- Nix builds can be slow on first evaluation without a populated Nix store or remote cache. Cache warm-up is required in CI and on new developer machines.
- `gomod2nix.toml` must be regenerated whenever `go.mod` or `go.sum` changes; this is an additional maintenance step compared to vanilla `go mod vendor`.
- Provider-native configuration (Cloudflare, etc.) exists outside the Nix graph, meaning a complete picture of production state requires consulting both the repo and provider dashboards.
- Debugging failed Nix derivations requires familiarity with the Nix sandbox and derivation output paths, which differs from conventional build-system debugging.

### Obligations

- Every new viberoots-owned service container must be built with `dockerTools.buildLayeredImage` (or equivalent Nix OCI tooling). Introducing a mutable base image requires explicit ADR revision.
- Every new controlled host must be declared as a NixOS configuration. Exceptions require explicit ADR revision.
- `flake.lock` must be updated and committed when inputs are upgraded; stale locks in long-lived branches are not permitted.
- `gomod2nix.toml` must be kept in sync with `go.mod`/`go.sum` and committed alongside any Go dependency changes.
- No secrets may be introduced into image layers or Nix derivation outputs. Secret injection is a runtime concern handled outside the build graph.
- No Kubernetes YAML, Helm, Terraform, or Pulumi files may be introduced for viberoots-owned infrastructure without explicit ADR revision.
