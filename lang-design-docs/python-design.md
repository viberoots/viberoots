## Python as a First‑Class Language — Design and Integration Plan

Audience: Engineers and LLM agents implementing Python support end‑to‑end. This document aligns with the repository’s methodology and reuses existing patterns from Go and Node.

### Goals and Philosophy Alignment

- Architectural minimalism and deterministic reliability: leverage existing glue (exporter → providers → auto_map) and keep Python integration small, predictable, and testable.
- Hermetic builds via Nix; Buck2 remains the orchestrator for dependency graph and impacted tests.
- One outer patch CLI (`patch-pkg`) with language‑specific handler (`patch-python.ts`).
- Flat, per‑language patch directories; idempotency across generators and patch application.
- Cross‑platform operation: aarch64-darwin, aarch64-linux, x86_64-linux.

### Scope and Non‑Goals

- Scope
  - Python libraries and applications packaged with modern PEP 517/518 build backends (pyproject‑based).
  - Lockfile‑oriented invalidation (importer‑scoped) for precise rebuilds, mirroring Node.
  - Optional per‑distribution patching keyed as `name@version.patch`, analogous to Go’s per‑module patches.

- Non‑Goals (initial phase)
  - Universal support for arbitrary legacy `setup.py` without pyproject: supported best‑effort via Nix backends but not a hard requirement in Phase A.
  - Handling every C‑extension edge case; native extension support is in scope but escalations go to toolchain layer when needed.

---

## Path Invariants and Naming

- Patches live in `<importer>/patches/python/` (importer‑local, flat directory, no subdirectories). Filenames: `<distribution-name>@<version>.patch` (case‑insensitive keys in logic).
- Python Nix templates live in `tools/nix/templates/python.nix`, imported by `tools/nix/lang-templates.nix`.
- Buck macros live under `python/defs.bzl` and use `//third_party/providers:auto_map.bzl`.
- Provider rules live under `//third_party/providers/**` and are generated, not hand‑edited.
- Dev overrides via `NIX_PY_DEV_OVERRIDE_JSON` (JSON: `{ "name@ver": "/abs/local/src" }`). CI forbids overrides.
- Reuse common utilities:
  - Starlark helpers in `lang/defs_common.bzl` (`stamp_labels`, `ensure_single_lockfile_label`, `append_nixpkg_labels`, `providers_for`, `append_patch_srcs`).
  - Provider naming and label parsing helpers in `tools/lib/providers.ts` and `tools/lib/labels.ts`.

---

## Labels and Invalidation Model

We adopt the importer‑scoped lockfile labeling model (like Node) to get precise invalidation while avoiding heavy Python resolver parsing in the exporter.

- Label format on Python targets: `lockfile:<relative/path/to/lockfile>#<importer>`
  - Repo standard (monorepo‑wide): Python projects use `uv` exclusively; the lockfile is `uv.lock` at the importer root.
  - `<importer>` is the project root directory (e.g., `apps/pytool`) to disambiguate multiple importers.
- `gen-auto-map.ts` already maps generic `lockfile:` labels to providers using `providerNameForImporter(path, importer)`; Python reuses this machinery.
- Optional per‑distribution labels (future): `pymodule:<dist>@<version>` can be emitted by a Python adapter if we later implement authoritative module discovery. Not required in Phase A.
- Native dependencies for C-extensions: macros append `nixpkg:<attr>` labels (via `append_nixpkg_labels`) to precisely map nixpkgs inputs through `gen-auto-map.ts`, mirroring Go/C++.

---

## Nix Templates: tools/nix/templates/python.nix

Provide two functions mirroring Go’s `goApp`/`goLib` style: `pyApp` and `pyLib`. These are thin shims over the uv backend, with unified patch/override hooks.

Key responsibilities

- Accept `name`, `lockfile`, `subdir` (optional), and `devOverrideEnv` (default `NIX_PY_DEV_OVERRIDE_JSON`).
- Build using uv only, with `uv.lock` as the single source of truth (prefer via a `uv2nix` adapter; otherwise a small repo helper to translate `uv.lock` into a reproducible inputs set).
- Apply patches by matching `name@version` keys from `<importer>/patches/python/*.patch` to Python distributions during build.
- Apply dev overrides by swapping a distribution’s `src` when `NIX_PY_DEV_OVERRIDE_JSON` is set (warn locally, throw in CI).

Environment variants (uv groups)

- Support enabling uv groups (e.g., `dev`, `test`) deterministically from Nix via parameters (e.g., `groups = ["dev", "test"]`).
- Recommendation: expose additional per‑importer env attrs that toggle these groups, keeping cache keys explicit.

Sketch (illustrative)

```nix
{ pkgs }:
let
  lib = pkgs.lib;

  patchesMapFromDir = patchDir: let
    names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
    isPatch = name: lib.hasSuffix ".patch" name;
    toKey = name: let
      base = lib.removeSuffix ".patch" name;
      at   = lib.strLastIndexOf base "@";
      dist = lib.toLower (lib.substring 0 at base);
      ver  = lib.toLower (lib.substring (at + 1) (lib.stringLength base - at - 1) base);
    in "${dist}@${ver}";
    step = acc: name:
      let key = toKey name;
          val = (acc.${key} or []) ++ [ "${patchDir}/${name}" ];
      in acc // { "${key}" = val; };
  in builtins.foldl' step {} (lib.filter isPatch names);

  devOverridesFromEnv = envName: let v = builtins.getEnv envName; in if v == "" then {} else builtins.fromJSON v;

  mkPy = { pname, version ? "0.1.0", src ? ./. , lockfile, subdir ? ".", patchDir ? ../../patches/python, devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON", kind ? "app" }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverrides = devOverridesFromEnv devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI"
          else null;
      # Backend dispatch (simplified): uv only
      hasUv = builtins.pathExists (src + "/uv.lock");
    in
    if hasUv then pkgs.callPackage ./python/backends/uv.nix {
      inherit pname version src subdir lockfile patchesMap devOverrides kind;
    } else builtins.throw "uv.lock not found at importer root (Python standard is uv)";
in {
  pyApp = { name, lockfile, subdir ? ".", patchDir ? ../../patches/python, devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON" }:
    mkPy { pname = "py-${name}"; inherit lockfile subdir patchDir devOverrideEnv; kind = "app"; };
  pyLib = { name, lockfile, subdir ? ".", patchDir ? ../../patches/python, devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON" }:
    mkPy { pname = "pylib-${name}"; inherit lockfile subdir patchDir devOverrideEnv; kind = "lib"; };
}
```

