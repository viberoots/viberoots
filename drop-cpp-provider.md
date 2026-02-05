### Drop C++ Provider Reliance — Design, Migration, and Acceptance

This document proposes removing the C++ provider dependency path (auto_map → provider deps) and adopting explicit, per‑target nixpkgs dependency declaration via `nixpkg_deps`, while preserving precise invalidation and impacted‑tests detection.

---

## Goals

- Simplify the C++ build pipeline: eliminate `third_party/providers` dependency for C++ targets.
- Make inputs explicit at call sites with `nixpkg_deps = ["pkgs.zlib", "pkgs.openssl"]`.
- Preserve determinism and impacted‑tests accuracy (rule‑key correctness) without provider nodes.
- Keep sparse‑checkout friendliness and reduce glue generation and maintenance.

## Non‑Goals

- No change to Node importer‑scoped providers (remain as‑is).
- No change to Go local patching (already local‑first without providers).

---

## Current State (baseline)

- C++ macros (`nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_test`) load `//third_party/providers:auto_map.bzl` and append provider deps for invalidation/introspection.
- Macros stamp `nixpkg:` labels when `nixpkg_deps` is used; the planner already reads these labels and passes them into `build-tools/tools/nix/templates/cpp.nix`.
- Prebuild guard does not require C++ provider files (only Node has strict importer provider presence).
- Optional overlay `build-tools/tools/nix/overlays/cpp-patches.nix` is gated behind env and presence checks; it is not used by default.

Problem: provider edges add glue, churn, and complexity without providing unique value once `nixpkg_deps` is first‑class and the planner consumes `nixpkg:` labels directly.

---

## Target State (after change)

- C++ macros no longer load `auto_map.bzl` nor append provider deps.
- `nixpkg_deps` remains the single source of truth at call sites; macros stamp normalized `nixpkg:` labels for the exporter.
- Planner (`build-tools/tools/nix/planner/cpp.nix`) continues to read `nixpkg:` labels (already implemented) and passes a stable, sorted `nixCxxAttrs` list to `build-tools/tools/nix/templates/cpp.nix`.
- `cpp_nix_build` explicitly declares the Nix inputs that must affect the rule key (e.g., `flake.lock`, optional overlays) in addition to local patch files carried via `srcs`.
- Prebuild guard remains Node‑focused for provider presence and freshness; no C++ provider checks are (re)introduced.

---

## Rationale and Philosophy Alignment

- Architectural minimalism: removes an entire provider family from the C++ path.
- Deterministic operations: explicit inputs, fewer generated artifacts to drift.
- Separation of concerns: C++ targets declare their Nix deps; planner translates labels → Nix args; Nix templates build deterministically.
- Local‑first: patches and attributes live with the target; sparse‑checkout friendly.

Tradeoffs were analyzed in “what is gained or lost” and favor this direction for C++.

---

## Detailed Changes

### 1) Starlark macros (C++)

- Remove provider dependency and `auto_map.bzl` load from `build-tools/cpp/defs.bzl`:
  - Drop `load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")` and any `_providers_for(...)` usage.
  - Keep (and normalize) `nixpkg_deps` → stamp `nixpkg:` labels in `labels`.
  - Continue to include local patch files in `srcs` via `local_patch_dirs` so patch edits invalidate only the owning target and rdeps.

Proposed shape (illustrative fragment):

```starlark
# build-tools/cpp/defs.bzl (illustrative; provider load removed)
load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//build-tools/lang:defs_common.bzl", "stamp_labels", "dedupe_preserve")

def _normalize_nixpkg_attr(a):
    if a == None or not isinstance(a, str): return ""
    s = a.strip()
    if s == "": return ""
    if not s.startswith("pkgs."): s = "pkgs.%s" % s
    if s == "pkgs.gtest": s = "pkgs.googletest"
    return s

def nix_cpp_library(name, **kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", ["patches/cpp"])
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    deps = kwargs.pop("deps", [])

    stamp_labels(kwargs, "cpp", "lib")

    # Include local patch files in rule inputs so Buck invalidates on patch changes
    srcs = []
    for d in local_patch_dirs:
        srcs = srcs + native.glob(["%s/*.patch" % d])

    # Stamp normalized nixpkg labels (planner consumes them)
    extra_nix_labels = []
    for a in nixpkg_deps or []:
        na = _normalize_nixpkg_attr(a)
        if na != "":
            extra_nix_labels.append("nixpkg:%s" % na)

    labels = dedupe_preserve((kwargs.get("labels", []) or []) + extra_nix_labels)

    cpp_nix_build(
        name = name,
        out = name + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps,      # no providers appended
        srcs = srcs,
        labels = labels,
    )
```

