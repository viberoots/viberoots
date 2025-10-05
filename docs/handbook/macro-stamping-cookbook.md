### Macro stamping cookbook

Stamping ensures exporter preconditions via consistent labels applied in macros.

- **Helpers**: use `lang/defs_common.bzl: stamp_labels(kwargs, lang, kind)` to add `lang:<id>` and optional `kind:<bin|lib|test>`.
- **Macros**: call `stamp_labels` early in macro expansion to keep labels on all rule variants.
- **Lint**: run `node tools/dev/stamping-lint.ts` to detect missing or invalid labels.
- **Tests**: negative test should demonstrate a missing label is flagged with a clear message.