Backends (thin wrapper)

- `python/backends/uv.nix`: consume `uv.lock` (prefer via `uv2nix` if available), integrate `patchesMap` and `devOverrides` when building wheels/sdists.

Notes

- We keep templates small; heavy logic goes into the uv backend helper. If `uv2nix` is unavailable, provide a tiny, pinned repo helper to translate `uv.lock` to reproducible inputs.

---

## Planner Integration (graph-generator.nix)

Extend the planner’s dispatch to include Python using the same pattern as Go/Node:

- Detect Python targets either by `rule_type` prefix `python_` or `labels` containing `lang:python`.
- Compute `kind` as `bin|lib|test` using rule type or label hint (`kind:*`).
- Determine `modulesFileFor(name)` (lockfile path) by scanning the owning package directory for `uv.lock` only.
- Emit derivations using `T.pyApp` or `T.pyLib` from `tools/nix/lang-templates.nix` with `lockfile` passed explicitly.

Example dispatch sketch (conceptual)

```nix
# inside graph-generator.nix
let
  isPy = rt: lib.hasPrefix "python_" rt;
  kindOf = rt: if lib.hasSuffix "_binary" rt then "bin" else if lib.hasSuffix "_library" rt then "lib" else null;
  lockFor = name: tools.findLockfileFor name ["uv.lock"]; # trivial file scan helper
  pyTargets = lib.listToAttrs (map (n: let name = get n "name"; k = kindOf (get n "rule_type"); lock = lockFor name; in {
    inherit name;
    value = if k == "bin" then T.pyApp { inherit name; lockfile = lock; } else T.pyLib { inherit name; lockfile = lock; };
  }) (lib.filter (n: isPy (get n "rule_type")) nodes));
in { inherit pyTargets; }
```

---

## Exporter: Labels for Python Targets

Extend `tools/buck/export-graph.ts` with a Python adapter that:

- Identifies Python targets (by `rule_type`/`labels`).
- Locates the nearest `uv.lock`, computes importer id (`<pkg dir>`), and adds a label: `lockfile:<path>#<importer>`.
- Optional validation (warn‑only): if a Python target has `.py` sources but lacks `lang:python`, print a warning (mirrors the C++ adapter policy described in the build design).

Severity

- Local: adapter warnings default to warn.
- CI: exporter enforces `error` severity globally (existing policy).

---

## Provider Sync for Python

Add a zx generator `tools/buck/sync-providers-python.ts` that:

- Scans all `uv.lock` lockfiles (`**/uv.lock`).
- For each importer, computes an effective set of distributions (simplest approach: full set from the lockfile; future enhancement may trim unused extras if encoded).
- Includes only `<importer>/patches/python/*.patch` whose `<dist>@<ver>` appears in that effective set (for introspection only).
- Writes `third_party/providers/TARGETS.python.auto` deterministically with entries (metadata‑only; patches are not consumed as srcs by the provider rule — macros pull them into target `srcs` for invalidation):

```starlark
load("//third_party/providers:defs_python.bzl", "python_importer_deps")

python_importer_deps(
    name = "lf_<hash>_<suffix>",
    lockfile = "apps/pytool/uv.lock",
    importer = "apps/pytool",
    patch_paths = [
        "apps/pytool/patches/python/requests@2.32.3.patch",
        # ...
    ],
)
```

Determinism & guards

- Stable ordering (by `name`, then by `lockfile`, then by `patch_paths`).
- Duplicate detection: error if two patch files map to the same `<dist>@<ver>`.
- Warn if any subdirectories exist under `patches/python/`.

Note: The orchestrator `tools/buck/sync-providers.ts` already drives per‑language providers. Add Python to that driver so one command regenerates all providers (Python = uv only).

---

## Provider Rule: //third_party/providers/defs_python.bzl

A minimal, metadata‑only stamp mirroring Node:

```starlark
def python_importer_deps(name, lockfile, importer, patch_paths = []):
    genrule(
        name = name,
        srcs = [],
        out = name + ".stamp",
        cmd = "echo python_importer:${importer} ${lockfile} > $OUT",
        visibility = ["//visibility:public"],
    )
```

Patch invalidation is handled by Python macros that include importer‑local patches in target `srcs`.

---

## Buck Macros: //python/defs.bzl

Thin wrappers around `python_*` rules that:

- Stamp labels (`lang:python`, `kind:*`).
- Append providers from `//third_party/providers:auto_map.bzl` using `MODULE_PROVIDERS["//pkg:name"]`.

