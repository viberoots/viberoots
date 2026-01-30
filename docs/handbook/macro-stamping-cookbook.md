### Macro stamping cookbook

This cookbook is the short reference for macro authors. It documents the small set of shared helper surfaces that keep cross-language macro behavior consistent and testable.

Stamping ensures exporter preconditions via consistent labels applied in macros.

- **Helpers**: use `lang/defs_common.bzl: stamp_labels(kwargs, lang, kind)` to add `lang:<id>` and optional `kind:<k>`.
  - `kind:*` must be in the shared vocabulary:
    - Starlark: `lang/defs_common.bzl: allowed_kind_values` / `is_allowed_kind_value`
    - TypeScript: `tools/lib/kind-vocabulary.ts`
  - Examples used in this repo include: `kind:bin`, `kind:lib`, `kind:test`, `kind:bundle`, `kind:app`, `kind:packaging`, `kind:addon`, `kind:carchive`, `kind:gen`, and `kind:wasm`.
- **Importer-scoped ecosystems (Node, Python)**: avoid bespoke wiring. Use the unified helper (re-exported from `lang/defs_common.bzl`) so lockfile enforcement, patch inputs, and provider edge realization stay drift-free.
  - Use `prepare_language_wiring(...)` with `wiring = "genrule"` for genrule-style wrappers.
  - Use `prepare_language_wiring(...)` with `wiring = "non_genrule"` for non-genrule wrappers.
  - For importer-scoped, **Nix-calling** macros (for example `node_webapp`, bundled `nix_node_cli_bin`), use `prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"` or `wiring = "non_genrule_nix_calling"` so lockfile enforcement, importer derivation, patch inputs, provider edges, optional `workspace-root.env` injection, and global Nix input wiring are composed in one place.
- **Global Nix inputs (macros and rules that call Nix)**: treat `global_nix_inputs()` as real action inputs. Label stamping is retained for observability, but correctness must not depend on labels.
  - For **macros that already route through** `prepare_language_wiring(...)` with `wiring = "nix_calling_genrule"` or `wiring = "non_genrule_nix_calling"`, **do not** call `wire_global_nix_inputs(...)` at the call site; the shared wiring composes it for you.
  - For **macros that call Nix without** `prepare_language_wiring(...)`, use `//lang:defs_common.bzl:wire_global_nix_inputs(...)`. This keeps call sites consistent and keeps list-shaped and dict-shaped inputs correct.
  - For **macros that create genrules** that call Nix (and do not go through `prepare_language_wiring(...)`), use the shared helper `lang/defs_common.bzl: wire_global_nix_inputs(kwargs, into="srcs", stamp=True)` so call sites cannot forget either:
    - attaching global inputs as real action inputs (list and dict shapes)
    - stamping labels for observability (without hardcoding `//:flake.lock`)
  - Example (list-shaped `srcs`):

```starlark
load("//lang:defs_common.bzl", "wire_global_nix_inputs")

kw = dict(kwargs) if kwargs != None else {}
kw["srcs"] = list(kw.get("srcs", []) or [])
wire_global_nix_inputs(kw, into = "srcs", stamp = True)
```

- Example (dict-shaped `srcs`, for stable paths inside the action):

```starlark
load("//lang:defs_common.bzl", "wire_global_nix_inputs")

kw = dict(kwargs) if kwargs != None else {}
kw["srcs"] = {
    "src/index.ts": "src/index.ts",
}
wire_global_nix_inputs(kw, into = "srcs", stamp = True)
```

- Example (attach without stamping, when the macro contract intentionally avoids exporter noise):

```starlark
load("//lang:defs_common.bzl", "wire_global_nix_inputs")

wire_global_nix_inputs(kw, into = "srcs", stamp = False)
```

