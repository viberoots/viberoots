## Gleam as a First‑Class Language — Design

Audience: Engineers and LLM agents implementing Gleam support. This design integrates Gleam into the existing Buck2 + Nix + providers + glue workflow, following methodology, path invariants, and reuse of existing patterns for Go/Node.

### Goals

- Integrate Gleam builds hermetically via Nix with Buck2 orchestration.
- Use provider wiring and auto‑map so only impacted Gleam targets rebuild.
- Support patching of third‑party Gleam/Hex packages via flat `patches/gleam/*.patch` with idempotent tooling and (optional) dev overrides.
- Keep design language‑plugin‑style: small planner/templates, thin macros, shared glue.

### Scope (initial)

- Target Gleam → Erbuild-tools/lang/BEAM builds. JS target may be added later.
- Single‑importer per project (no workspace importers like PNPM). Treat each Gleam project as one “importer”.
- Build/test via Gleam’s toolchain; dependencies come from Hex.

### Linking expectations

I follow the repo-wide linking model described in `build-tools/docs/cpp-linking.md`, `build-tools/docs/wasm-linking.md`, and `build-tools/docs/linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `build-tools/tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

### Shared wiring and contracts (current repo)

Use the canonical helper surface from `//build-tools/lang:defs_common.bzl` and `//build-tools/lang:language_wiring.bzl`. Macro call sites should not re‑implement wiring or load provider maps directly.

- Preferred macro entrypoint: `prepare_language_wiring(...)` (non‑mutating), with `wiring=` for `genrule`, `nix_calling_genrule`, `non_genrule`, or `srcsless_rule`.
- Provider wiring: load `MODULE_PROVIDERS` from `//build-tools/lang:auto_map.bzl` and use `providers_for`/`realize_provider_edges` for deterministic provider edges.
- Lockfile labels (importer‑scoped languages): `lockfile:<path>#<importer>` with supported importer roots `.` and `projects/apps/*`/`projects/libs/*`; importer‑scoped macros must live in the importer package so importer‑local patch globs are valid action inputs.
- Patch model contract: `build-tools/lang/lang_contracts.bzl` and `build-tools/tools/lib/lang-contracts.ts` define `patch_scope:*` stamping and whether glue runs on patch apply/remove.
- Global Nix inputs: for Nix‑calling macros, use `wire_global_nix_inputs(...)` so `global_nix_inputs()` are real action inputs; labels are observability only.

### Build route policy

Policy for this language:

- Implement artifact-producing macros as Nix-backed builds.
- Keep Buck as graph and test-impact orchestrator, not the producer of production artifacts.
- Allow orchestration wrappers that call `nix build` when inputs remain hermetic and deterministic.
- Allow probe-only non-build macros only when explicitly documented as non-artifact paths.
- Do not introduce fallback Buck artifact build paths for convenience.

### Enforcement integration requirement

Language rollout is not complete if it only adds build plumbing. I also need to keep migration
policy enforcement current:

- Add and maintain public macro rows in `docs/handbook/nix-gaps.md`.
- Keep intentional non-build macros in `docs/handbook/nix-gaps-exceptions.json` with
  `kind = "probe-only"` and non-empty justification.
- Extend `build-tools/tools/dev/nix-gaps-inventory-check.ts` and related tests under
  `build-tools/tools/tests/dev/` when route contracts change.
- Ensure required repo validation runs this checker so doc/policy drift fails before merge.

### Key Assumptions (to validate)

1. Lock and manifest: Gleam projects provide `gleam.toml` and a lock artifact (manifest) we can parse deterministically. Many projects generate `manifest.toml` under `build/`; we assume a repo‑tracked lock file (e.g., `manifest.toml` or `gleam.lock`) will be available or we will generate/commit a stable lock snapshot file (see Risks/Mitigations).
2. Nix inputs: We can model Gleam deps as fixed‑output derivations (FOD) with pre‑computed hashes, analogous to `gomod2nix`. If no community tool exists, we will generate a repo‑tracked lock snapshot with URL+hash for Hex tarballs (gleam/erlang pkgs) via a zx script.
3. Tooling availability: nixpkgs provides `gleam` and Erbuild-tools/lang/OTP; if needed we pin versions in the dev shell and CI.
4. Patching: Third‑party deps resolved from Hex tarballs can be patched by applying unified diffs in Nix before compile, same as Go patches.