```starlark
load("@prelude//python:defs.bzl", "python_binary", "python_library", "python_test")

def _providers_for(name):
    MODULE_PROVIDERS = {}
    load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def nix_python_library(name, labels = [], deps = [], **kwargs):
    labels = labels + ["lang:python", "kind:lib"]
    deps = deps + _providers_for(name)
    python_library(name = name, labels = labels, deps = deps, **kwargs)

def nix_python_binary(name, labels = [], deps = [], **kwargs):
    labels = labels + ["lang:python", "kind:bin"]
    deps = deps + _providers_for(name)
    python_binary(name = name, labels = labels, deps = deps, **kwargs)

def nix_python_test(name, labels = [], deps = [], **kwargs):
    labels = labels + ["lang:python", "kind:test"]
    deps = deps + _providers_for(name)
    python_test(name = name, labels = labels, deps = deps, **kwargs)
```

Using common helpers (macro outline)

```starlark
load("@prelude//python:defs.bzl", "python_binary", "python_library", "python_test")
load("//lang:defs_common.bzl", "stamp_labels", "ensure_single_lockfile_label", "append_nixpkg_labels", "providers_for")

def _providers_for(name):
    MODULE_PROVIDERS = {}
    load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
    return providers_for(MODULE_PROVIDERS, name)

def nix_python_library(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    stamp_labels(kwargs, "python", "lib")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    deps = deps + _providers_for(name)
    python_library(name = name, deps = deps, **kwargs)

def nix_python_binary(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    stamp_labels(kwargs, "python", "bin")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    deps = deps + _providers_for(name)
    python_binary(name = name, deps = deps, **kwargs)

def nix_python_test(name, lockfile_label = None, nix_native_deps = [], deps = [], **kwargs):
    stamp_labels(kwargs, "python", "test")
    ensure_single_lockfile_label(kwargs, lockfile_label)
    append_nixpkg_labels(kwargs, nix_native_deps)
    deps = deps + _providers_for(name)
    python_test(name = name, deps = deps, **kwargs)
```

Notes

- Python macros accept `lockfile_label` explicitly for clarity in scaffolds; callers usually pass `lockfile:"<path>#<importer>"`. The helper dedupes/validates exactly one importer‑scoped label.
- Use `nix_native_deps = ["pkgs.openssl", ...]` when C‑extensions require toolchain/system libs; labels become `nixpkg:<attr>` and are auto‑mapped to providers just like Go/C++.

---

## Patching Workflow: patch-pkg python

Add `tools/patch/patch-python.ts` implementing `LanguageHandler`:

- `start <dist>`
  - Resolve the distribution `name@version` currently locked for the target importer (using the selected lockfile). Locate its source (prefer sdist source; otherwise unpack wheel). Copy to temp dir (APFS CoW on macOS; `cp -a` elsewhere).
  - Update `NIX_PY_DEV_OVERRIDE_JSON` to point `name@version` → temp dir. Warn locally about overrides; CI forbids.
  - If `$PATCH_EDITOR` is set, launch it against the temp dir.

- `apply <dist>`
  - Produce unified diff: `diff -ruN "$src" "$tmp" > <importer>/patches/python/<name>@<version>.patch`.
  - Run glue: `node tools/buck/sync-providers.ts` (now includes Python) and `node tools/buck/gen-auto-map.ts`.
  - Clear dev override for that key and delete temp dir.

- `reset <dist>`
  - Remove dev override and delete temp dir without writing a patch.

- `session <dist>`
  - Long‑lived session: Ctrl‑D → apply; Ctrl‑C → reset. Explicit warnings about overrides while session is active.

Idempotency

- Re‑applying identical patch yields a no‑op provider sync; auto_map remains unchanged.

---

## CI and Glue

Stages remain unchanged; we extend drivers to include Python:

- Export Graph → Sync Providers (Go + Node + Python) → Generate auto_map → Pre‑build guard → Build & Test.
- `tools/buck/prebuild-guard.ts` continues to require `graph.json` and `auto_map.bzl`, and when lockfiles exist, at least one provider file (`TARGETS*.auto`). With Python enabled, presence of `TARGETS.python.auto` satisfies the guard when Python lockfiles are present.

Building multiple importers concurrently

- Provider sync scans all `**/uv.lock`; `gen-auto-map.ts` maps each labeled target to its importer‑scoped provider. You can build or test multiple Python targets across different importers in one command; invalidation remains importer‑scoped and cache‑friendly.

Install/lock integration

- Extend `tools/install-deps.ts` to optionally refresh Python lockfiles (uv only) when Python is enabled, mirroring Go’s gomod2nix step:
  - Detect `**/uv.lock` presence; when dependencies change, run the pinned uv/uv2nix helper to refresh reproducible inputs.
  - Keep behavior idempotent and silent when no Python importers exist.

Startup guardrails

- Update `tools/dev/startup-check.ts` to warn when `NIX_PY_DEV_OVERRIDE_JSON` is set locally and to throw (via the shared Nix helpers) in CI if overrides are present, matching Go/CPP behavior.

---

## Monorepo‑Friendly Patterns and Isolation

- Per‑importer lockfiles
  - Python projects live under `apps/*` and `libs/*`, each owning its lockfile (`uv.lock` only in the initial rollout).
  - Labels use `lockfile:<relative/path>#<importer>` where `<importer>` is the project root (e.g., `apps/pytool`).
- Isolation and non‑inheritance (no shadow deps)
  - Do not rely on a repo‑wide virtualenv; each importer’s environment is realized by Nix based on its lockfile.
  - Do not set global `PYTHONPATH` in the dev shell or CI for app/lib execution. Keep zx loader and Node tooling separate from Python runtime.
  - Root tooling (`tools/**`) must not leak into Python apps/libs; builds must use only declared deps from the importer’s lockfile.
- Hermetic dev shell integration
  - Expose per‑importer derivations (e.g., `.#py-<importer>`) and optional variants for uv groups (e.g., `.#py-<importer>-dev`, `.#py-<importer>-test`).
  - Pin Python, uv/poetry, and compiler toolchains in the flake so behavior is stable across machines and CI.
