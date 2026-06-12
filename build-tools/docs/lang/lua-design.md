## Lua as a First-class Language — Design

> Audience: Engineers and LLM agents implementing Lua support. The design aligns with our methodology and reuses established patterns from Go and Node. It is path- and tooling-consistent with existing systems (Buck2, Nix, zx, providers, auto-map, patch-pkg).

### Goals

- Add Lua as a first-class language with minimal, deterministic, and testable components.
- Reuse existing glue patterns: exporter labels → provider sync → auto-map → macros → planner templates.
- Support reproducible dependency resolution and patching via LuaRocks (preferred) and Nix overlays.
- Ensure precise invalidation: targets depend only on providers relevant to their lockfile/importer (Phase A) and optionally per-module (Phase B).

### Non-goals

- A bespoke build system for Lua; we rely on Buck2 + Nix + zx (as with other languages).
- Editing or vendoring third-party sources in-repo; use patches and dev overrides.

### Linking expectations

I follow the repo-wide linking model described in `build-tools/docs/cpp-linking.md`, `build-tools/docs/wasm-linking.md`, and `docs/history/build-system/linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `build-tools/tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

### Shared wiring and contracts (current repo)

Use the canonical helper surface from `//build-tools/lang:defs_common.bzl` and `//build-tools/lang:language_wiring.bzl`. Macro call sites should not re‑implement wiring or load provider maps directly.

- Preferred macro entrypoint: `prepare_language_wiring(...)` (non‑mutating), with `wiring=` for `genrule`, `nix_calling_genrule`, `non_genrule`, or `srcsless_rule`.
- Provider wiring: load `MODULE_PROVIDERS` from `//build-tools/lang:auto_map.bzl` and use `providers_for`/`realize_provider_edges` for deterministic provider edges.
- Lockfile labels (importer‑scoped languages): `lockfile:<path>#<importer>` with supported importer roots `.` and `projects/apps/*`/`projects/libs/*`; importer‑scoped macros must live in the importer package so importer‑local patch globs are valid action inputs.
- Patch model contract: `build-tools/lang/lang_contracts.bzl` and `build-tools/tools/lib/lang-contracts.ts` define `patch_scope:*` stamping and whether glue runs on patch apply/remove.
- Global Nix inputs: for Nix‑calling macros, use `wire_global_nix_inputs(...)` so `global_nix_inputs()` are real action inputs; labels are observability only.

### Build route policy

Policy for this language:

- Implement artifact-producing macros as Nix-backed builds.
- Keep Buck as graph and test-impact orchestrator, not the producer of production artifacts.
- Allow orchestration wrappers that call `nix build` when inputs remain hermetic and deterministic.
- Allow probe-only non-build macros only when explicitly documented as non-artifact paths.
- Do not introduce fallback Buck artifact build paths for convenience.

### Enforcement integration requirement

Language rollout is not complete if it only adds build plumbing. I also need to keep migration
policy enforcement current:

- Add and maintain public macro rows in `docs/handbook/nix-gaps.md`.
- Keep intentional non-build macros in `docs/handbook/nix-gaps-exceptions.json` with
  `kind = "probe-only"` and non-empty justification.
- Extend `build-tools/tools/dev/nix-gaps-inventory-check.ts` and related tests under
  `build-tools/tools/tests/dev/` when route contracts change.
- Ensure required repo validation runs this checker so doc/policy drift fails before merge.

---

## Alignment with Methodology

- Architectural minimalism, deterministic reliability: small adapters; keep logic in shared helpers; reproducible Nix builds.
- Separation of concerns: planner templates for Nix; zx generators for glue; Buck macros for wiring; exporter adapter for labels; provider sync for mapping patches/lockfiles.
- Deterministic operations: evaluation-time scan of `patches/lua/*.patch`; CI forbids dev overrides; generated glue is deterministic and not committed.
- File-size discipline: templates/generators remain small, pushing shared code to existing helpers where possible.

---

## Path Invariants (Lua)

- Patches live under `patches/lua/` (flat; no subdirectories). Naming: `<rockName>@<version>.patch`.
- Nix language templates: `build-tools/tools/nix/templates/lua.nix` (consumed by `build-tools/tools/nix/lang-templates.nix`).
- Planner registry: Lua plugged into the planner via a small registry entry (see Planner Integration).
- Buck macros: `lua/defs.bzl`, using `build-tools/lang/defs_common.bzl` for stamping and `//build-tools/lang:auto_map.bzl` for providers.
- Provider sync: `third_party/providers/TARGETS.lua.auto` is generated, never hand-edited.

---

## Labels and Providers

We follow the Node importer-scoped pattern for Phase A to ensure precise invalidation per project, then extend to per-module in Phase B if needed.

