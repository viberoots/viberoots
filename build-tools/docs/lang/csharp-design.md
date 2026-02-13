### C#/.NET as a First-class Language — Design

This document proposes how to add C# (and optionally other .NET languages like F# and VB.NET) as a first‑class language in this repository. It follows the repository’s methodology and the existing language patterns (Go, Node), reusing shared helpers and the glue pipeline: exporter → provider sync → auto‑map → planner templates.

### Goals and non-goals

- **Goal**: Integrate .NET projects (libraries, apps, tests) with Buck2 orchestration and Nix hermetic builds, enabling precise invalidation and reproducible artifacts.
- **Goal**: Support patching of NuGet package sources with idempotent patches. Prefer importer‑ or package‑local patch directories (included in target `srcs`) for precise invalidation; a repo‑level `patches/csharp/` remains available for shared cases.
- **Goal**: Keep design language‑agnostic inside the planner; .NET is a pluggable language like Go/Node.
- **Non‑goal**: Replace `dotnet` test runner or re‑implement MSBuild. We orchestrate deterministically and call supported Nix builders.

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

### Alignment with Methodology

- **Separation of concerns**: exporter (Buck graph → authoritative package labels), provider sync (deterministic provider nodes), auto‑map (target → providers), planner templates (Nix derivations), macros (Buck DX + labels), patch wrapper (dev UX). Clear modular boundaries, minimal shared helpers.
- **Determinism**: pin .NET SDK, use offline NuGet resolution via Nix‑materialized package set, treat dev overrides as warnings locally and forbidden in CI.
- **Performance‑driven**: batch exporter by config tuple (SDK/TFM/RID/etc.), cache dotnet package graphs, avoid network during builds.

### High‑level architecture