- Provider and auto‑map reuse
  - Provider naming uses `tools/lib/providers.ts` helpers (`providerNameForImporter`), identical to Node. No Python‑specific naming scheme required for importer‑scoped providers.
  - Glue files (`tools/buck/graph.json`, `third_party/providers/TARGETS*.auto`, `third_party/providers/auto_map.bzl`) are generated by zx scripts and are not committed.
- Partial‑clone friendly gating
  - Detect Python enablement via the presence of `tools/nix/templates/python.nix` (and optional `tools/nix/langs.json` entry). Missing required paths disables Python glue and scaffolding while keeping the repo usable for other languages.

---

## WASM Targets (Exploratory)

We have repository support for WASM (freestanding and WASI). For Python, direct compilation to WASM is not generally available; instead:

- Runtime‑in‑WASM: evaluate embedding a Python interpreter compiled to WASM (e.g., Pyodide‑style) for browser/WASI runtimes. Packaging and size constraints apply.
- Planner/macros: if adopted, add optional `nix_python_wasm_app` that assembles a minimal runtime + app, keeping patch/override maps at the package level.
- Tests: load under `WebAssembly.instantiate` (freestanding) or `node:wasi` and run a trivial function; keep this out of the minimal Python rollout and gate as later phase.

This remains exploratory and is not required for the initial Python support.

---

## Scaffolding

Add `tools/scaffolding/templates/python/` and registry entries so `scaf new python <lib|app>` generates:

- `pyproject.toml` (PEP 621) with a modern backend (recommend `hatchling`).
- uv‑only: generate `uv.lock` by default. Provide commented examples in README for enabling uv groups like `dev` and `test`.
- `TARGETS` stubs using `nix_python_*` macros and a `labels = ["lockfile:<path>#<importer>"]` entry.
- Minimal `src/` and `tests/` layout, one‑test‑per‑file.

---

## Tests (zx; one‑test‑per‑file)

Add targeted zx tests under `tools/tests/`:

- `exporter/python.labels-present.test.ts` — exporter adds `lockfile:` label to Python targets; warns when `.py` sources lack `lang:python`.
- `providers/sync-providers-python.idempotent.test.ts` — deterministic generation of `TARGETS.python.auto`; duplicate patch detection; flat dir warnings.
- `providers/auto-map.python-wiring.test.ts` — targets with Python `lockfile:` labels map to the correct provider; unrelated providers absent.
- `providers/auto-map.python-multi-importers.test.ts` — two importers with distinct `uv.lock` map to distinct providers; building both does not cause cross‑invalidation.
- `patch/patch-python.session.apply.test.ts` — session start/apply clears overrides and writes canonical patch filename.
- `planner/python-dispatch.test.ts` — planner picks Python templates and passes `lockfile` correctly.

All tests follow repo conventions: zx, external timeouts, single test per file.

---

## Assumptions to Validate

- `uv` is available in our flake toolchain (or we vendor a small, pinned helper if `uv2nix` is absent).
- Lockfiles are committed and stable per importer (`apps/*` and `libs/*`); Python projects won’t share one monolithic lockfile.
- We will not ship Poetry/pip‑tools support.
- Mapping distribution name ↔ package metadata (`name@version`) is unambiguous for patching; normalization is lower‑case with hyphen/underscore equivalence handled in backend.
- A single Python version is sufficient repo‑wide; if needed later, adding a per‑importer interpreter pin is a simple, optional parameter.

---

## Risks and Mitigations

- Native extensions (C/C++, Fortran) complicate reproducibility.
  - Mitigation: ensure Python builder toolchain exposes compilers via Nix; document minimal example; prefer wheels when legal and cached; otherwise build from sdist with matching toolchain.

- Backend availability divergence across platforms.
  - Mitigation: provide multiple backends and dispatch by lockfile; if a backend is missing, error early with an actionable message; keep a simple pip‑tools backend as lowest common denominator.

- Name normalization differences (`importlib.metadata` vs PyPI canonical names).
  - Mitigation: normalize keys to lowercase, treat `-` and `_` as equivalent when matching `patches/python/*.patch` and lock entries.

- Exporter correctness (finding nearest lockfile in unusual layouts).
  - Mitigation: conservative directory walk with clear error/warn messages; require explicit `labels` override if detection fails.

- Patch applicability timing (pre‑wheel vs post‑install).
  - Mitigation: apply patches at build time against sdist or unpacked wheel sources in the backend overlay phase; keep ordering deterministic.

- CI cache churn from dev overrides leaking.
  - Mitigation: shared helper throws in CI if `NIX_PY_DEV_OVERRIDE_JSON` is set; startup‑check warns locally.

---

## Areas of Concern

- Complex scientific stacks (NumPy/SciPy) may require pinned toolchain and BLAS/LAPACK selection; defer to toolchain overlays and document recipes in a follow‑up.
- Mixed lockfile ecosystems in one importer (e.g., both `uv.lock` and `poetry.lock` present) — we define a strict precedence and fail if multiple are found unless explicitly configured.
- Windows support is out of scope; design assumes Unix‑like platforms (Darwin/Linux) per current repo.

---

## Phased Implementation with Acceptance Criteria

Phase 0 — Baseline

- Add `patches/python/` (empty), `third_party/providers/defs_python.bzl`.
- Acceptance: repo builds unchanged; guard scripts pass; no providers generated without lockfiles.

Phase 1 — Planner + Templates (skeleton)

- Add `tools/nix/templates/python.nix` with uv‑only backend and group toggles.
- Wire planner dispatch to call `pyApp`/`pyLib`.
- Acceptance: one toy Python target (lib/bin) builds via Nix locally (no patches yet).