- Phase A (Importer-scoped): Each Lua target carries a label `lockfile:<relative/path/to/luarocks.lock>#<importer>`.
  - Example: `labels = ["lockfile:projects/apps/lua-example/luarocks.lock#projects/apps/lua-example"]`.
  - Provider naming uses the existing `providerNameForImporter(lockfilePath, importer)` from `build-tools/tools/lib/providers.ts` (same as Node).

- Phase B (Optional, per-module): Targets also carry per-module labels `module:<rockName>@<version>` if an authoritative Lua dependency export is implemented (see Exporter Integration). Provider names follow `providerNameForModuleKey(importPathOrName, version)` from `build-tools/tools/lib/providers.ts` (same as Go).

Providers are generated into:

- `third_party/providers/TARGETS.lua.auto` (importer-scoped providers; Phase A)
- `third_party/providers/TARGETS.lua.mods.auto` (optional per-module providers; Phase B)

The `gen-auto-map.ts` already understands lockfile labels; if we later emit `module:` labels for Lua, we will reuse existing module provider mapping (no changes needed to helpers).

---

## Nix Templates (build-tools/tools/nix/templates/lua.nix)

We introduce `luaApp` and `luaLib`, mirroring Go’s `goApp`/`goLib` structure and behavior:

- Inputs:
  - `name`: Buck target name.
  - `luaVersion`: default `5_4` (configurable), selects `pkgs.lua5_4` + `luaPackages_5_4`.
  - `lockfile`: path to `luarocks.lock` (or a JSON-converted equivalent, see Provider Sync).
  - `subdir`: package subdir (default `.`) if we package sources.
  - `patchDir`: default `../../patches/lua`.
  - `devOverrideEnv`: default `NIX_LUA_DEV_OVERRIDE_JSON`.

- Patches:
  - Use `H.patchesMapFromDir patchDir` from `build-tools/tools/nix/lib/lang-helpers.nix` to scan `patches/lua/*.patch` at evaluation time.
  - Keys: `rockName@version` (lowercased); values: list of absolute patch paths.
  - Applied via Nix overlays that override the corresponding Lua package derivations to add `patches`.

- Dev overrides:
  - Parse overrides via `H.readDevOverrides devOverrideEnv`.
  - In CI (`CI=true`), guard via `H.guardNoDevOverridesInCI devOverrideEnv` (same policy as Go).
  - Locally, warn when overrides are active.

- Build forms:
  - `luaLib`: produce a Lua environment `luaEnv` using `lua.withPackages` where packages are constructed via an overlay that injects `patches/src` as needed.
  - `luaApp`: wrap `luaEnv` with an app runner derivation that sets `LUA_PATH`/`LUA_CPATH` appropriately and packages entrypoints from `subdir`.

Notes:

- We avoid embedding LuaRocks execution inside Nix; instead, we rely on nixpkgs Lua packages, augmented by overlays to apply patches and optional source overrides.
- If the repository prefers strict LuaRocks lock enforcement, we add an adapter that resolves a `luarocks2nix` mapping (Phase C), but Phase A/B do not require it.

---

## Planner Integration

We extend the planner’s dispatch registry (see `graph-generator.nix` and `docs/handbook/adding-language.md`) to detect Lua targets and call the new Nix template functions:

- Detection:
  - If `rule_type` starts with `lua_` or labels include `lang:lua`, classify as Lua.

- Kind:
  - `lua_binary` → kind `bin`, uses `luaApp`.
  - `lua_library` → kind `lib`, uses `luaLib`.

- Inputs passed into templates:
  - `name`, `lockfile` (macro attribute), `subdir` (macro attribute), `patchDir` (default), `devOverrideEnv` (default), and selected `luaVersion`.

Planner remains tiny; language logic stays in `build-tools/tools/nix/templates/lua.nix`.

---

## Exporter Integration (Labels)

We add a Lua adapter to the exporter (`build-tools/tools/buck/export-graph.ts` or its modular adapter) that:

- Reads Lua targets’ attributes from Buck (via macros) and attaches the importer-scoped lockfile label:
  - `lockfile:<relative/path/to/luarocks.lock>#<importer>`.
  - The importer id defaults to the Buck package path (e.g., `projects/apps/lua-example`) unless specified by the macro.

- Optional (Phase B): If a Lua dependency index is available, add `module:<rockName>@<version>` labels based on the importer’s effective dependency set (see Provider Sync for how we compute that set).

Exporter severity remains strict in CI and warn-only locally, consistent with existing behavior.

---

## Buck Macros (lua/defs.bzl)

- Provide `nix_lua_binary`, `nix_lua_library`, and `nix_lua_test` mirroring Go macros:
  - Stamp labels: `lang:lua`, `kind:bin|lib|test`, and the importer-scoped lockfile label.
  - Append providers from `//build-tools/lang:auto_map.bzl` using `MODULE_PROVIDERS["//pkg:name"]`.
  - Forward attrs that affect configuration (e.g., entrypoint scripts, `lockfile`, `lua_version`).

