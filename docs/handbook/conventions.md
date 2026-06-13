# Conventions

This handbook summarizes project-wide conventions that keep behavior deterministic and the codebase approachable. When in doubt, prefer clarity and stability over cleverness.

In this repo, I treat Starlark macros as part of the long-lived public surface area. The goal is not only correctness, but predictability in review. When macro code has one obvious place where labels and deps are assembled, it is harder to introduce policy drift by accident.

## Top-level layout anchors

These anchors describe the stable, final layout:

- `build-tools/` — build system and tooling root
- `build-tools/lang/` — shared Starlark helpers
- `build-tools/tools/` — zx/Node tooling
- `build-tools/docs/` — build-system docs
- `build-tools/docs/lang/` — language design docs
- `projects/apps/` — application roots
- `projects/libs/` — library roots
- `docs/history/build-system/logs/` — historical build notes
- `patches/` — repo-level patch overlays
- `third_party/` — external provider and vendored metadata
- `toolchains/` — Buck toolchain wiring
- `target_platforms/` — platform definitions

- Scripts
  - Use zx TypeScript with the hashbang `#!/usr/bin/env zx-wrapper`.
  - Glue scripts run outside Nix; do not wrap them in `nix run`.
  - Tooling scripts must parse flags via `build-tools/tools/lib/cli.ts` (`getFlagStr`, `getFlagBool`, `getFlagList`, `hasFlag`) rather than hand-rolling `process.argv` parsing or reading `(globalThis as any).argv` directly.

- TARGETS over BUCK
  - Use `TARGETS` files rather than `BUCK` for new rules and wiring.
  - Keep macros small and readable; rely on generators for data-heavy glue.

- Macro authoring conventions
  - Keep a **single labels merge point** per macro:
    - Start with caller-provided `labels` (and any `kwargs["labels"]` when a macro accepts it).
    - Then delegate stamping/patch/provider/global-input wiring to shared helpers.
    - Avoid merging labels in multiple places (it makes diffs noisy and hides accidental policy drift).
  - Keep a **single deps merge point** per macro:
    - Assemble one `base_deps` list (explicit deps + repo-local extras), then pass it once into the shared wiring helper.
    - After wiring, pass `deps = wiring.deps` exactly once into the underlying rule.
  - Prefer the shared wiring helpers in `//build-tools/lang:defs_common.bzl` so patch inputs, provider edges, and global inputs stay consistent across languages.

Here is the intended “shape” for a typical package-local macro. The details are language-specific, but the merge points are stable.

Before (harder to review because the merge points are spread out, and it is easy to accidentally rely on mutating behavior):

```starlark
def nix_cpp_wasm_emscripten_lib(name, **kwargs):
    deps = kwargs.get("deps", []) or []
    wire_package_local_wasm_planner_visible_stub(
        name = name,
        out = name + ".stamp",
        kwargs = kwargs,
        lang = "cpp",
        variant = "emscripten",
        deps = deps,
        srcs = kwargs.get("srcs", []) or [],
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
```

After (single deps merge point + single kwargs merge point, then delegate to shared wiring):

```starlark
def nix_cpp_wasm_emscripten_lib(name, **kwargs):
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    srcs = kw.get("srcs", []) or []
    wire_package_local_wasm_planner_visible_stub(
        name = name,
        out = name + ".stamp",
        kwargs = kw,
        lang = "cpp",
        variant = "emscripten",
        deps = deps,
        srcs = srcs,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
```

- Path invariants
  - `patches/<lang>/` is flat; for Go: `<encodedImport>@<version>.patch` with `/` → `__`.
  - For Node/PNPM: importer‑local patches live under `<importer>/patches/node/*.patch`; labels use `lockfile:<relative/path/to/pnpm-lock.yaml>#<importer>`.
    - `#.` is allowed only for repo-root lockfiles (example: `lockfile:pnpm-lock.yaml#.`).
    - For non-root lockfiles, `<importer>` must equal `dirname(<path>)` (example: `lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web`).
    - Supported importer labels: defined by `build-tools/tools/lib/importer-roots.json` (rendered to Starlark as `build-tools/lang/importer_roots.bzl`). Any other importer label is unsupported.
  - For C++: canonical flow is per‑target local patches under `<pkg>/patches/cpp/*.patch` (included in target `srcs`). Optional: a repo‑level overlay at `patches/cpp/*.patch` via `build-tools/tools/nix/overlays/cpp-patches.nix`.
  - Buck exporter and generators live under `build-tools/tools/buck/`.
  - Language planner templates live under `build-tools/tools/nix/` (see `lang-templates.nix`).
  - No vendoring: do not place `.go` sources under `third_party/go/**`.

- Patching
  - Exactly one patch per `module@version` (case-insensitive) in `patches/<lang>/`.
  - Use `patch-pkg start|apply|reset|session` as the only entrypoint for patching.

- Cells / Prelude
  - Go macros expect a `@prelude` cell alias. When unavailable, run inside the dev shell or provide a repo-local forwarder.

- Code style and size
  - Minimal, deterministic code; aim for files ≤ 250 LOC where practical.
  - Prefer self-documenting names over comments; split modules for readability.

- Cross‑platform
  - Support aarch64-darwin, aarch64-linux, and x86_64-linux.
  - macOS patch workspaces use APFS CoW (`cp -cR`) when available; fallback to `cp -a`.

- Commits & tests
  - Use Conventional Commits.
  - One test per file; Buck controls parallelism. Use external timeouts and coverage (see Testing handbook).

- Generated glue (not committed)
  - `build-tools/tools/buck/graph.json`, `third_party/providers/TARGETS*.auto`, `.viberoots/workspace/providers/auto_map.bzl` are generated by Node scripts and not committed.
  - Strict flow: the planner has no discovery fallback. Always regenerate glue before Nix builds.
  - Local regeneration order: export-graph → sync-providers → gen-auto-map (see Troubleshooting and README).
  - For Go, third‑party deps are resolved by Nix + gomod2nix; no synthetic Buck targets are created for external modules.

- Graph consumption (Composite Graph API)
  - Tools must consume the Composite Graph API, not `graph.json` directly.
  - Library: `build-tools/tools/lib/graph-view.ts`; CLI: `node build-tools/tools/buck/graph-view.ts`.
  - Sidecars: `third_party/providers/provider_index.json` and `build-tools/tools/buck/node-lock-index.json`.
  - Schema/version: both `build-tools/tools/buck/graph.json` and `build-tools/tools/buck/node-lock-index.json` include `$schema` and `version`; the exporter prints a banner pointing to the Composite Graph API on success.