Phase 2 — Exporter Labels

- Extend exporter to attach `lockfile:<path>#<importer>` to Python targets.
- Acceptance: `graph.json` shows labels; `gen-auto-map.ts` includes Python targets in `MODULE_PROVIDERS`.

Phase 3 — Provider Sync (Python)

- Implement `sync-providers-python.ts` and update the multi‑driver.
- Acceptance: with a dummy `patches/python/foo@1.2.3.patch` and a lockfile referencing `foo==1.2.3`, the generator writes `TARGETS.python.auto` deterministically.

Phase 4 — Patch Workflow

- Add `patch-python.ts` with session/start/apply/reset; integrate glue steps on apply.
- Acceptance: applying a patch updates providers/auto_map and a Python target rebuilds as expected.

Phase 5 — Environment Variants (uv groups)

- Expose per‑importer env attrs for uv groups (e.g., `.#py-<importer>-dev`, `.#py-<importer>-test`).
- Acceptance: variant envs realize and are cached independently; CI can build multiple importers concurrently.

Phase 6 — Tests

- Land zx tests listed above; ensure idempotency, determinism, and wiring.
- Acceptance: tests pass locally and in CI with external timeouts, coverage enabled where applicable.

---

## Completion Criteria

- Python targets labeled with importer‑scoped lockfiles and auto‑mapped to providers.
- Patch creation is one command (`patch-pkg start/apply python <dist>`), glue runs automatically, and rebuild invalidation is precise.
- uv‑only backend realized and tested; optional uv group variants exposed per importer.
- Tests cover exporter, provider sync, auto‑map wiring, planner dispatch, and patch workflow.

---

## Pull Request Plan — Python Parity with Go/Node/C++

### PR‑1: Python enablement skeleton and path invariants

#### Description

Introduce minimal Python enablement without changing build behavior: path invariants, provider rule, and gating. This primes the repo for subsequent PRs while keeping CI green.

#### Scope & Changes

- Add `patches/python/.gitkeep` (flat dir; no subdirectories).
- Add `//third_party/providers/defs_python.bzl` with `python_importer_deps(...)` content‑addressed stamp (lockfile + patch paths).
- Optional gating entry in `tools/nix/langs.json` (if present) to detect Python enablement by required paths (templates, providers).
- Documentation note in this design that Python glue is presence‑based and partial‑clone friendly.

#### Acceptance Criteria

- Repo builds unchanged; no providers generated without `uv.lock`.
- `tools/buck/prebuild-guard.ts` continues to pass in repos without Python importers.

#### Risks

Very low. Adds files only; no wiring yet.

#### Consequence of Not Implementing

Later PRs would mix concerns; harder to review and revert cleanly.

#### Downsides for Implementing

None beyond a few files.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑11: uv2nix backend realization + runtime e2e

#### Description

Replace the stub uv backend with a real uv2nix-backed builder so Python apps/libs are realized as runnable environments. Add a true end‑to‑end test that patches a dependency and verifies runtime behavior changes.

#### Scope & Changes

- Backend:
  - Implement `tools/nix/templates/python/backends/uv.nix` to use uv2nix (or a pinned equivalent) to materialize an environment from `uv.lock`.
  - Integrate `patchesMap` (apply `<dist>@<ver>.patch` overlays at build time) and `devOverrides` (local source override) exactly as today.
  - Expose an executable/app entry for `pyApp` (and library build realization for `pyLib`) so Buck targets can be executed in tests.
- Planner/templates:
  - No interface change to `pyApp`/`pyLib`; they now call the real uv2nix backend.
  - Keep CI guardrails: fail in CI if `NIX_PY_DEV_OVERRIDE_JSON` is set.
- True runtime e2e (zx test):
  - Scaffold a minimal importer with `uv.lock` and a tiny Python app that imports a dependency (e.g., `requests`) and prints an identifiable string/version.
  - Use `patch-pkg start/apply python requests` (with `NIX_PY_TEST_RESOLVE_JSON` pointing at a fake origin) to introduce a visible code change (e.g., modify a function or the reported `__version__`).
  - Build the `nix_python_binary` target, execute it, and assert output reflects the patched change.
  - Re-apply an identical patch and assert a no‑op (idempotency).

#### Acceptance Criteria

- `pyApp` and `pyLib` build via uv2nix on aarch64‑darwin, aarch64‑linux, and x86_64‑linux (subject to available CI builders).
- The runtime e2e test passes: before/after execution shows changed behavior post‑patch.
- Re‑applying the same patch is a no‑op in glue and build (idempotent).
- Provider sync and auto_map remain deterministic; no unintended churn from uv2nix adoption.

#### Risks

- uv2nix availability/version drift across platforms.
- Larger derivation closures affecting CI time.

Mitigations:

- Pin uv/uv2nix in the flake.
- Keep outputs minimal for the runtime test (single importer, single dep).

#### Recommendation

Implement.

Re-evaluation: After landing this PR, evaluate whether we should add optional uv group variants to expand runtime coverage.

### PR‑2: Nix templates and planner wiring (pyApp/pyLib)

#### Description

Add Python Nix templates and integrate planner dispatch so Python derivations can be instantiated from the exported graph.

#### Scope & Changes

- Add `tools/nix/templates/python.nix` exposing `pyApp` and `pyLib` using a shared `mkPy` with:
  - `patchesMap` from `patches/python/*.patch` filenames,
  - `devOverrides` from `NIX_PY_DEV_OVERRIDE_JSON` (warn locally, throw in CI),
  - uv backend dispatch (`python/backends/uv.nix`) for lockfile consumption.