Use `build-tools/lang/defs_common.bzl` helpers for stamping. Error UX and glue presence are handled by `build-tools/tools/buck/prebuild-guard.ts`.

---

## Provider Sync (build-tools/tools/buck/sync-providers-lua.ts)

We add a zx script that writes `third_party/providers/TARGETS.lua.auto` deterministically. It reuses `build-tools/tools/lib/providers.ts` for naming.

Behavior:

- Discover all `luarocks.lock` files (`**/luarocks.lock`). For each, determine its importer id (default: directory containing the lockfile).
- Build the importer’s effective set of packages (Phase A options, ordered by reliability):
  1. If `luarocks.lock.json` exists alongside the lockfile, parse it (preferred; deterministic JSON).
  2. Else parse `luarocks.lock` (Lua syntax) with a minimal parser to extract `{ name, version }` pairs.
  3. If parsing fails, fall back to including all `patches/lua/*.patch` with a warning locally; in CI, fail fast.
- Map patch files in `patches/lua/*.patch` (keyed as `<rockName>@<version>.patch`) to modules.
- For each lockfile/importer pair, include only patches whose `<rockName>@<version>` are in the effective set.
- Emit a single provider per importer using:
  - `providerNameForImporter(lockfilePath, importer)` ⇒ `lf_<hash>_<suffix>`.
  - Provider rule macro: `lua_importer_deps(name, lockfile, importer, patch_paths=[])` in `third_party/providers/defs_lua.bzl` (tiny `genrule` stamping patch content and lockfile).

Phase B (optional): add `third_party/providers/TARGETS.lua.mods.auto` with per-module providers when `module:` labels are emitted by the exporter.

Determinism and duplication checks mirror Node:

- One provider per lockfile/importer key; stable ordering; name collision guard.
- One patch per `rockName@version`; duplicates fail.

---

## Auto-map Integration

`build-tools/tools/buck/gen-auto-map.ts` already maps:

- `lockfile:<path>#<importer>` → importer-scoped providers via `providerNameForImporter`.
- If Phase B is enabled, `module:<name>@<version>` → per-module providers via `providerNameForModuleKey`.

No changes to helpers; only ensure the exporter emits the Lua labels and provider sync generates Lua providers.

---

## Patching Workflow (patch-pkg lua)

Extend `build-tools/tools/patch/patch-pkg.ts` to support `lua` with a `build-tools/tools/patch/patch-lua.ts` handler implementing:

- `start <rockName>`:
  - Create a temp editable workspace for the rock source. Strategy:
    - Prefer fetching the exact rock source tarball via LuaRocks (offline in CI, online in local dev; for hermeticity, local dev permits fetch).
    - Alternatively, source may be discovered via Nix if the package exists in nixpkgs (optional Phase C optimization).
  - Record `NIX_LUA_DEV_OVERRIDE_JSON["<rockName>@<version>"] = "/abs/tmp/path"`.
  - Launch `$PATCH_EDITOR` if set.

