### Build a new language in 60 minutes

This walkthrough shows how to add a new language using the lang‑kit template, ensuring partial‑clone grace, capability gating, and adherence to the planner/exporter/provider wiring.

Prereqs: enter the Nix dev shell and confirm PNPM, Node, Go, and the language toolchain resolve from
`/nix/store` (Nix may use `/nix/var/nix/profiles/default/bin/nix`). Buck2 must be Nix-store-backed;
the repo's `buck-out/zx_shims` launcher is valid when it delegates to that store binary. The zx
wrapper must be available.

Steps

- **Create a new language**
  - Run: `scaf new language kit rust --yes --display_name=Rust`
  - Generated files:
    - `build-tools/tools/nix/templates/rust.nix`
    - `build-tools/tools/nix/planner/rust.nix`
    - `build-tools/rust/defs.bzl`
    - `build-tools/tools/buck/providers/rust.ts`
    - `patches/rust/.gitkeep`

- **Planner integration**
  - Ensure `build-tools/tools/nix/planner/rust.nix` exports: `isTarget`, `kindOf`, `mkApp`, `mkLib`.
  - `graph-generator.nix` auto-imports `planner/<lang>.nix` when present.

- **Exporter adapter validation (new)**
  - Implement `validate(nodes)` on your language adapter; it runs during export.
  - Purpose: enforce language-specific invariants early with actionable errors.
  - Example policies:
    - Targets with language sources must carry a stamped `lang:<id>` label (or use your macros that add it automatically).
    - Custom rule aliases must map to your language template via `build-tools/tools/nix/mapping.nix`.
  - Keep the function small and deterministic; fail fast if invariants are violated.

- **Provider sync**
  - Implement `build-tools/tools/buck/providers/rust.ts` using the existing provider-sync helpers pattern. If no patches exist, generator writes a minimal `TARGETS.<lang>.auto` deterministically.
  - If your language is **importer-scoped** (lockfile ecosystems like Node/PNPM or Python/uv), reuse the shared lockfile and provider-index helpers:
    - `build-tools/tools/lib/importers.ts:findImporterLockfiles`, `computeImporterLabel`
    - `build-tools/tools/lib/provider-index.ts:readImporterProviderIndexEntriesForSingleImporterLockfileBasenames` (deterministic provider-index enumeration with supported-importer filtering and optional required-module gating)

- **Auto-map wiring**
  - If your exporter emits labels (e.g., `module:…`), `build-tools/tools/buck/gen-auto-map.ts` will map target → provider name; macros read providers from `MODULE_PROVIDERS` loaded via the workspace provider cell `@workspace_providers//:auto_map.bzl`.

- **Macros (Starlark wiring)**
  - Use `//build-tools/lang:defs_common.bzl:prepare_language_wiring(...)` as the default macro entrypoint (non-mutating).
  - For Nix-calling macros, select `wiring = "nix_calling_genrule"` or `wiring = "non_genrule_nix_calling"` so global Nix inputs are wired consistently; do not call `wire_global_nix_inputs(...)` at the call site when using these helpers.

- **Capability gating**
  - Add an entry to `build-tools/tools/nix/langs.json` with `requiredPaths`, `optionalPaths`, and `capabilities` for your language. Missing required paths in a sparse checkout disables the language; glue and scaf will still work for others.
  - Add the project surface to the canonical update/consistency language registry. Its read-only
    check must fail with `repair: run u`, and the same registry must define either a bounded upgrade
    policy or an explicit reconciliation-only policy for dependency authorities that cannot move.
  - Add an exhaustive typed update handler for conservative repair and upgrade. Route executable
    work through canonical Nix-store tool resolution and managed timeout/process-group shutdown;
    restore every tracked file the tool may create, remove, or rewrite if the operation fails.

- **Scaffolding templates**
  - Add a `build-tools/tools/scaffolding/templates/<lang>/` directory, with `meta.json` and `copier.yaml`. Keep variables minimal and defaults sensible. Use `scaf help new <lang> <template>` to preview variables.

- **Tests**
  - Copy the Go contract tests as a model and adjust for your language’s providers and labels. Keep tests one-per-file and wire via `TARGETS`.
  - Include a small test that proves your adapter's `validate(nodes)` rejects a misconfigured sample with a clear message.
  - Add command-boundary coverage: `u` repairs deterministic tracked metadata; `i` and post-clone
    detect drift without rewriting it.
  - Run the real `u` launcher in a bounded local/offline consumer and compare the viberoots gitlink,
    flake pins, and source-mode metadata byte-for-byte before and after. Cover both plain repair and
    the supported upgrade path, including exact upgrade argv and failure rollback, or the exact
    reconciliation-only `u --upgrade` result.
  - Add hostile-`PATH` coverage for startup/orchestration, a rooted Nix-store Buck toolchain check,
    and runnable-manifest execution or rejection tests where the language produces commands.
  - Exercise a minimal temp consumer so undeclared source-checkout dependencies fail visibly.

- **Repair and validate**
  - Run `u` to repair the language's lockfile/provider/glue metadata. Use the lower-level glue
    pipeline only for focused development of that pipeline.
  - Confirm `i` is clean and read-only, then run focused build and manifest tests before `b && v`.
  - Record focused elapsed time and named disk usage per
    `docs/handbook/getting-started-on-a-pr.md`; defer `ALL_TESTS=1 v` to the planned full checkpoint.

Tips

- Favor small functions with clear names; avoid deep nesting.
- Keep templates and plugins tiny; push logic into shared helpers.
- Partial‑clone friendly: use import-if-exists and file-presence gating.