- Extend `graph-generator.nix` dispatch to detect Python targets (by `rule_type` or `lang:python`) and emit derivations via `T.pyApp`/`T.pyLib`.

#### Acceptance Criteria

- A toy Python lib/bin builds via Nix locally when a `uv.lock` is present.
- Dev overrides print a local warning; CI evaluation fails if overrides are set.

#### Risks

Low. Pure addition; guarded by presence of `uv.lock`.

#### Consequence of Not Implementing

Planner cannot build Python targets; downstream PRs blocked.

#### Downsides for Implementing

Small increase in planner surface; kept minimal per design.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑3: Exporter adapter — importer‑scoped lockfile labels for Python

#### Description

Extend the exporter to attach `lockfile:<path>#<importer>` to Python targets and emit a warn‑only adapter validation when `.py` sources are missing `lang:python` (mirrors C++ warn policy).

#### Scope & Changes

- Update `tools/buck/export-graph.ts`:
  - Identify Python targets (rule_type or `lang:python`),
  - Locate nearest `uv.lock`, compute importer id, attach `lockfile:<path>#<importer>` label,
  - Warn (non‑CI) if `.py` sources lack `lang:python`.

#### Acceptance Criteria

- `tools/buck/graph.json` shows correct lockfile labels on Python targets.
- Severity obeys repo policy: local warn, CI error (global exporter setting).

#### Risks

Low. Labeling only; no build changes.

#### Consequence of Not Implementing

Auto‑map cannot wire providers; invalidation will be coarse or broken.

#### Downsides for Implementing

None.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑4: Provider sync for Python and orchestrator integration

#### Description

Generate deterministic importer‑scoped Python providers that are sensitive to `uv.lock` and only the patches relevant to that importer.

#### Scope & Changes

- Add `tools/buck/providers/python.ts` (canonical generator) and thin wrapper `tools/buck/sync-providers-python.ts` (optional).
- Teach `tools/buck/sync-providers.ts` to include Python when `--lang python` or default (all).
- Emit `third_party/providers/TARGETS.python.auto`:
  - Stable ordering, one target per importer,
  - `patch_paths` filtered to dist versions present in the importer’s lockfile,
  - Duplicate patch detection and flat‑dir validation.

#### Acceptance Criteria

- Running the sync with a sample `uv.lock` produces deterministic `TARGETS.python.auto`.
- Re‑running with no changes is a no‑op; duplicates and subdirectories raise clear errors/warnings per mode.

#### Risks

Low. Mirrors Node provider generator patterns.

#### Consequence of Not Implementing

Python patches won’t influence builds deterministically.

#### Downsides for Implementing

None beyond a small script.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑5: Auto‑map wiring confirmation (no/low‑code + tests)

#### Description

Confirm `gen-auto-map.ts` maps generic `lockfile:` labels for Python (same as Node). Add tests; avoid code changes unless gaps are found.

#### Scope & Changes

- Add zx tests to assert Python targets (with lockfile labels) receive the correct importer‑scoped provider entries in `MODULE_PROVIDERS`.
- If needed, minimally adjust `tools/lib/labels.ts` to ensure Python lockfile labels are already handled (expected: no change).

#### Acceptance Criteria

- Mapping present only for Python targets with lockfile labels; unrelated targets unmapped.

#### Risks

Very low. Test‑only unless a gap surfaces.

#### Consequence of Not Implementing

Unnoticed mapping gaps could break invalidation.

#### Downsides for Implementing

None.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑6: Python Buck macros using shared helpers

#### Description

Add `python/defs.bzl` macros that stamp standard labels, validate an importer‑scoped lockfile, optionally attach native nixpkgs deps, and wire providers from `auto_map.bzl`.

#### Scope & Changes

- `python/defs.bzl`:
  - Use `stamp_labels`, `ensure_single_lockfile_label`, `append_nixpkg_labels`, and `providers_for` from `lang/defs_common.bzl`,
  - Expose `nix_python_{library,binary,test}` with `lockfile_label` and `nix_native_deps` parameters,
  - Keep rule args aligned with upstream `python_*` rules.

#### Acceptance Criteria

- Example targets using macros compile identically to raw `python_*` when no providers are mapped.
- Labels `lang:python` and `kind:*` always present; exactly one `lockfile:` label required.

#### Risks

Low. Thin wrappers; no functional change without providers present.

#### Consequence of Not Implementing

Inconsistent labels and harder provider wiring for users.

#### Downsides for Implementing

None.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑7: Patch workflow — `patch-pkg python`

#### Description

Implement Python language handler for the unified patch workflow: start/reset/apply/session with dev overrides and canonical patch filenames.

#### Scope & Changes

- Add `tools/patch/patch-python.ts`:
  - `start`: resolve `name@version` from importer lockfile, copy sdist/wheel sources to temp (APFS CoW on macOS), set `NIX_PY_DEV_OVERRIDE_JSON`,
  - `apply`: produce `patches/python/<name>@<version>.patch`, run provider sync + auto‑map, clear override,
  - `reset`/`session`: match existing semantics (Ctrl‑D apply, Ctrl‑C reset),
  - Use shared `decodeNameVersionFromPatch` for canonical keying.

#### Acceptance Criteria

- Applying a change writes the canonical patch, updates providers/auto_map, and clears overrides.
- Re‑applying identical patches is a no‑op.

#### Risks

Moderate (user‑facing workflow), mitigated by reuse of existing Node/Go patterns.

#### Consequence of Not Implementing

Poor DX; patches require manual steps and are error‑prone.

#### Downsides for Implementing

Small script and tests.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑8: Dev shell/lock integration and guardrails

#### Description

Integrate uv lock refresh into existing install tooling; add override guardrails consistent with Go/C++.

