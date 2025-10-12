### Macro stamping cookbook

Stamping ensures exporter preconditions via consistent labels applied in macros.

- **Helpers**: use `lang/defs_common.bzl: stamp_labels(kwargs, lang, kind)` to add `lang:<id>` and optional `kind:<bin|lib|test>`.
- **Macros**: call `stamp_labels` early in macro expansion to keep labels on all rule variants.
- **Lint**: run `node tools/dev/stamping-lint.ts` to detect missing or invalid labels.
- **Tests**: negative test should demonstrate a missing label is flagged with a clear message.

#### Sanitization policy parity (Nix ↔ Starlark)

Ensure artifact/name sanitization in Starlark matches the canonical implementation used by Nix planners.

- Canonical helper: `tools/nix/lib/lang-helpers.nix: sanitizeName`.
- Macro parity: update any macro-side helper (e.g., `_sanitize_to_bin_name` in `cpp/defs.bzl`) to mirror the same rules for `//`, `:`, `/`, spaces, case, and non‑alnum characters.
- Add a table‑driven test that exercises representative labels and asserts equality across both implementations.
