### Macro stamping cookbook

This cookbook is the short reference for macro authors. It documents the small set of shared helper surfaces that keep cross-language macro behavior consistent and testable.

Stamping ensures exporter preconditions via consistent labels applied in macros.

- **Helpers**: use `lang/defs_common.bzl: stamp_labels(kwargs, lang, kind)` to add `lang:<id>` and optional `kind:<bin|lib|test>`.
- **Importer-scoped ecosystems (Node, Python)**: avoid bespoke wiring. Use the shared helpers in `lang/importer_wiring.bzl` so lockfile enforcement, patch inputs, and provider edge realization stay drift-free.
  - For genrule-style wrappers: `prepare_importer_genrule_kwargs(...)`
  - For non-genrule wrappers: `prepare_importer_non_genrule_wiring(...)` (returns the derived importer string and the wired kwargs/deps)
  - Node macros that need the importer string for Nix attribute selection (for example `node_webapp`, bundled `nix_node_cli_bin`) should derive it via `prepare_importer_non_genrule_wiring(...)` rather than parsing labels directly.
- **Global Nix inputs (macros and rules that call Nix)**: treat `global_nix_inputs()` as real action inputs. Label stamping is retained for observability, but correctness must not depend on labels.
  - For **macros** that call Nix, use `//lang:defs_common.bzl:wire_global_nix_inputs(...)`. This keeps call sites consistent and keeps list-shaped and dict-shaped inputs correct.
  - For **macros that create genrules** that call Nix, use the shared helper `lang/defs_common.bzl: wire_global_nix_inputs(kwargs, into="srcs", stamp=True)` so call sites cannot forget either:
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
  - Use `nix_cmd_prefix(..., include_pnpm_store=True)` for Node macros that invoke Nix. It composes:
    - deterministic bootstrap (`WORKSPACE_ROOT`, `FLK_ROOT`)
    - Buck-safe command substitution escaping (`$(...)` → `$$(...)`)
    - timeout wrapper variable setup (portable `timeout`/`gtimeout`)
  - Use `nix_build_out_path_cmd(".#<attr>")` to resolve a flake attribute to `outPath` via `nix build --no-link --print-out-paths | tail -n1` (no `--out-link`).
- **Macros**: call `stamp_labels` early in macro expansion to keep labels on all rule variants.
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