#### Scope & Changes

- `tools/install-deps.ts`: when Python is enabled and `**/uv.lock` present, run pinned uv/uv2nix helper to refresh reproducible inputs; no‑op otherwise.
- `tools/dev/startup-check.ts`: add local warning for `NIX_PY_DEV_OVERRIDE_JSON`; CI behavior remains enforced in Nix templates.
- `tools/buck/prebuild-guard.ts`: consider Python providers present when `uv.lock` exists and require at least one `TARGETS.python.auto` (mirrors Node behavior).

#### Acceptance Criteria

- Local install steps refresh Python inputs deterministically when deps change.
- Guard warns locally about overrides; CI fails if overrides leak into evaluation.

#### Risks

Low. Mirrors existing patterns; guarded by presence.

#### Consequence of Not Implementing

Stale lock integrations and confusing override behavior.

#### Downsides for Implementing

Minor code paths in existing tools.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑9: Tests — exporter, providers, auto‑map, planner, patch workflow

#### Description

Add zx tests (one per file) covering Python integrations end‑to‑end, matching repo conventions.

#### Scope & Changes

- Add tests:
  - `exporter/python.labels-present.test.ts`
  - `providers/sync-providers-python.idempotent.test.ts`
  - `providers/auto-map.python-wiring.test.ts`
  - `providers/auto-map.python-multi-importers.test.ts`
  - `patch/patch-python.session.apply.test.ts`
  - `planner/python-dispatch.test.ts`
- Use external timeouts and shared fixtures/helpers; keep deterministic ordering and outputs.

#### Acceptance Criteria

- All tests pass locally and in CI; re‑runs are idempotent.

#### Risks

Low. Tests only.

#### Consequence of Not Implementing

Regression risk on label/provider wiring and patch flow.

#### Downsides for Implementing

Slight CI time increase; mitigated by single‑test‑per‑file parallelism.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑10: Docs and scaffolding

#### Description

Add scaffolding templates for Python and update docs for onboarding and operations.

#### Scope & Changes

- Add `tools/scaffolding/templates/python/` (lib/app):
  - `pyproject.toml`, `uv.lock` generation, `TARGETS` stubs using `nix_python_*` macros, README snippets.
- Update docs:
  - `docs/handbook/adding-language.md` — Python notes, path invariants, lockfile labels,
  - This design doc — finalize examples and references for newcomers.

#### Acceptance Criteria

- `scaf new python <lib|app>` works out of the box and matches repo conventions (one‑test‑per‑file).

#### Risks

Low. Docs/templates only.

#### Consequence of Not Implementing

Higher onboarding friction; inconsistent usage.

#### Downsides for Implementing

None.

#### Recommendation

Implement.

Re-evaluation: After landing this PR, re-evaluate the remaining PR list and adjust scope/ordering as needed.

### PR‑12: uv groups in templates and per‑importer flake outputs

#### Description

Expose uv “groups” toggles in the Python templates and surface convenient per‑importer flake outputs (base, dev, test) so variant environments can be realized deterministically and cached separately.

#### Scope & Changes

- `tools/nix/templates/python.nix`:
  - Add a `groups` parameter (default `[]`) that is forwarded to the backend.
  - Ensure `groups` participates in cache keys and is reflected in `BUILD-INFO.json`.
- `tools/nix/templates/python/backends/uv.nix`:
  - Honor a `groups` argument to materialize extras/variants deterministically (no network; leverage existing `NIX_PY_TEST_RESOLVE_JSON` in tests).
- `tools/nix/planner/python.nix` and flake manifest:
  - Add per‑importer exposed outputs `.#py-<importer>`, `.#py-<importer>-dev`, `.#py-<importer>-test` by passing `groups = ["dev"]` / `["test"]`.
- Tests:
  - Add zx tests proving base vs dev/test variants create distinct derivations and are idempotent.

#### Acceptance Criteria

- Building `.#py-<importer>` vs `.#py-<importer>-dev` yields distinct outputs with stable keys.
- Variant derivations work on darwin/linux; re‑builds are no‑ops when inputs unchanged.

#### Risks

Low—pure parameterization; guarded by presence of `uv.lock`. Ensure zero effect when groups are `[]`.

#### Consequence of Not Implementing

Inconsistent handling of dev/test extras; harder to cache and reason about environment variants.

#### Downsides for Implementing

Small increase in template surface area and tests.

#### Recommendation

Implement.

### PR‑13: Provider index coverage for Python importers

#### Description

Extend the provider index to include Python importer‑scoped providers, enabling uniform introspection across Node/CPP/Python.

#### Scope & Changes

- `tools/buck/gen-provider-index.ts`:
  - Read Python providers from `third_party/providers/TARGETS.python.auto` (or via `findUvLockfiles`) and emit entries with `kind: "python"` and key `lockfile:<path>#<importer>`.
- Tests:
  - Add zx tests validating Python entries appear, ordering is deterministic, and JSON/BZL outputs match.

#### Acceptance Criteria

- `third_party/providers/provider_index.bzl/json` contain Python entries with correct keys and stable ordering.

#### Risks

Very low—read‑only index generation.

#### Consequence of Not Implementing

Tooling that relies on the index cannot reason about Python providers uniformly.

#### Downsides for Implementing

Minor maintenance in the index generator.

#### Recommendation

Implement.

### PR‑14: Startup check for Python/uv presence

#### Description

Augment startup diagnostics to verify `python3` and `uv` availability, aligning with Python enablement assumptions.

#### Scope & Changes

- `tools/dev/startup-check.ts`:
  - Add checks for `python3` and `uv`; keep behavior: fail in CI when missing, friendly error locally.
- Docs:
  - Note Python/uv prerequisites in onboarding sections.