Repeat analogously for `nix_cpp_binary` and keep `nix_cpp_test` planner‑visible stamping logic, but without provider dependency or `nix_attr_map` coupling.

### 2) Planner (C++)

- Keep current logic in `build-tools/tools/nix/planner/cpp.nix`: read `nixpkg:` labels from the target (and, if desired, selected deps), build a stable, deduped list as `nixCxxAttrs`, and pass them to `build-tools/tools/nix/templates/cpp.nix`.
- Ensure local patches flow: plan already turns `.patch` files in `srcs` into the `patches` list for the Nix derivation.

No structural change required; verify sorting/dedup is stable.

### 3) Nix template (C++)

- No functional change: `build-tools/tools/nix/templates/cpp.nix` already accepts `nixCxxAttrs` and resolves pkgs deterministically to include/lib flags and static libraries.
- Confirm the template continues to be independent of provider names and uses normalized attributes only.

### 4) Buck rule implementation (`cpp_nix_build`)

- Keep patch files in `srcs` (already declared). Add explicit Nix inputs as rule inputs so Buck invalidates on Nix‑level dependency changes:
  - `flake.lock` (if present in repo root)
  - Optional overlays (if the overlay path exists and is enabled)

Implementation approach (two options):

- Minimal: add a `nix_inputs` attribute (list of sources) to `cpp_nix_build`, defaulting to `["flake.lock"]` if present, and include it in the action’s hidden inputs.
- Alternative: in macros, probe and pass a normalized list (e.g., if `//:flake.lock` exists, include it; if `build-tools/tools/nix/overlays/cpp-patches.nix` exists and overlay is enabled, include it).

Effect: changes to lockfiles or overlays invalidate affected C++ targets; `buck2 cquery 'testsof(rdeps(...))'` remains precise without provider nodes.

### 5) Prebuild guard

- No change for C++: it already does not enforce C++ provider presence.
- Keep Node importer enforcement as‑is.
- Optional: surface a local‑only warning if targets stamp `nixpkg:` labels but `flake.lock` is missing (to steer users to run the lock generation where applicable).

### 6) Provider generation tools

- Deprecate C++ path in `build-tools/tools/buck/providers/`; Node remains enabled.
- Keep the file around temporarily with a clear “no‑op for C++” note to avoid breaking scripts calling a unified “sync‑providers” step. The step becomes Node‑only.

---

## Impact on workflows

- Builds/tests: unchanged behavior; fewer glue steps required.
- Impacted tests: unchanged accuracy, provided `flake.lock` and any overlay inputs are declared as rule inputs (as specified). Patch files already participate via `srcs`.
- Observability: provider nodes will no longer appear in Buck graph queries; use labels/planner introspection instead (see “Introspection” below).

---

## Introspection and Tooling

- Add a small CLI (`build-tools/tools/buck/inspect-cpp-attrs.ts`) that reads the exported graph and prints effective `nixpkg:` attrs per target (based on labels). This replaces provider‑node based queries for auditing/debug.
- Optionally add a planner view in `graph-generator` outputs for C++: for each C++ target, emit the `nixCxxAttrs` alongside the derivation reference for easy inspection in Nix CLI or tests.

---

## Migration Plan

1. Land macro changes behind a short‑lived feature flag (optional):
   - Env var or repo config to disable provider appends; default to “off”; flip to “on” after validation.
2. Update macros to remove provider loads/appends; keep `nixpkg_deps` stamping.
3. Add `nix_inputs` visibility to `cpp_nix_build` and pass `flake.lock` if present; include overlay path when overlay is enabled.
4. Keep planner/template unchanged; re‑verify sorting/dedup and patch mapping.
5. Adjust tests:
   - Remove expectations of provider targets for C++.
   - Add tests that flipping `flake.lock` (or a test overlay) invalidates only relevant C++ targets.
   - Keep Node provider tests untouched.
