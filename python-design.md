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

- Patches live in `patches/python/` (flat directory, no subdirectories). Filenames: `<distribution-name>@<version>.patch` (case‑insensitive keys in logic).
- Python Nix templates live in `tools/nix/templates/python.nix`, imported by `tools/nix/lang-templates.nix`.
- Buck macros live under `python/defs.bzl` and use `//third_party/providers:auto_map.bzl`.
- Provider rules live under `//third_party/providers/**` and are generated, not hand‑edited.
- Dev overrides via `NIX_PY_DEV_OVERRIDE_JSON` (JSON: `{ "name@ver": "/abs/local/src" }`). CI forbids overrides.

---

## Labels and Invalidation Model

We adopt the importer‑scoped lockfile labeling model (like Node) to get precise invalidation while avoiding heavy Python resolver parsing in the exporter.

- Label format on Python targets: `lockfile:<relative/path/to/lockfile>#<importer>`
  - Repo standard (monorepo‑wide): Python projects use `uv` exclusively; the lockfile is `uv.lock` at the importer root.
  - `<importer>` is the project root directory (e.g., `apps/pytool`) to disambiguate multiple importers.
- `gen-auto-map.ts` already maps generic `lockfile:` labels to providers using `providerNameForImporter(path, importer)`; Python reuses this machinery.
- Optional per‑distribution labels (future): `pymodule:<dist>@<version>` can be emitted by a Python adapter if we later implement authoritative module discovery. Not required in Phase A.

---

## Nix Templates: tools/nix/templates/python.nix

Provide two functions mirroring Go’s `goApp`/`goLib` style: `pyApp` and `pyLib`. These are thin shims over the uv backend, with unified patch/override hooks.

Key responsibilities

- Accept `name`, `lockfile`, `subdir` (optional), `patchDir` (default `../../patches/python`), and `devOverrideEnv` (default `NIX_PY_DEV_OVERRIDE_JSON`).
- Build using uv only, with `uv.lock` as the single source of truth (prefer via a `uv2nix` adapter; otherwise a small repo helper to translate `uv.lock` into a reproducible inputs set).
- Apply patches by matching `name@version` keys from `patches/python/*.patch` to Python distributions during build.
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
- Includes only `patches/python/*.patch` whose `<dist>@<ver>` appears in that effective set.
- Writes `third_party/providers/TARGETS.python.auto` deterministically with entries:

```starlark
load("//third_party/providers:defs_python.bzl", "python_importer_deps")

python_importer_deps(
    name = "lf_<hash>_<suffix>",
    lockfile = "apps/pytool/uv.lock",
    importer = "apps/pytool",
    patch_paths = [
        "patches/python/requests@2.32.3.patch",
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

A minimal, content‑addressed stamp mirroring Node and Go providers:

```starlark
def python_importer_deps(name, lockfile, importer, patch_paths = []):
    genrule(
        name = name,
        srcs = [lockfile] + patch_paths,
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        visibility = ["//visibility:public"],
    )
```

This keeps provider cache keys sensitive to lockfile contents and any referenced patches.

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

---

## Patching Workflow: patch-pkg python

Add `tools/patch/patch-python.ts` implementing `LanguageHandler`:

- `start <dist>`
  - Resolve the distribution `name@version` currently locked for the target importer (using the selected lockfile). Locate its source (prefer sdist source; otherwise unpack wheel). Copy to temp dir (APFS CoW on macOS; `cp -a` elsewhere).
  - Update `NIX_PY_DEV_OVERRIDE_JSON` to point `name@version` → temp dir. Warn locally about overrides; CI forbids.
  - If `$PATCH_EDITOR` is set, launch it against the temp dir.

- `apply <dist>`
  - Produce unified diff: `diff -ruN "$src" "$tmp" > patches/python/<name>@<version>.patch`.
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

---

## Monorepo‑Friendly Patterns and Isolation

- Per‑importer lockfiles
  - Python projects live under `apps/*` and `libs/*`, each owning its lockfile (`uv.lock` preferred; `poetry.lock` or `requirements.lock` supported).
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