1. Buck targets (C#) are labeled with `lang:dotnet` and `kind:<bin|lib|test>` via `//csharp/defs.bzl`.
2. Exporter inspects configured C# targets, runs authoritative queries to compute the set of NuGet packages used, tagging targets with `nuget:<id>@<version>` labels.
3. Default providers are importer‑scoped (lockfile + importer), mirroring Node; per‑package providers are optional.
4. Auto‑map maps `lockfile:<path>#<importer>` and `nixpkg:<attr>` labels; mapping `nuget:` per‑package labels would require extending `build-tools/tools/buck/gen-auto-map.ts`.
5. Planner templates (`build-tools/tools/nix/templates/csharp.nix`) build .NET projects/apps/libs with `buildDotnetModule` (or equivalent), applying patches and dev overrides.

### Labels and naming

- **Per‑package label (authoritative, diagnostic)**: `nuget:<packageId>@<version>` (lowercased). Example: `nuget:newtonsoft.json@13.0.3`.
- **Default lockfile label (recommended)**: use generic `lockfile:<relative/path/to/packages.lock.json>#<importer>` so existing auto‑map wiring works out of the box.
- **Provider names**: importer‑scoped providers reuse `providerNameForImporter(lockfilePath, importer)`. If a per‑package path is adopted later, add `providerNameForNuget(id, version)` and extend auto‑map accordingly.

### Exporter (authoritative, batched)

- File: `build-tools/tools/buck/export-graph.ts` (extend existing exporter with a .NET adapter).
- **Detection**: A target is .NET if:
  - `rule_type` starts with `csharp_` or stamped `lang:dotnet` label (preferred via macros).
- **Config tuple for batching** (keys the package graph run):
  - `dotnetSdkVersion` (from Nix/toolchain), `TFM` (TargetFramework or TargetFrameworks entry), `RID` (RuntimeIdentifier), `SelfContained` flag, `Configuration` (Debug/Release), sorted `DefineConstants` (build symbols), `NuGet.config` hash.
- **Authoritative source**: For each batch:
  - Run `dotnet list <project> package --include-transitive --format json` for all root projects in the batch (grouped by TFM/RID/etc.), or parse `obj/project.assets.json` when available for finer control. Prefer `dotnet list` first for simplicity, fall back to parsing assets for accuracy.
  - Build a `packageId → version` map per target, dedup, and attach `nuget:<id>@<version>` labels to that target only (unit of invalidation is per‑target).
- **Validation**: Adapter warns if a target with `.cs`/`.fs`/`.vb` sources lacks `lang:dotnet` label (warn‑only, consistent with existing C++ advisory policy).
- **Caching**: Cache batch results keyed by (config tuple + hash of `.csproj`/`.fsproj`/`.vbproj` + `packages.lock.json` if present). Reuse identical batch outputs.

### Planner templates (Nix)

- File: `build-tools/tools/nix/templates/csharp.nix` imported by `build-tools/tools/nix/lang-templates.nix`.
- **Inputs**: `{ name, projectPath, nugetDepsNix, tfm, rid ? null, selfContained ? false, devOverrideEnv ? "NIX_CSHARP_DEV_OVERRIDE_JSON", patchDir ? ../../patches/csharp }`.
- **Implementation**: Use `pkgs.buildDotnetModule` (from nixpkgs) or a thin wrapper around it:
  - `nugetDeps` points to `nuget-deps.nix` (generated deterministically; see Install‑deps below).
  - Build parameters set from exporter/planner (TFM, RID, SelfContained, Configuration).
  - Apply patches via `H.patchesMapFromDir patchDir` from `build-tools/tools/nix/lib/lang-helpers.nix` so filename decoding stays consistent with other languages.
  - Dev overrides via `H.readDevOverrides devOverrideEnv` (mapping `"<id>@<ver>"` → absolute unpacked source path).
  - In CI: enforce via `H.guardNoDevOverridesInCI devOverrideEnv`. Locally: print a clear warning.

#### Dev overrides and patches in Nix

- For each dependency `(id@ver)`:
  - If overrides contain an entry, replace the package source with that directory.
  - Else, if patches exist, pre‑unpack the NuGet package and apply `.patch` files to its source before building consumers.
  - As with Go, patch filenames are the sole planner inputs; reapplying the same patch is a no‑op.

### Provider sync (C#)

Default path mirrors Node (importer‑scoped): use the existing orchestrator `build-tools/tools/buck/sync-providers.ts` and, when needed, a C# driver that emits one provider per `(packages.lock.json, importer)` pair. Include only patches relevant to that importer, and prefer importer‑ or package‑local patch files in macro `srcs` for precise invalidation. A per‑package provider mode is optional and would require extending auto‑map alongside a `providerNameForNuget` helper.

#### Provider rule macro

- File: `third_party/providers/defs_csharp.bzl`.
- Content: tiny `genrule` that stamps a content hash of the patch file, public visibility. Mirrors Go’s provider.

### Auto‑map integration

- Current `gen-auto-map.ts` supports `lockfile:` and `nixpkg:` labels. Use `lockfile:` for C# initially.
- If per‑package providers are introduced, extend `gen-auto-map.ts` to translate `nuget:` labels to provider names and append them to `MODULE_PROVIDERS["//pkg:target"].`

### Buck macros (DX and labels)

- File: `csharp/defs.bzl`.
- **Macros**: `nix_csharp_library`, `nix_csharp_binary`, `nix_csharp_test`.
  - Stamp labels: `lang:dotnet` and `kind:<lib|bin|test>`.
- Append providers from `//build-tools/lang:auto_map.bzl` via the same `MODULE_PROVIDERS` pattern as Go.
  - Under the hood: call Buck’s `csharp_*` rules if available; otherwise wrap `genrule` placeholders that produce a minimal artifact (for initial bring‑up), while real builds are performed via Nix derivations exposed by the planner. The macros’ key role is labels and provider deps.

### Patching workflow (outer CLI)

- **Command**: `patch-pkg <subcommand> csharp <PackageId>`.
- **start** `<id>`: materialize the package source for the exact version present in the current project set (using `nuget-deps.nix` mapping); unpack into a temp dir; set `NIX_CSHARP_DEV_OVERRIDE_JSON["id@ver"] = /abs/tmp`; if `$PATCH_EDITOR` is set, open it.
- **apply** `<id>`: produce a unified diff between the canonical extracted source and the temp dir and write to a package‑ or importer‑local patch directory (recommended), or `patches/csharp/<id>@<ver>.patch` when shared. For importer‑scoped flows, then run:
  - `node build-tools/tools/buck/sync-providers.ts`
  - `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - remove dev override and delete temp dir.
- **reset** `<id>`: remove override and delete temp dir.
- **session** `<id>`: long‑running edit session; Ctrl‑D applies; Ctrl‑C resets.
- **Idempotency**: re‑applying an unchanged patch is a no‑op.

### Install‑deps and lock materialization

- Extend `build-tools/tools/dev/install-deps.ts` to generate `nuget-deps.nix` per project or solution using a deterministic zx step (e.g., `nuget-to-nix` equivalent or a small wrapper that resolves the transitive set via `dotnet restore --locked-mode` and writes a fixed‑output mapping of `(id@version → sha256)` for offline fetch).
- This file becomes a planner input; changes to `*.csproj`/`packages.lock.json` regenerate it.

### CI and glue

- Stages (integrated with existing):
  1. Export Graph (includes .NET labels)
  2. Sync Providers (Node + optional C# driver)
  3. Generate auto_map
  4. Pre‑build guard (fail if glue missing or stale)
  5. Build via Nix `.#graph-generator` (now includes C# outputs)
  6. Buck build/test of selected targets (as today)
- Prebuild guard: optionally treat presence of `packages.lock.json` (and C# patches) as requiring a C# provider file when importer‑scoped providers are in use.

### Tests

- Add zx tests under `build-tools/tools/tests/` mirroring Go/Node patterns:
  - `exporter/csharp.labels.transitive.test.ts`: ensures `nuget:<id>@<ver>` labels attach only to targets that use them.
  - `providers/csharp.sync.idempotent.test.ts`: provider sync determinism and duplicate detection.
  - `auto-map.csharp.mapping.test.ts`: verifies `nuget:` labels map to provider deps.
  - `e2e-provider-wiring.csharp.test.ts`: adapts the existing wiring test to a small sample project; confirms only related providers appear in `deps(target)`.
- Use the project’s external timeout conventions for zx tests.

## WASM Targets (Experimental)

With repo-level WASM/WASI facilities available, .NET targets can optionally produce WASM artifacts:

- Approach: leverage the .NET WASI workload to publish `wasm-wasi` outputs for console‑style apps or libraries.
- Buck macros: introduce `nix_csharp_wasm_binary` (or a `wasm = "wasi"` knob) that stamps `kind:wasm` and forwards TFM/RID to the planner.
- Planner/templates: extend `build-tools/tools/nix/templates/csharp.nix` to a `csharpWasiApp` builder that runs `dotnet publish -r wasm-wasi` hermetically; reuse patch/override maps.
- Tests: execute under Node using `node:wasi` where applicable, asserting basic exports/behavior.

Status: platform/toolchain dependent; treated as an experimental later phase with no impact on base C# rollout.

### Phased rollout and acceptance

1. Baseline: ensure no `patches/csharp/**`; exporter and planner compile; CI green.
2. Add minimal `csharp/defs.bzl` macros and stamp labels; convert one tiny project.
   - Acceptance: no build behavior change; labels present.
3. Exporter: attach authoritative `nuget:` labels using `dotnet list` batching.
   - Acceptance: spot‑check a project with `Newtonsoft.Json`; only its targets get the label.
4. Provider sync and auto‑map: deterministic outputs; macro injects providers.
   - Acceptance: touching a `patches/csharp/<id>@<ver>.patch` invalidates only related targets.
5. Nix templates: `buildDotnetModule` wired; `nuget-deps.nix` generated in install‑deps.
   - Acceptance: Nix builds succeed hermetically (no network), dev overrides warn locally and fail CI.
6. Patch‑pkg integration for C#.
   - Acceptance: end‑to‑end patch start/apply/reset updates providers and builds as expected.

### Key assumptions to validate

- `buildDotnetModule` in our pinned nixpkgs supports the required features (TFM/RID/self‑contained, offline nuget via `nugetDeps`).
- We can deterministically derive the transitive package set with `dotnet list … --include-transitive` (or via `project.assets.json`) across SDK versions.
- `packages.lock.json` can be enabled for all .NET projects (strongly recommended) to stabilize versions.
- Prefer importer/lockfile‑scoped mapping initially (works with current auto‑map). Per‑module (`nuget:`) mapping can be added later alongside an auto‑map extension.

### Risks and mitigations

- **Network access during restore**: dotnet may attempt network access. Mitigation: use Nix‑materialized `nuget-deps.nix` and offline source; set `--locked-mode`; fail fast if network is attempted in CI.
- **SDK drift**: different SDKs produce different assets. Mitigation: pin SDK via Nix dev shell and CI; validate via `build-tools/tools/dev/startup-check.ts`.
- **RID/TFM variability**: packages can vary by RID/TFM. Mitigation: include these in the exporter config tuple and in `buildDotnetModule` parameters; batch correctly.
- **Patch application fidelity**: not all nupkgs have sources; some are DLL‑only. Mitigation: restrict patches to packages with source (e.g., `SourceLink`/symbols or packages that ship sources). Document limitations; add guardrails in `patch-csharp.ts`.
- **Large dependency graphs**: exporter performance on large solutions. Mitigation: batching, caching, and limiting to configured targets similar to Go exporter.
- **Cross‑platform parity**: ensure macOS/Linux/x86_64 builds. Mitigation: test matrix like other languages; avoid Windows‑only features.

### Areas of concern

- **Binary‑only packages**: Patching may be impractical. Consider “replace with local project” flow as an escape hatch (temporarily substitute a local project for a package).
- **Mixed‑language solutions**: Solutions with C#, F#, VB.NET share the same NuGet set; treat all as `lang:dotnet`. Ensure exporter recognizes `.fsproj`/`.vbproj` similarly.
- **Test integration**: For Buck tests that wrap `dotnet test`, verify external timeout conventions and output handling align with repository standards.

### Optional: other .NET languages

- Treat F# (`.fs`, `.fsproj`) and VB.NET (`.vb`, `.vbproj`) as first‑class under the same umbrella `lang:dotnet`.
- Exporter detects them via project file types and includes their targets in batching.
- Macros can offer aliases (`nix_fsharp_*`, `nix_vb_*`) that delegate to `nix_csharp_*` for consistent labeling and provider wiring.

### Implementation map (files to add/extend)

- `build-tools/tools/nix/templates/csharp.nix` — .NET template (patches, dev overrides, buildDotnetModule).
- `build-tools/tools/buck/export-graph.ts` — add .NET adapter (batching, `nuget:` labels).
- `build-tools/tools/buck/sync-providers-csharp.ts` — provider generator for C# patches.
- `third_party/providers/defs_csharp.bzl` — provider rule macro.
- `build-tools/tools/buck/gen-auto-map.ts` — map `nuget:` labels to providers.
- `build-tools/tools/lib/providers.ts` — `providerNameForNuget(id, version)`.
- `csharp/defs.bzl` — macros to stamp labels and append providers.
- `build-tools/tools/patch/patch-csharp.ts` — `patch-pkg` language handler.
- `build-tools/tools/tests/**` — exporter/provider/auto‑map/e2e wiring tests (one‑test‑per‑file).

### Completion criteria

- C# targets labeled and exported with precise `nuget:` labels.
- Provider sync/auto‑map deterministically wired; only impacted targets rebuild on patch changes.
- Nix builds are hermetic (offline) with pinned SDK; dev overrides warn locally and fail in CI.
- `patch-pkg` supports C# with start/apply/reset/session.
- Tests and CI stages green across supported systems.