6. Remove (or de‑scope) C++ provider sync paths from `build-tools/tools/buck/providers/*`; leave Node path active.
7. Update docs (handbook, scaffolding) to show `nixpkg_deps` as the only C++ path for nixpkgs deps.

Rollback is trivial: re‑enable provider append in macros and keep prior tools; no data migration is required.

---

## Acceptance Criteria

- C++ builds/tests succeed with no dependency on `third_party/providers` for C++.
- Changing a local patch invalidates only the owning target and reverse deps.
- Changing `flake.lock` (or an enabled overlay) invalidates affected C++ targets.
- Node importer‑scoped providers remain enforced by prebuild guard; Go remains local‑first.
- Sparse‑checkout flows continue to work (no global scans required).

---

## Test Plan (high‑signal cases)

- C++ patch invalidation
  - Create `projects/libs/x/patches/cpp/fix.patch` touching a symbol; verify the `//projects/libs/x:x` bin/lib rebuilds; unrelated targets cache‑hit; verify `testsof(rdeps(...))` scope matches rdeps.
- `flake.lock` invalidation
  - Touch `flake.lock` (or simulate a change) and verify only C++ targets depending on specific `nixpkg_deps` rebuild (others remain cache‑hit).
- Overlay invalidation (when overlay is enabled)
  - Place a trivial overlay; enable env flag; verify changes invalidate only affected targets.
- No providers in graph
  - `buck2 cquery deps(//projects/libs/x:x)` returns no `//third_party/providers:*` edges for C++; docs point devs to the new `inspect-cpp-attrs` CLI.

---

## Risks and Mitigations

- Loss of provider‑node observability
  - Mitigation: add a lightweight labels/planner‑based inspector CLI; rely on labels and planner dumps.
- Missed declared inputs for Nix
  - Mitigation: ensure `flake.lock` (and overlays if enabled) are always wired as rule inputs via `nix_inputs`; add a small negative test in zx.
- Transitional tooling expectations
  - Mitigation: keep unified “sync‑providers” entrypoint but make C++ a no‑op and print an informative message; keep Node behavior intact.

---

## Summary

This change removes a non‑essential moving part (C++ providers) in favor of explicit `nixpkg_deps` + planner label consumption. It reduces glue and failure modes, keeps invalidation precise by declaring true inputs, and aligns with our design philosophy of minimal, deterministic, local‑first builds.

---

## Elaborated Plan and Execution Details

### A. PR structure and sequencing

Although this can be shipped in a single PR, we recommend two fast, focused PRs:

1. Behavior PR (minimal footprint)
   - Remove provider deps from C++ macros and stop loading `auto_map.bzl` in `build-tools/cpp/defs.bzl`.
   - Add explicit Nix inputs to `cpp_nix_build` (e.g., `flake.lock`, optional overlay path when enabled).
   - Verify planner/template integration (no code change expected; just add tests).
   - Update targeted tests to no longer expect provider edges for C++.

2. Cleanup and operability PR
   - Make C++ a no‑op in provider sync tooling; keep Node path intact.
   - Add `build-tools/tools/buck/inspect-cpp-attrs.ts` for introspection.
   - Update docs and scaffolds; prune dead references; add a brief migration note in the handbook.

Both PRs keep risk low and allow quick rollback at any point.

### B. Macro edits (concrete)

- Remove:
  - `load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")`
  - `_providers_for(name)` usage in `nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_test`
- Keep and emphasize:
  - `nixpkg_deps` with normalization → stamp `nixpkg:<attr>` into `labels`
  - Include local patches via `local_patch_dirs` → `srcs` (already present)
- Outcome:
  - The Buck rule key now depends on:
    - patched files (through `srcs`)
    - explicit labels → planner → Nix attributes
    - declared Nix inputs (see next section)

### C. `cpp_nix_build` declared inputs (rule‑key correctness)

Add a Starlark attribute to the rule:

```starlark
cpp_nix_build = rule(
    impl = _cpp_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),   # "bin" | "lib"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),
        "nix_inputs": attrs.list(attrs.source(), default = []),  # NEW
    },
)
```

In `_cpp_nix_build_impl`, include `nix_inputs` as hidden inputs to the action so changes to `flake.lock` (and optional overlay when enabled) invalidate appropriately:

```starlark
hidden_inputs = ctx.attrs.srcs + ctx.attrs.nix_inputs
cmd = cmd_args(["bash", "-c", run_and_copy, out.as_output()], hidden = hidden_inputs)
```

