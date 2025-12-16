> Note: As of PR 2 in `drop-cpp-provider.md`, C++ provider sync is a no‑op. This document is retained for historical context only. The generator described below is not used by current builds; new work should rely on `nixpkg:` labels and the planner. See `docs/handbook/cpp-pr2-migration.md` and `tools/buck/inspect-cpp-attrs.ts`.

## C++ nixpkgs Providers — Auto-Generated Stamp Rules

Audience: Engineers and LLM agents implementing/maintaining C++ build plumbing

Goals

- Replace ad-hoc/manual C++ provider handling with a deterministic, auto-generated provider file.
- Emit one nixpkgs-backed provider per attribute used by C++ targets (e.g., `pkgs.zlib`).
- Make Buck invalidation exact for C++ when overlay files, patch files, or the flake pin change.
- Keep the design generic so other languages that consume nixpkgs directly can add similar generators without redesign.
- No backwards compatibility requirement: remove unused/shim code; prefer a single canonical path.

Scope

- Languages: initial implementation targets C++; the structure supports future languages that source dependencies from nixpkgs (e.g., Rust, Zig).
- Inputs to rebuild/invalidate: `tools/buck/graph.json`, `patches/cpp/*.patch`, `tools/nix/overlays/cpp-patches.nix`, `flake.lock`.
- Outputs: `third_party/providers/TARGETS.cpp.auto` (GENERATED), consumed via auto-map to attach providers to targets.

High-Level Architecture

- Exporter (`tools/buck/exporter/main.ts` + `lang/cpp.ts`) attaches `nixpkg:<attr>` labels to C++ nodes via macros and rule_type.
- Generator (`tools/buck/providers/cpp.ts`, invoked via `tools/buck/sync-providers.ts --lang=cpp`) scans the exported graph, collects all `nixpkg:<attr>` labels, discovers related overlay/patch/lockfile inputs, and emits one stamped provider per attr.
- Auto-map (`tools/buck/gen-auto-map.ts`) translates `nixpkg:<attr>` labels to concrete provider labels `//third_party/providers:nix_pkgs_<attr_underscored>`.
- Macros (`cpp/defs.bzl`) append providers from `MODULE_PROVIDERS` to all `nix_cpp_*` targets, so per-attr changes invalidate only affected targets.

Provider Rule Definition (Stamp-Only)

- New canonical provider macro, replacing old shims:

```starlark
# //third_party/providers/defs_cpp.bzl
def nix_cxx_provider(name, attr):
    """
    Content-addressed stamp for nixpkgs attribute providers.
    The actual stamp file is generated under third_party/providers/stamps/<name>.stamp
    by the TypeScript glue and surfaced via a filegroup.
    """
    filegroup(
        name = name,
        srcs = glob(["stamps/%s.stamp" % name]),
        labels = ["lang:cpp", "nixpkg:%s" % attr],
        visibility = ["//visibility:public"],
    )
```

- Naming: `name = "nix_pkgs_<attr_underscored>"` where `<attr_underscored>` is `pkgs.openssl` → `pkgs_openssl`, `pkgs.gnome.glib` → `pkgs_gnome_glib`.
- Labels: include `nixpkg:<attr>` for auto-map; include `lang:cpp` for diagnostics.

Generator: tools/buck/providers/cpp.ts (invoked by sync CLI)

- Inputs
  - Graph: `tools/buck/graph.json` (must exist).
  - Patches dir: `patches/cpp` (flat, optional).
  - Overlay file: `tools/nix/overlays/cpp-patches.nix` (optional).
  - Lockfile: `flake.lock` (optional).

- Steps
  1. Parse `graph.json` and collect every `nixpkg:<attr>` label on any node.
  2. Normalize attr:
     - Lowercase key, keep `pkgs.` prefix.
     - Map `pkgs.gtest` → `pkgs.googletest` for consistency with templates/auto-map.
  3. For each attr:
     - Resolve encoded patch filename prefix: `attr.replace('.', '/')` then `/` → `__` (e.g., `pkgs.openssl` → `pkgs__openssl`).
     - Gather all `patches/cpp/<enc>@<ver>.patch` matching the attr; sort deterministically.
     - Write a content-addressed stamp file to `third_party/providers/stamps/<providerName>.stamp` that records overlay/patch/lockfile inputs.
     - Emit a minimal `nix_cxx_provider(name = <providerName>, attr = <attr>)` entry into `third_party/providers/TARGETS.cpp.auto`.
  4. Idempotent writes (skip if unchanged).

