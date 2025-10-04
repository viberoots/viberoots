### Build a new language in 60 minutes

This walkthrough shows how to add a new language using the lang‑kit template, ensuring partial‑clone grace, capability gating, and adherence to the planner/exporter/provider wiring.

Prereqs: Buck2, Nix, PNPM, Node, Go (per build-system-design), zx wrapper available.

Steps

- **Create a new language**
  - Run: `scaf new language kit rust --yes --display_name=Rust`
  - Generated files:
    - `tools/nix/templates/rust.nix`
    - `tools/nix/planner/rust.nix`
    - `rust/defs.bzl`
    - `tools/buck/providers/rust.ts`
    - `patches/rust/.gitkeep`

- **Planner integration**
  - Ensure `tools/nix/planner/rust.nix` exports: `isTarget`, `kindOf`, `mkApp`, `mkLib`.
  - `graph-generator.nix` auto-imports `planner/<lang>.nix` when present.

- **Provider sync**
  - Implement `tools/buck/providers/rust.ts` using the existing provider-sync helpers pattern. If no patches exist, generator writes a minimal `TARGETS.<lang>.auto` deterministically.

- **Auto-map wiring**
  - If your exporter emits labels (e.g., `module:…`), `tools/buck/gen-auto-map.ts` will map target → provider name; macros read providers from `third_party/providers/auto_map.bzl`.

- **Capability gating**
  - Add an entry to `tools/nix/langs.json` with `requiredPaths`, `optionalPaths`, and `capabilities` for your language. Missing required paths in a sparse checkout disables the language; glue and scaf will still work for others.

- **Scaffolding templates**
  - Add a `tools/scaffolding/templates/<lang>/` directory, with `meta.json` and `copier.yaml`. Keep variables minimal and defaults sensible. Use `scaf help new <lang> <template>` to preview variables.

- **Tests**
  - Copy the Go contract tests as a model and adjust for your language’s providers and labels. Keep tests one-per-file and wire via `TARGETS`.

- **Run glue**
  - Local: `node tools/buck/export-graph.ts`, `node tools/buck/sync-providers.ts`, `node tools/buck/gen-auto-map.ts` or simply `node tools/buck/prebuild-guard.ts` (auto-fix in local mode).
  - CI: stages run these in order; Node sync runs only if `pnpm-lock.yaml` is present.

Tips

- Favor small functions with clear names; avoid deep nesting.
- Keep templates and plugins tiny; push logic into shared helpers.
- Partial‑clone friendly: use import-if-exists and file-presence gating.