- For **rules** that shell out to Nix, accept `nix_inputs` and thread `global_nix_inputs()` into the action `hidden` inputs.
- **Nix command strings (macros that call Nix)**: assemble command strings via the canonical helper surface in `lang/nix_shell.bzl` so call sites do not partially apply the policy.
  - Prefer the genrule-focused helpers for genrule-style macros:
    - `nix_calling_genrule_bootstrap(...)` for standardized `WORKSPACE_ROOT`/`FLK_ROOT` derivation, optional `workspace-root.env` sourcing, timeout wrapper setup, and optional PNPM store bootstrapping.
    - `nix_calling_genrule_nix_build_out_path_prefix(...)` for `nix build --no-link --print-out-paths | tail -n1` outPath capture (no `--out-link`).
  - If using lower-level helpers, keep policy identical and centralized:
    - Use `nix_cmd_prefix(..., include_pnpm_store=True)` for Node macros that invoke Nix. It composes:
    - deterministic bootstrap (`WORKSPACE_ROOT`, `FLK_ROOT`)
    - Buck-safe command substitution escaping (`$(...)` → `$$(...)`)
    - timeout wrapper variable setup (`timeout`)
  - Use `nix_build_out_path_cmd(".#<attr>")` to resolve a flake attribute to `outPath` via `nix build --no-link --print-out-paths | tail -n1` (no `--out-link`).
- **Macros**: call `stamp_labels` early in macro expansion to keep labels on all rule variants.
- **Patch scope**: all Go/C++/Node/Python targets must carry exactly one `patch_scope:*` label derived from the language contract.
  - Macro implementations must **not** stamp `patch_scope:*` directly; delegate to shared wiring helpers:
    - Canonical entrypoint: `lang/defs_common.bzl:prepare_language_wiring`
    - Planner-visible stubs remain package-local: `lang/planner_visible_wiring.bzl:wire_package_local_planner_visible_stub`
    - Per-model helpers in `lang/package_local_wiring.bzl` and `lang/importer_wiring*.bzl` are internal implementation details.
- **Package-local WASM macros (Go, C++)**: do not hand-roll ordering-sensitive wiring.
  - Use `lang/defs_common.bzl:prepare_language_wiring(...)` with `wasm_variant = "<variant>"` to compose WASM stamping, patch inputs, and provider edges.
  - For planner-visible package-local WASM stubs, use `lang/defs_common.bzl:wire_package_local_wasm_planner_visible_stub(...)`.
- **Lint**: run `node tools/dev/stamping-lint.ts` to detect missing or invalid labels.
- **Tests**: negative test should demonstrate a missing label is flagged with a clear message.

#### C++ macro core

For C++ macros that build via Nix (`nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_node_addon`), the shared stamping and input wiring lives in a single helper (`_cpp_common`) in `cpp/defs.bzl`. Public macro signatures stay stable; this is a consolidation to reduce drift.

#### Sanitization policy parity (Nix ↔ Starlark)

Ensure artifact/name sanitization in Starlark matches the canonical implementation used by Nix planners.

- Canonical helper: `tools/nix/lib/lang-helpers.nix: sanitizeName`.
- Macro parity: keep the macro-side helper (e.g., `_sanitize_to_bin_name` via `cpp/private/sanitize.bzl`) in strict parity with the Nix helper for `//`, `:`, `/`, spaces, case, and non‑alnum characters.
- TypeScript policy: tooling scripts must not hand-roll this sanitizer. Use `tools/lib/sanitize.ts:sanitizeName` to keep TS ↔ Nix ↔ Starlark parity stable.
- Tests: `tools/tests/cpp/sanitize-name.parity.test.ts` runs a parity matrix through the `cpp_sanitize_probe` rule and compares to the Nix helper. Update either side if parity breaks.

Importer string shaping (Node Nix-calling macros):

When a macro needs to derive a Nix attribute suffix or a display name from an importer string, I route it through the shared helper module `lang/importer_strings.bzl`:

- `sanitize_importer_for_nix_attr(importer)` for `.#<attr>.<importer>` segments
- `importer_display_name(importer)` for basename-like naming (for example bundling output names)

Do not implement importer sanitization or basename logic as local helpers in macro files. Tests enforce this boundary.