- Output example

```python
# GENERATED FILE — DO NOT EDIT.
load("//third_party/providers:defs_cpp.bzl", "nix_cxx_provider")

nix_cxx_provider(
    name = "nix_pkgs_openssl",
    attr = "pkgs.openssl",
)
```

Auto-map and Macros

- `tools/buck/gen-auto-map.ts` already maps `nixpkg:<attr>` → `//third_party/providers:nix_pkgs_<attr_underscored>`; no changes needed.
- `cpp/defs.bzl` macros keep loading `MODULE_PROVIDERS` from `auto_map.bzl` and append providers automatically.

Removal of Unused Paths (no backwards compatibility)

- Replace curated/manual C++ provider entries with the new auto-generated file:
  - Providers are emitted to `third_party/providers/TARGETS.cpp.auto` and backed by on-disk stamps in `third_party/providers/stamps/`.
  - Curated entries in `third_party/providers/TARGETS` for covered attrs should be removed.

CI and Local Workflow

- Local (developer):
  - `patch-pkg apply cpp pkgs.<attr>` → writes patch file → `node tools/buck/sync-providers.ts --lang=cpp` → `node tools/buck/gen-auto-map.ts` → build
- CI stages (ordered):
  1. Export Graph → `tools/buck/graph.json`
  2. Sync C++ Providers → `node tools/buck/sync-providers.ts --lang=cpp`
  3. Generate auto_map → `node tools/buck/gen-auto-map.ts`
  4. Prebuild guard → verify files exist
  5. Build & Test

Determinism & Idempotency

- Provider emission is fully sorted; attr keys and file lists are normalized.
- Re-running the generator without input changes is a no-op.

Tests

- Unit
  - No labels → header-only file.
  - Labels for `pkgs.zlib`, `pkgs.openssl` → two providers, sorted.
  - Patch present for zlib → provider includes it.
  - Missing overlay/lockfile → omitted gracefully.
  - Normalization: `pkgs.gtest` maps to `pkgs.googletest`.
- E2E
  - Add `pkgs.zlib` dep to a C++ test; run sync + auto_map; `deps()` of that target includes the generated provider.
  - Modify zlib patch → only dependents of `zlib` provider invalidate.
  - Change overlay or `flake.lock` → `zlib` provider invalidates.

Future-Proofing for Other nixpkgs-Consuming Languages

- Keep the generator language-agnostic by extracting a minimal core in `tools/buck/providers/index.ts`:
  - Shared helpers: attr normalization, filename encoding, stable writer.
  - Per-language adapters: map graph labels → attr set (e.g., `nixpkg:*` for C++, `nixpkg:*` for Rust later).
  - Emit to language-specific files: `TARGETS.cpp.auto`, `TARGETS.rust.auto`, etc., but reuse a single provider macro pattern (`*_provider`) per language.

What We Lose If We Do Not Implement

- Weaker invalidation fidelity (Buck unaware of overlay/patch/lockfile deltas per attr); broader/noisier retests or missed impacted tests.
- Manual or curated provider upkeep (error-prone, drifts over time).
- Inconsistent UX vs Go (which is fully automated) and a higher cognitive load for developers.

Implementation Checklist

1. Add `nix_cxx_provider` to `third_party/providers/defs_cpp.bzl` and remove unused/old C++ provider shims.
2. Create `tools/buck/providers/cpp.ts` implementing the steps above.
3. Update `tools/buck/providers/index.ts` to call the new C++ sync.
4. Wire into `patch-pkg apply cpp` and CI stages.
5. Add unit + e2e tests under `tools/tests/cpp/` and `tools/tests/dev/`.
6. Update docs: reference `cpp-provider.md`, note replacement of curated entries by auto-generated providers.

Self‑Review

- No backwards-compat detours retained; old stub generation is replaced by the new generator.
- Exact invalidation: providers stamp overlay, patches, and lockfile per attr.
- Reuses existing auto-map (no changes) and macro plumbing; minimal surface change.
- Language-agnostic structure documented for future nixpkgs-consuming languages.
- Idempotent, deterministic writing policy; CI/local integration defined.