#### Acceptance Criteria

- Local runs show clear guidance when Python/uv are missing; CI fails fast with actionable messages.

#### Risks

Low; matches existing style for other tools.

#### Consequence of Not Implementing

Harder to diagnose missing toolchain issues for Python importers.

#### Downsides for Implementing

None beyond a few lines.

#### Recommendation

Implement.

### PR‑15: Scaffolding pyproject.toml for app/lib

#### Description

Complete Python scaffolding by generating `pyproject.toml` (hatchling) alongside `uv.lock` placeholders for both app and lib templates.

#### Scope & Changes

- Add `tools/scaffolding/templates/python/*/pyproject.toml.jinja` with minimal PEP 621 metadata and hatchling backend.
- Update READMEs to show `uv lock` flow and groups examples.
- Tests:
  - Ensure `scaf new python <lib|app>` creates `pyproject.toml` and `uv.lock` placeholder files.

#### Acceptance Criteria

- New scaffolds contain a valid `pyproject.toml`; developer can immediately run `uv lock` and build.

#### Risks

Low; templates only.

#### Consequence of Not Implementing

Incomplete scaffolds increase onboarding friction.

#### Downsides for Implementing

None.

#### Recommendation

Implement.

### PR‑16: Exporter classification warnings test coverage

#### Description

Add explicit tests that `.py` sources lacking `lang:python` (and no `python_*` rule type) trigger warn‑only locally and error in CI (via exporter global severity).

#### Scope & Changes

- Tests under `tools/tests/exporter/`:
  - Local mode: validate warning text.
  - Simulated CI: validate non‑zero exit on findings.

#### Acceptance Criteria

- Tests pass; behavior matches policy for Python classification warnings.

#### Risks

Low—tests only.

#### Consequence of Not Implementing

Potential regressions in adapter validation could slip by unnoticed.

#### Downsides for Implementing

Slight CI time increase; mitigated by single‑test‑per‑file parallelism.

#### Recommendation

Implement.

### PR‑17: Documentation alignment — uv‑only initial rollout

#### Description

Clarify that the initial Python rollout is uv‑only; adjust language in “Monorepo‑Friendly Patterns” to avoid implying Poetry/pip‑tools support now.

#### Scope & Changes

- Update this design’s wording to state: uv‑only for the initial phase; Poetry/pip‑tools are out of scope unless/until a future PR adds them.
- Add a short note in onboarding docs pointing to this decision.

#### Acceptance Criteria

- Docs no longer imply Poetry/pip‑tools support in the current phase; messaging is consistent across guides.

#### Risks

None (docs only).

#### Consequence of Not Implementing

Confusion about supported lockfile ecosystems.

#### Downsides for Implementing

None.

#### Recommendation

Implement.

---

### Rollout & Sequencing

1. PR‑1 (skeleton) — safe foundation, no behavior change.
2. PR‑2 (templates + planner) — enables derivations behind presence checks.
3. PR‑3 (exporter labels) — unlocks mapping; strictly additive.
4. PR‑4 (providers) — deterministic providers for importers with `uv.lock`.
5. PR‑5 (auto‑map confirmation) — tests prove mapping; minimal/no code.
6. PR‑6 (macros) — ergonomics; keep behavior identical without providers.
7. PR‑7 (patch workflow) — DX; integrates glue steps.
8. PR‑8 (install/guardrails) — stability; aligns with Go/C++.
9. PR‑9 (tests) — codifies guarantees end‑to‑end.
10. PR‑10 (docs/scaffolding) — onboarding and consistency.
11. PR‑11 (uv2nix backend + runtime e2e) — realize Python envs and verify patched behavior at runtime.
12. PR‑12 (uv groups + flake outputs) — parameterize groups; expose per‑importer base/dev/test variants.
13. PR‑13 (provider index coverage) — include Python providers in provider_index outputs.
14. PR‑14 (startup checks) — verify python3 and uv availability in startup diagnostics.
15. PR‑15 (scaffolding pyproject.toml) — generate pyproject for app/lib scaffolds.
16. PR‑16 (exporter warning tests) — ensure classification warnings covered and CI‑enforced.
17. PR‑17 (doc alignment) — clarify uv‑only scope; defer Poetry/pip‑tools.

All PRs are independently reversible.

### Verification & Backout Strategy

- Each PR ships with targeted zx tests; backout is a clean file‑level revert.
- For exporter/provider/auto‑map PRs, verify by regenerating glue and comparing diffs; expect deterministic/stable outputs for unchanged inputs.
- For patch workflow, smoke test: start → apply → build; verify provider wiring and no‑op on re‑apply.

### Summary of Expected Impact

- Python achieves parity with Go/Node/C++:
  - Importer‑scoped lockfile labels, deterministic provider sync, auto‑map integration,
  - Macros using shared helpers, native nixpkgs deps via `nixpkg:` labels,
  - Unified patch workflow and CI guardrails.
- Low risk, staged rollout; strong test coverage and easy backouts.

---

## Parity Checklist (with Go/Node/C++)

- Uses importer‑scoped lockfile labels mapped via `gen-auto-map.ts` (Node parity).
- Supports dev overrides with local warn/CI fail (`NIX_PY_DEV_OVERRIDE_JSON`) (Go/C++ parity).
- Provider sync generates deterministic `TARGETS.python.auto` and names via shared helpers (Node parity).
- Macros stamp `lang:`/`kind:` and wire providers from `auto_map.bzl` using `lang/defs_common.bzl` (Go/Node/C++ parity).
- Supports `nixpkg:` labels for native deps (Go/C++ parity).
- Scaffolding generates targets/macros/lockfile label, one‑test‑per‑file (repo conventions).
