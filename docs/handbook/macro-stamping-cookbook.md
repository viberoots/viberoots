### Macro stamping cookbook

Stamping ensures exporter preconditions via consistent labels applied in macros.

- **Helpers**: use `lang/defs_common.bzl: stamp_labels(kwargs, lang, kind)` to add `lang:<id>` and optional `kind:<bin|lib|test>`.
- **Global Nix inputs (macros that call Nix)**: use `lang/defs_common.bzl: stamp_global_nix_inputs(kwargs)` to stamp the centralized `global_nix_inputs()` set (e.g., `//:flake.lock`) into `labels`. Do not hardcode global inputs in individual macros.
- **Macros**: call `stamp_labels` early in macro expansion to keep labels on all rule variants.
- **Lint**: run `node tools/dev/stamping-lint.ts` to detect missing or invalid labels.
- **Tests**: negative test should demonstrate a missing label is flagged with a clear message.

#### C++ macro core

For C++ macros that build via Nix (`nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_node_addon`), the shared stamping and input wiring lives in a single helper (`_cpp_common`) in `cpp/defs.bzl`. Public macro signatures stay stable; this is a consolidation to reduce drift.

#### Sanitization policy parity (Nix ↔ Starlark)

Ensure artifact/name sanitization in Starlark matches the canonical implementation used by Nix planners.

- Canonical helper: `tools/nix/lib/lang-helpers.nix: sanitizeName`.
- Macro parity: keep the macro-side helper (e.g., `_sanitize_to_bin_name` via `cpp/private/sanitize.bzl`) in strict parity with the Nix helper for `//`, `:`, `/`, spaces, case, and non‑alnum characters.
- Tests: `tools/tests/cpp/sanitize-name.parity.test.ts` runs a parity matrix through the `cpp_sanitize_probe` rule and compares to the Nix helper. Update either side if parity breaks.