### High‑Level Architecture

- Buck2 remains the orchestrator. Targets using Gleam carry `labels = ["lang:gleam", "lockfile:<path>#<project>"]`.
- A planner entry dispatches Gleam targets to Nix language templates.
- Nix templates build projects/apps/libs using a cached deps derivation and apply patches/dev‑overrides.
- Provider sync generates `TARGETS.gleam.auto` (one provider per importer/lockfile); auto‑map includes the provider for each labeled target.
- Patching UX integrates with `patch-pkg` outer CLI via `patch-gleam.ts`.

### Path Invariants

- Lock/manifest lives in project (e.g., `projects/apps/<name>/gleam.lock` or `projects/apps/<name>/manifest.toml`).
- Patches live under `patches/gleam/` (flat directory, no subdirs). Filenames: `<package>@<version>.patch` (lowercased; `/` encoded as `__` if needed).
- Language templates under `build-tools/tools/nix/templates/gleam.nix` and aggregated from `build-tools/tools/nix/lang-templates.nix`.
- Provider files under `//third_party/providers/**` are generated (not hand‑edited).

### Buck Macros (`//gleam/defs.bzl`)

- Provide thin wrappers `nix_gleam_library`, `nix_gleam_binary`, `nix_gleam_test` analogous to Go/Node macros.
- Stamp labels: `lang:gleam`, `kind:<lib|bin|test>`, and the importer‑scoped lockfile label (see Exporter Labels).
- Append providers from `//build-tools/lang:auto_map.bzl` using `MODULE_PROVIDERS["//pkg:name"]`.

### Exporter Labels (authoritative)

- Attach importer‑scoped lockfile labels to Gleam targets: `lockfile:<relative/path>#<project-id>`.
- Rationale: reuse existing lockfile‑scoped provider mapping logic (Node pattern), allowing per‑project invalidation.
- The exporter’s Gleam adapter also validates stamping of `lang:gleam` and presence of the lockfile label.

### Planner Dispatch (graph‑generator)

- Extend dispatch to recognize Gleam via `rule_type` or `labels` containing `lang:gleam`.
- For each Gleam node, pick kind: `bin` for binaries, `lib` for libraries/tests.
- Provide minimal inputs to templates: `name`, `subdir`, `lockfilePath`, `patchDir`, and `devOverrideEnv`.

### Nix Language Templates (`build-tools/tools/nix/templates/gleam.nix`)

Functions: `gleamApp { name, lockfilePath, subdir ? ".", devOverrideEnv ? "NIX_GLEAM_DEV_OVERRIDE_JSON", patchDir ? ../../patches/gleam }` and `gleamLib { ... }`.

Responsibilities:

- Build a deterministic deps set from `lockfilePath` using a pre‑materialized derivation (see Deps Derivation below).
- Construct `patchesMap` via `H.patchesMapFromDir patchDir` from `build-tools/tools/nix/lib/lang-helpers.nix`.
- Parse dev overrides via `H.readDevOverrides devOverrideEnv`.
- Fail in CI via `H.guardNoDevOverridesInCI devOverrideEnv`; warn locally (shared helper pattern).
- Build via `gleam build --target erlang` (or `test`) within a Nix builder that sets `GLEAN_DEPS_PATH` (or appropriate env) to the deps derivation.

Deps Derivation (FOD):

- A separate pure derivation `gleamDeps { lockfilePath }` materializes all dependencies into the Nix store.
- Inputs: a repository‑tracked lock snapshot file (e.g., `gleam-deps.lock.json` or `gleam2nix.toml`) listing package name, version, URL, sha256.
- The derivation fetches each tarball from Hex (or mirrors) using `fetchurl` with the declared hash and unpacks into a deterministic layout consumed by the templates.
- The lock snapshot is generated by a zx tool (see Tooling) and committed like `gomod2nix.toml` is.