- `apply <rockName>`:
  - Compute unified diff `diff -ruN "$src" "$tmp" > patches/lua/<rockName>@<version>.patch`.
  - Run glue:
    - `node build-tools/tools/buck/sync-providers-lua.ts`
    - `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Clear the dev override and remove temp dir.

- `reset <rockName>`: Remove override and temp dir without writing a patch.

- `session <rockName>`: Like other languages; Ctrl-D → `apply`, Ctrl-C → `reset`.

Idempotency: Re-applying the same patch is a no-op and should not trigger rebuilds beyond normal cache checks.

---

## Scaffolding

- Add templates under `build-tools/tools/scaffolding/templates/lua/` with `meta.json` and `copier.yaml`.
- `scaf new lua <kind>` creates:
  - `luarocks.lock` and optional `rockspec` (or guidance to generate).
  - `TARGETS` using `nix_lua_*` macros; stamps the lockfile label.
  - `src/main.lua` with minimal example.
  - README with patching + build instructions.

---

## CI Stages

Integrate Lua into existing pipeline without new stages:

1. Export Graph → includes Lua labels.
2. Sync Providers → runs `sync-providers-lua.ts` (skips if no `luarocks.lock`).
3. Generate auto_map → unchanged script maps Lua labels too.
4. Pre-build guard → fail if glue missing or stale.
5. Build & Test → Buck builds Lua targets; Nix derivations apply patches and overrides (CI forbids overrides).

---

## WASM Targets (Exploratory)

With repository WASM support available, Lua can target WASM via an interpreter compiled to WASM (e.g., Wasm3 or a Lua-in-WASM build). If adopted:

- Add optional `luaWasmApp` template packaging a minimal runtime + app for WASI/freestanding.
- Keep providers/patching unchanged; planner/macros forward a `wasm` knob.
- Validate under `WebAssembly.instantiate` or `node:wasi` with a trivial script.

This is a later‑phase enhancement and not required for baseline Lua.

## Tests (zx, one-test-per-file)

- Provider sync determinism and duplicate detection for Lua.
- Auto-map wiring correctness for lockfile labels (and module labels if Phase B enabled).
- Macro stamping test ensures `lang:lua`, `kind:*`, and lockfile label present.
- Optional adapter validation: exporter warns/fails when Lua sources lack `lang:lua` label or required lockfile label.

Use the existing harness conventions (external timeouts, zx tests under `build-tools/tools/tests/**`).

---

## Phased Implementation Plan

Phase A — Minimal reliable flow (importer-scoped)

- Implement `build-tools/tools/nix/templates/lua.nix` with overlay-based patching and dev override handling.
- Add `lua/defs.bzl` macros and stamp importer-scoped lockfile labels.
- Extend exporter to emit lockfile labels for Lua targets.
- Implement `build-tools/tools/buck/sync-providers-lua.ts` and `third_party/providers/defs_lua.bzl`.
- Add tests for provider sync, auto-map, macro stamping.

Phase B — Optional per-module accuracy

- Add `module:<rockName>@<version>` labels via an authoritative dependency set for each importer (prefer JSON lock conversion to eliminate parser ambiguity).
- Generate `TARGETS.lua.mods.auto` with one provider per module@version.
- Update tests to assert per-module wiring.

Phase C — Optional Nix hardening

- Add a `luarocks2nix` converter or integrate existing nixpkgs generators to resolve lockfiles to exact Nix inputs.
- Prefer fully offline builds in CI by sourcing from Nix instead of LuaRocks.

---

## Key Assumptions (to validate)

- LuaRocks is the package manager for Lua projects in this repo; `luarocks.lock` exists per importer (project).
- Importer identity for Lua projects can default to the project directory (like Node) unless overridden.
- The repository is comfortable starting with importer-scoped invalidation (like Node), with a path to per-module precision later.
- nixpkgs includes the required Lua packages, or we can overlay them; patching via overlays is acceptable.
- Allowing local developer fetches of rock sources is acceptable during `patch-pkg start` sessions; CI remains hermetic.

---

## Risks and Mitigations

- Lockfile Parsing Ambiguity
  - Risk: `luarocks.lock` is Lua syntax; ad-hoc parsing can be brittle.
  - Mitigation: Prefer a JSON sidecar `luarocks.lock.json` or add a tiny converter script; in CI, require JSON form to avoid ambiguity.

- Incomplete Package Coverage in nixpkgs
  - Risk: Some rocks are not packaged in nixpkgs, complicating overlay-based patching.
  - Mitigation: Provide a fallback builder to fetch rock sources deterministically (fixed-output derivations) keyed by the lockfile; Phase C hardening.

- Coarse Invalidation if Effective Set Unknown
  - Risk: If we cannot compute importer effective sets, providers might include all patches, over-invalidating.
  - Mitigation: Fail in CI when parsing fails; locally warn and proceed; prioritize implementing JSON lock parsing.

- Dev Overrides Affecting Reproducibility
  - Risk: Overrides change derivation hashes.
  - Mitigation: Same policy as Go: warn locally; fail in CI when overrides are set; provide `build-tools/tools/dev/clear-overrides.ts` support for Lua env var.

- Tooling Availability (luarocks)
  - Risk: Missing LuaRocks in dev shell breaks patch sessions.
  - Mitigation: Update dev shell to include Lua/LuaRocks; `build-tools/tools/dev/startup-check.ts` should check for `lua` and `luarocks`.

---

## Areas of Concern

- Mapping lockfile entries to nixpkgs attributes may require a curated map or a generator.
- Native modules (`.so`/C modules) require toolchain support; ensure `lua` + `luarocks` build helpers include `gcc`/`make` in Nix where needed.
- Version normalization differences between LuaRocks and nixpkgs could cause mismatches; normalize and test.
- Windows support is out of scope; focus on aarch64-darwin, aarch64-linux, x86_64-linux.

---

## Completion Criteria

- Lua targets build via Buck2 and Nix using `nix_lua_*` macros.
- Importer-scoped providers exist and are auto-mapped; changing `luarocks.lock` or relevant patches invalidates only affected targets.
- Patching flow (`patch-pkg lua`) is usable end-to-end with dev overrides and canonical patch files.
- Tests pass (provider sync determinism, auto-map wiring, macro stamping). CI stages include Lua where applicable.