Macro wiring (illustrative):

```starlark
def _maybe_nix_inputs():
    xs = []
    if native.glob(["flake.lock"]):
        xs.append("//:flake.lock")
    # Optional overlay when enabled by env/config; only if file exists
    if native.glob(["build-tools/tools/nix/overlays/cpp-patches.nix"]) and read_config("cpp_overlay_enabled", "0") == "1":
        xs.append("//build-tools/tools/nix/overlays:cpp-patches.nix")
    return xs

cpp_nix_build(
    name = name,
    kind = "lib",
    out = name + ".a",
    self_label = "//%s:%s" % (native.package_name(), name),
    srcs = srcs,
    nix_inputs = _maybe_nix_inputs(),
    labels = labels,
)
```

This keeps the rule key faithful to real Nix inputs without provider nodes.

### D. Planner details (no code change expected)

- Continue reading `nixpkg:` labels from the target (and tests/planner stub as needed).
- Build a stable, deduped list of `nixCxxAttrs`.
- Pass to `build-tools/tools/nix/templates/cpp.nix`.
- Ensure patches discovered from `srcs` are mapped to `patches = [...]` for the derivation.
- Confirm attribute sorting/dedup for deterministic derivation keys.

### E. Introspection CLI spec (`build-tools/tools/buck/inspect-cpp-attrs.ts`)

Purpose: replace provider‑node based graph queries for C++ with a labels/planner‑based view.

- Inputs:
  - `--target //<pkg>:name` (repeatable)
  - `--json` for machine‑readable output
- Behavior:
  - Load `build-tools/tools/buck/graph.json` (via shared `readGraph`)
  - For each target, collect `nixpkg:` labels on the node (and optionally on its direct deps if we decide to reflect inherited attrs)
  - Print a sorted, deduped list of effective attrs
- Output example (text):
  - `//projects/libs/core:lib → pkgs.zlib, pkgs.openssl`
- Output example (json):
  - `{ "targets": { "//projects/libs/core:lib": ["pkgs.openssl","pkgs.zlib"] } }`

### F. CI and guard implications

- CI stages unchanged except C++ provider sync becomes a no‑op (keep script to avoid breakage).
- Prebuild guard:
  - Continues to enforce Node importer provider presence/freshness.
  - No new C++ checks added.
  - Optional enhancement: warn locally when C++ targets carry `nixpkg:` labels but `flake.lock` is missing (not enforced).

### G. Migration / Rollback specifics

- Migration:
  - Land macros removing provider deps.
  - Add `nix_inputs` to `cpp_nix_build` and wire `flake.lock`; overlay optional path only when enabled.
  - Update tests to drop provider expectations and add `flake.lock` invalidation checks.
  - Make C++ path a no‑op in provider sync; update any docs pointing devs at provider targets for C++.
- Rollback:
  - Re‑introduce `auto_map` load and `_providers_for` append in macros.
  - Drop `nix_inputs` usage (or leave harmlessly in place).
  - No data migration needed.

### H. Expanded test matrix

- Invalidation correctness
  - Patch change → only rdeps of owning target rebuild.
  - `flake.lock` change → targets with relevant `nixpkg_deps` rebuild; unrelated targets cache‑hit.
  - Overlay enabled + changed → same as above; disabled overlay → no effect.
- Sparse‑checkout
  - Build a target with local patches present and minimal repo subset.
- Concurrency / flakiness
  - Repeated builds across cold/warm cache show stable keys and consistent rebuild scopes.
- Negative cases
  - Missing `flake.lock`: build still works; (optional) local warning emitted by guard/tooling; CI remains green.

### I. Open questions (tracked)

- Do we want inherited `nixpkg_deps` (from selected deps) or only self‑declared?
  - Default: self‑declared only (explicitness); planner can support inherited view for diagnostics, not for builds.
- Should the overlay path be treated as an opt‑in per‑target param instead of environment?
  - Recommended: remain opt‑in and centralized, guarded by presence and an explicit flag.

### J. Expected outcomes

- Simpler C++ path (no provider churn), fewer generated artifacts, faster iteration.
- Deterministic, explicit invalidation via real inputs (`srcs`, `flake.lock`, optional overlay).
- Clearer authoring model for engineers and LLM agents: set `nixpkg_deps` at the call site; everything else follows.