Patches and Overrides application:

- For each matching module key, apply unified diffs to the unpacked dependency source before compile.
- Dev overrides replace the source directory for that module with a local path (non‑hermetic) for fast iteration; forbidden in CI.

### Tooling (zx)

- `build-tools/tools/dev/install-deps.ts` integration: add a Gleam path that, when `gleam.toml` is detected, runs a zx helper to generate/update the lock snapshot file (e.g., `gleam-deps.lock.json`) from the project’s manifest/lock. This mirrors `gomod2nix` integration policy.
- `build-tools/tools/buck/export-graph.ts`: add a Gleam adapter that ensures targets with Gleam sources carry `lang:gleam` and the importer lockfile label.
- `build-tools/tools/buck/sync-providers-gleam.ts`: parse the Gleam lock snapshot; emit `third_party/providers/TARGETS.gleam.auto` with exactly one provider per importer (lockfile), including only relevant `patches/gleam/*.patch` used by that importer’s effective dependency set.
- `build-tools/tools/buck/gen-auto-map.ts`: no language change required; it already maps any `lockfile:<path>#<importer>` to a provider name via shared helpers. We will reuse `providerNameForImporter`.
- `build-tools/tools/patch/patch-gleam.ts`: implement `LanguageHandler` for Gleam. Subcommands:
  - `start <package>`: prepares a temp workspace by copying the package’s Nix‑materialized source (from deps derivation) to a writable dir; records in `.patch-sessions.json`; launches `$PATCH_EDITOR` if set.
  - `apply <package>`: produces canonical diff `patches/gleam/<pkg>@<ver>.patch`, then runs provider sync + auto‑map.
  - `reset <package>`: discards temp and clears dev override.
  - `session <package>`: interactive apply/reset flow.
- `build-tools/tools/dev/startup-check.ts`: print a warning if `NIX_GLEAM_DEV_OVERRIDE_JSON` is set; fail in CI (pattern reuse).

### Providers and Auto‑Map

- Provider rule file: `//third_party/providers/defs_gleam.bzl` with a simple `gleam_importer_deps(name, lockfile, importer, patch_paths = [])` genrule that stamps content hash of the lockfile + patch files (mirroring Node’s `node_importer_deps`).
- Provider sync output: `third_party/providers/TARGETS.gleam.auto` listing `gleam_importer_deps(...)` entries for each detected Gleam importer.
- Auto‑map: `build-tools/tools/buck/gen-auto-map.ts` already converts any `lockfile:...#...` label to `providerNameForImporter(...)`; thus Gleam targets will receive the correct provider dependency automatically via macros. Per‑module mapping can be added later by extending auto‑map.
- Invalidation: Macros include importer‑local patch files in `srcs` to ensure precise Buck invalidation; provider stamps remain metadata‑only (mirrors Node).

### Labels Summary

- `lang:gleam`: stamped by macros/exporter on Gleam targets.
- `lockfile:<relative/path>#<project-id>`: attached by exporter; used by auto‑map to include the importer provider.

### CI Stages

1. Codegen (if any) — unchanged.
2. Export Graph — includes Gleam targets and labels.
3. Sync Providers (Go) — unchanged.
4. Sync Providers (Node) — unchanged (optional).
5. Sync Providers (Gleam) — run `build-tools/tools/buck/sync-providers-gleam.ts`.
6. Generate auto_map — unchanged.
7. Pre‑build guard — extend to fail if Gleam lockfiles exist but `TARGETS.gleam.auto` is missing.
8. Build & Test — Buck builds Gleam targets; Nix planner instantiates Gleam derivations.

### WASM Targets (Outlook)

With repository WASM facilities, a direct Gleam→WASM path is not currently first‑class. For browser targets, prefer Gleam’s JS backend; for WASI, a future option could embed a BEAM‑in‑WASM runtime. If/when feasible, we can add `gleamWasmApp` templates that reuse patch/override maps and validate under `node:wasi`.

