## Node C++ Addon Scaffold — Development Plan (PR List)

This plan follows the same structure and subsection format as trio-alignment-14.md. Each PR is independently reversible, behavior-preserving where noted, and aims for minimal, deterministic changes consistent with our build-system design and methodology.

## PR‑1: Nix template for Node‑API C++ addon

### Description

Introduce a Nix template that builds a `.node` shared library implementing a Node‑API (N‑API) addon from C++ sources, producing reproducible artifacts for macOS and Linux. This enables C++ as a planner language to expose in-process functions to Node.

### Scope & Changes

- Add `build-tools/tools/nix/templates/cpp-node-addon.nix`:
  - Inputs: source files, headers, `addon_name`, build flags.
  - Uses `pkgs.nodejs` for Node‑API headers and correct link flags.
  - Emits `<addon_name>.node` suitable for dynamic loading by Node.
- Ensure default flags for macOS/Linux:
  - `-fPIC`, correct rpaths/undefined lookup behavior per platform.
  - Minimal, deterministic linker flags; no global env dependence.
- No changes to provider mapping, auto_map, or exporter flows.

### Acceptance Criteria

- Local `nix build` of a tiny sample derivation (included as a template smoke test) succeeds on macOS and Linux.
- Artifact produced is `<addon_name>.node` and passes `otool -L`/`ldd` sanity checks.

### Risks

- Platform‑specific flags (Darwin vs Linux) may need small tuning.

### Consequence of Not Implementing

- No reproducible way to build a C++ addon; downstream PRs blocked.

### Downsides for Implementing

- Small maintenance surface for template flags across platforms.

### Recommendation

Implement.

## PR‑2: Add `nix_cpp_node_addon` macro in `//build-tools/cpp:defs.bzl`

### Description

Add a Buck macro that stamps `lang:cpp`/`kind:addon`, includes package‑local `patches/cpp/` in `srcs` for precise invalidation, and delegates to Nix (via existing `cpp_nix_build`) selecting the new addon template.

### Scope & Changes

- `build-tools/cpp/defs.bzl`:
  - `nix_cpp_node_addon(name, srcs=[], headers=[], addon_name=None, local_patch_dirs=["patches/cpp"], nixpkg_deps=[], labels=[], ...)`
  - Output file: `<addon_name or name>.node`.
  - Preserve existing patterns from `nix_cpp_library`/`nix_cpp_binary`.
- `build-tools/cpp/private/nix_build.bzl` (if needed):
  - Add `kind="addon"` branch to select `cpp-node-addon.nix`.

### Acceptance Criteria

- A hand‑wired example target using `nix_cpp_node_addon` builds and produces `.node`.
- Changing a file under `patches/cpp/` precisely invalidates dependents.

### Risks

- Minimal; mirrors existing `nix_cpp_*` patterns.

### Consequence of Not Implementing

- Scaffolds would need ad‑hoc rules; higher churn and inconsistency.

### Downsides for Implementing

- Small increase in macro surface area.

### Recommendation

Implement.

## PR‑3: New scaffold `node/cpp-addon` (two sibling packages)

### Description

Add a Copier template `build-tools/tools/scaffolding/templates/node/cpp-addon/` that generates a Node TS library `libs/<name>` and a C++ addon `libs/<name>-native` using Node‑API.

### Scope & Changes

- Template files:
  - Node package: `package.json.jinja`, `tsconfig.json.jinja`, `src/index.ts.jinja`, `test/index.test.ts.jinja`, `TARGETS.jinja`, `README.md.jinja`.
  - C++ addon: `include/<name>.h.jinja`, `src/<name>.cc.jinja`, `src/binding.cc.jinja`, `tests/<name>_gtest.cpp.jinja`, `patches/cpp/pkgs__placeholder@0.0.0.patch.jinja`, `TARGETS.jinja`.
  - `meta.json`, `copier.yaml` with variables: `name` (required), `addon_name` (default `<name>_addon`), `includeNodeTests` (default true).
- Node TARGETS includes a helper `nix_node_gen` rule to copy `$(location //projects/libs/<name>-native:napi_addon)` into a deterministic `native/<addon_name>.node` path.
- No provider changes; importer‑scoped Node providers remain as‑is.

### Acceptance Criteria

- `scaf new node cpp-addon demo` creates `libs/demo` and `libs/demo-native`.
- Running glue (export graph, sync providers, gen auto_map) produces no unexpected diffs.

### Risks

- Template paths/loads for the addon copy could be mis-specified initially.

### Consequence of Not Implementing

- Users must hand‑roll Node↔C++ wiring; higher barrier to entry.

### Downsides for Implementing

- Template maintenance when minor APIs evolve.

### Recommendation

Implement.

## PR‑4: Build/test validation and artifact flow

### Description

Ensure the scaffold’s artifact flow is deterministic and tested end‑to‑end:

1. C++ addon builds to `.node` via `nix_cpp_node_addon`.
2. Node copy rule materializes `native/<addon_name>.node`.
3. The TS entry loads the `.node` from the stable relative path.
4. Node test verifies basic functionality (one test per file).

### Scope & Changes

- Finalize `TARGETS` in both `libs/<name>` and `libs/<name>-native` to match the flow.
- Confirm `require`/`createRequire(import.meta.url)` path resolution is robust in Buck run/test contexts.
- Add a tiny gtest for the C++ pure function (optional but recommended).

### Acceptance Criteria

- `buck2 build //projects/libs/demo:demo` succeeds after scaffolding.
- `buck2 test //projects/libs/demo:demo_test` passes (single test per file).
- (Optional) `buck2 test //projects/libs/demo-native:<name>_gtest` passes.

### Risks

- Relative path resolution to the `.node` could be brittle; mitigated by the copy rule’s deterministic output path.

### Consequence of Not Implementing

- Fragile runtime loading; intermittent test failures.

### Downsides for Implementing

- Minor complexity to keep load paths stable across environments.

### Recommendation

Implement.

## PR‑5: CI matrix and guardrails (no behavior change)

### Description

Verify cross‑platform builds (aarch64‑darwin, aarch64‑linux, x86_64‑linux) for the addon without changing prebuild guard semantics or provider wiring.

### Scope & Changes

- CI: add a small smoke build of a scaffolded example (or sample) across platforms.
- Keep `prebuild-guard` unchanged; rely on existing glue presence/freshness checks.
- Ensure no Node provider or auto_map changes are required by the scaffold.

### Acceptance Criteria

- All CI lanes build the addon successfully.
- No glue diffs beyond expected scaffold additions.

### Risks

- Toolchain discrepancies in Node headers across lanes.

### Consequence of Not Implementing

- Unverified portability; surprises after merge.

### Downsides for Implementing

- Slight CI time increase for the smoke job.

### Recommendation

Implement.

## PR‑6: Documentation and hardening

### Description

Document how to extend the scaffold (expose new functions, add sources), and apply small hardening tweaks discovered during validation (e.g., refined link flags or loader fallbacks).

### Scope & Changes

- Docs:
  - Short README within the scaffolded Node package explaining artifact layout and loading.
  - Link from repo docs to `build-tools/docs/node-call-cpp.md` as the canonical design.
- Hardening:
  - Minor tuning in `cpp-node-addon.nix` (flags) if needed.
  - Non‑functional read‑me tweaks in the scaffold for clarity.

### Acceptance Criteria

- New contributors can scaffold, build, test, and understand the flow in ~5 minutes.
- No diffs to provider/auto_map or test wiring outside the scaffold examples.

### Risks

- Very low; docs + minor template tweaks only.

### Consequence of Not Implementing

- Higher onboarding cost; repeat questions and mis‑wiring risks.

### Downsides for Implementing

- Small maintenance burden keeping docs current.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Nix template) — foundation for reproducible addon builds.
2. PR‑2 (Buck macro) — enables Buck‑side consumption of the template.
3. PR‑3 (Scaffold) — user‑facing template to generate Node↔C++ projects.
4. PR‑4 (Build/test validation) — end‑to‑end correctness of artifact flow.
5. PR‑5 (CI matrix) — portability confirmation across architectures.
6. PR‑6 (Documentation & hardening) — onboarding and final polish.

All PRs are independently reversible; each has narrow scope and clear acceptance criteria.

## Verification & Backout Strategy

- PR‑1:
  - Verify `nix build` smoke derivation outputs a `.node` artifact with correct linkage per platform.
  - Backout: remove `cpp-node-addon.nix`; no Buck changes needed.
- PR‑2:
  - Build a hand‑wired example target; verify patch invalidation via edits under `patches/cpp/`.
  - Backout: remove macro and any `kind:addon` branch; existing C++ macros unchanged.
- PR‑3:
  - Run `scaf new node cpp-addon demo`; glue steps produce expected files with no unexpected diffs.
  - Backout: delete the new template directory; no runtime paths affected elsewhere.
- PR‑4:
  - Build and test the scaffolded example; confirm deterministic `.node` load path.
  - Backout: revert scaffold TARGETS and TS load logic to prior revision.
- PR‑5:
  - CI lanes build the sample on all platforms; no provider/auto_map diffs.
  - Backout: drop the CI smoke job while leaving functionality intact.
- PR‑6:
  - Docs render and match behavior; minor template hardening validated by the same tests.
  - Backout: revert doc edits; keep functional parts unchanged.

## Summary of Expected Impact

- A minimal, deterministic, and portable way for Node code to call C++ in‑process.
- Preserves architectural boundaries: C++ remains a planner language; Node remains macro‑only with importer‑scoped providers.
- Precise invalidation via package‑local `patches/cpp/` included in `srcs`.
- Low operational overhead: no new provider shapes or glue stages; uses existing guardrails and CI patterns.