### Testing Plan

- Add zx tests mirroring existing suites:
  - Provider determinism/idempotency: running sync twice with unchanged inputs writes identical `TARGETS.gleam.auto`.
  - Auto‑map wiring: use `build-tools/tools/tests/e2e-provider-wiring.ts` with `--lockfile <path> --importer <project>` to assert provider presence.
  - Patching smoke: add a dummy `patches/gleam/<pkg>@<ver>.patch` and verify only targets labeled with the matching lockfile provider are impacted.

### Phased Implementation

Phase A — Scaffolding & Labels

- Add `gleam/defs.bzl` macros and stamp labels.
- Exporter adapter: ensure `lang:gleam` + lockfile labels on Gleam targets.
- Add `patches/gleam/` dir and lint (warn on subdirs, one‑patch‑per‑key).

Phase B — Provider Sync & Auto‑Map

- Implement `build-tools/tools/buck/sync-providers-gleam.ts`; write `TARGETS.gleam.auto` deterministically; reuse `build-tools/tools/lib/providers.ts` naming.
- Extend prebuild guard for Gleam.

Phase C — Nix Templates & Deps Derivation

- Introduce `build-tools/tools/nix/templates/gleam.nix` (`gleamApp`, `gleamLib`).
- Add deps derivation keyed by a repo‑tracked lock snapshot.
- Wire dev overrides and patches.

Phase D — Patching UX

- Implement `build-tools/tools/patch/patch-gleam.ts`; integrate with `patch-pkg`.
- On apply: run provider sync and auto‑map.

Phase E — Tests & CI

- Add zx tests for provider wiring and determinism; integrate into Buck test suite.
- Add CI stage for Gleam providers and extend prebuild guard checks.

### Risks and Mitigations

- Lockfile shape and stability:
  - Risk: Gleam may not commit a stable lock by default. Mitigation: Introduce a repo‑tracked lock snapshot (`gleam-deps.lock.json`) generated by zx, committed to VCS, and used by Nix deps derivation.
- Dependency fetch reproducibility:
  - Risk: Hex packages require network at build time. Mitigation: Convert to fixed‑output fetches with pre‑recorded hashes in the lock snapshot (no network during Nix builds).
- Patching third‑party deps:
  - Risk: Tarball structure variations. Mitigation: Normalize extraction layout in deps derivation and apply patches after unpack, before compile; add tests for a few samples.
- Dev overrides in CI:
  - Risk: Non‑hermetic builds. Mitigation: Reuse shared guard that throws on `CI=true` when overrides are present.
- JS target divergence:
  - Risk: Additional lock/provider strategy. Mitigation: Defer JS target; when added, reuse lockfile‑scoped provider pattern or emit per‑module labels if needed.

### Areas of Concern

- Availability or creation of a robust gleam→nix lock converter. If no tool exists, we need a minimal zx generator that queries Hex metadata and writes URL+sha256 per package version; this must be kept small and deterministic.
- Version resolution parity: Ensure the zx lock snapshot matches Gleam’s resolver exactly; otherwise builds may skew. Consider calling `gleam deps build` in a temporary, network‑enabled environment to capture the exact resolved set and their checksums, then transform into a Nixable snapshot.
- BEAM toolchain versioning: Align OTP versions across systems. Pin in dev shell and CI, propagate via Nix toolchain to avoid ABI mismatches.

### Completion Criteria

- Gleam macros exist and targets are labeled correctly.
- Providers for Gleam importers are generated deterministically and auto‑mapped; prebuild guard enforces freshness.
- Nix templates build a sample Gleam app/lib reproducibly using a repo‑tracked lock snapshot; patches and dev overrides work as designed.
- Patching flow via `patch-pkg` produces canonical patch files and updates providers/auto‑map automatically.
- Tests pass locally and in CI; impacted rebuilds are scoped to targets consuming the provider.
