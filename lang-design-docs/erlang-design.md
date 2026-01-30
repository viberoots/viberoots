## Erlang as a First‑Class Language — Design

> Audience: Engineers and LLM agents implementing Erlang support. The design follows the repository’s existing language architecture (Go, Node) and adheres to the project methodology (SoC, determinism, minimal surface area).

### Goals and Scope

- **Goal**: Add Erlang (Rebar3/Hex ecosystem) as a first‑class language integrated with Buck2 (graph/orchestration) and Nix (hermetic builds), with patching and provider wiring consistent with Go and Node.
- **Scope (initial)**: Build Erlang libraries and applications using Rebar3; importer‑scoped lockfile providers from `rebar.lock`; patching of third‑party deps via flat `patches/erlang/*.patch` keyed by package@version; dev overrides for fast iteration.
- **Out‑of‑scope (initial)**: Elixir/Mix; cross‑language BEAM release packaging; OTP releases; rebar profiles beyond `default` (not blocked, just deferred).

### Philosophy Alignment (from Methodology)

- **Architectural minimalism**: Small plugins + shared helpers; no bespoke pipelines per language.
- **Deterministic reliability**: Lockfile‑driven derivations; stable label → provider mapping; CI guardrails; idempotent generators.
- **Separation of concerns**: Planner dispatch is tiny; Nix templates encapsulate build logic; zx generators manage glue; Buck macros are thin wrappers.

### Linking expectations

I follow the repo-wide linking model described in `cpp-linking.md`, `wasm-linking.md`, and `linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

### Path Invariants (must‑follow)

- **Patches**: `patches/erlang/` (flat directory; one file per `pkg@version`), no subdirectories.
- **Nix templates**: `tools/nix/templates/erlang.nix` (exposed by `tools/nix/lang-templates.nix`).
- **Planner integration**: `tools/nix/planner/erlang.nix` or a small addition in `graph-generator.nix` registry that imports planner helpers if present.
- **Buck macros**: `erlang/defs.bzl` using `lang/defs_common.bzl` helpers; macros inject providers from `//third_party/providers:auto_map.bzl`.
- **Provider rules**: `//third_party/providers/defs_erlang.bzl` with `erlang_lockfile_deps(...)` (tiny genrule stamp), and an auto‑generated `third_party/providers/TARGETS.erlang.auto`.
- **Provider driver**: `tools/buck/providers/erlang.ts`; orchestrated by `tools/buck/sync-providers.ts` alongside Go/Node.
- **Capability gating**: Add `erlang` entry to `tools/nix/langs.json` (requiredPaths include the files above) so sparse checkouts cleanly disable Erlang glue.
- **Glue**: zx scripts under `tools/buck/` and shared helpers in `tools/lib/` (reuse existing patterns).

### Key Assumptions (to validate)

- **A1: Lockfile** — Projects use Rebar3 with a `rebar.lock` (per app/lib). Multi‑app repos may have multiple `rebar.lock` files (e.g., under `apps/*` or `libs/*`). If a repo uses `erlang.mk` or bare git checkouts without a lockfile, we will add a fallback (Phase C).
- **A2: Nixpkgs** — We will use `beamPackages` from Nixpkgs (e.g., `beamPackages.rebar3`, `beamPackages.erlang`). These provide reproducible builds on macOS and Linux.
- **A3: Dependency identity** — For Hex deps we can derive stable keys as `<name>@<version>`. For git deps we will derive keys as `git+<host>/<owner>/<repo>@<rev>`; these map to patch filenames and provider set membership.
- **A4: Buck rules** — We can express Erlang builds via thin macros over `genrule` invoking Rebar3 in a hermetic Nix environment, until native `erlang_*` rules exist. This mirrors the Node macro strategy.

### Decisions and Open Questions

- D1 (Importer identity): Use Erlang app name from `rebar.config` when present; fallback to the package directory (e.g., `apps/foo`). Expose explicit `importer` in macros for overrides.
- D2 (Git dep identity): Normalize to `git+<host>/<owner>/<repo>@<rev>`; reject floating refs. Confirm lockfile always pins rev.
- D3 (Profiles): Start with the `default` profile only; revisit profile‑scoped providers later if needed.

### Architecture Overview

- **Labels**: Erlang targets carry a deterministic lockfile label: `lockfile:<relative/path/to/rebar.lock>#<importer>`. The importer is the Erlang app name (from `rebar.config`/`{project_applications, [...]}` or `{app, Name}`); default to the package directory (e.g., `apps/foo`) if an explicit name isn’t resolvable.
- **Providers**: A zx generator scans all `rebar.lock` files and `patches/erlang/*.patch`, computes per‑importer effective dep sets, and emits `TARGETS.erlang.auto` with one provider per `(lockfile, importer)`; patch paths included only if relevant to the importer’s effective set.
- **Invalidation**: Macros also include importer‑local patch files in target `srcs` (mirroring Node) so Buck invalidation is precise. Provider stamps remain metadata‑only.
- **Auto‑map**: `gen-auto-map.ts` maps `lockfile:...#...` labels to the fully qualified provider target names using shared naming helpers.
- **Nix**: Templates `erlangApp`/`erlangLib` consume the lockfile path and optional dev overrides (`NIX_ERLANG_DEV_OVERRIDE_JSON`), apply patches deterministically by scanning `patches/erlang/`, and perform the Rebar3 build under `beamPackages`.
- **Patching UX**: `patch-pkg` gets an Erlang handler mirroring Go/Node flows: `start`, `apply`, `reset`, `session`; canonical patch filenames in `patches/erlang/`.

### Nix Templates (tools/nix/templates/erlang.nix)

- Expose functions analogous to Go:
  - `erlangApp { name, lockfilePath, projectDir ? ".", patchDir ? ../../patches/erlang, devOverrideEnv ? "NIX_ERLANG_DEV_OVERRIDE_JSON" }`
  - `erlangLib { ...same inputs... }`
- Responsibilities:
  - Load `beamPackages` + `rebar3` from `pkgs`.
  - Parse `patchDir` at evaluation time to build `{ "pkg@ver" = [ /abs/path.patch ... ] }` (reuse the Go Nix pattern: scan once, fold to map).
  - Read `devOverrideEnv` and decode JSON → `{ key → /abs/local/path }`. Fail in CI if non‑empty (matching Go/Node policy).
  - Use a fixed‑output derivation for fetched deps keyed by `rebar.lock` (see risks below). Build app/lib via Rebar3 with `src` patched/overridden according to maps.
  - Respect conventional excludes for vendored paths (`_build`, `deps`, `vendor`) to avoid double counting.
  - Keep the template tiny; complex logic lives in shared Nix helpers under `tools/nix/planner` if needed.

### Planner Dispatch (graph-generator.nix)

- Detect Erlang targets via either:
  - `rule_type` prefix `erlang_...` (if/when we add such macros), or
  - `labels` containing `lang:erlang` (stamped by the macros).
- For detected targets, call `T.erlangApp` or `T.erlangLib` from `tools/nix/lang-templates.nix` with `{ name, lockfilePath, projectDir }` resolved from attributes/macros.
- Keep dispatch simple; all policy belongs in the Nix template and macros.
- Optional: support custom rule names via `tools/nix/mapping.nix` (dispatch table), mirroring the Go mapping pattern.

### Labels and Auto‑Map

- **Target label**: `lockfile:<path/to/rebar.lock>#<importer>` attached to each Erlang target.
- **Mapping**: Reuse `tools/lib/providers.ts` `providerNameForImporter(lockfilePath, importer)` to generate provider target names (same hashing/suffix scheme used for Node).
- **Auto‑map**: Extend `tools/buck/gen-auto-map.ts` (if necessary) to treat Erlang lockfile labels exactly like Node’s: translate to `//third_party/providers:<name>`, dedupe, sort, emit under `MODULE_PROVIDERS` for use in macros.
- Example:
  - Target label: `lockfile:apps/er/foo/rebar.lock#foo`
  - Provider: `//third_party/providers:lf_<hash>_foo__apps_er_foo_rebar_lock`

### Provider Sync (tools/buck/sync-providers-erlang.ts)

- Input discovery:
  - All `rebar.lock` files in the repo (globby `**/rebar.lock`).
  - Optional `patches/erlang/*.patch` files (flat directory).
- Lockfile parsing:
  - Parse `rebar.lock` (Erlang term format) into JSON. Strategy:
    - Prefer a small, pure parser (JS) or shell out to `erl` with a tiny script that prints JSON (under Nix tools) — either way, ensure deterministic output.
    - Extract dep graph entries: Hex deps (`{pkg, "x.y.z"}`), git deps (`{git, Url, {ref, Rev}}`), and transitive dependencies.
  - Compute the importer’s effective set: all direct + transitive + any peer‑like edges (rare in Erlang; most are normal deps). Represent each as a lower‑cased key:
    - Hex: `name@version`
    - Git: `git+<host>/<owner>/<repo>@<rev>` (normalized URL; strip protocols; pin to commit)
- Patch selection: include only patches whose `pkg@version` (or normalized git key) appear in the effective set.
- Output: `third_party/providers/TARGETS.erlang.auto` consisting of entries:
  - `erlang_lockfile_deps(name="<providerName>", lockfile="<lockfile>", importer="<importer>", patch_paths=[...])`
- Determinism: stable ordering, deduplication, collision checks (provider name collisions cause an error), idempotent writes.
- Orchestration: hook this driver into `tools/buck/sync-providers.ts` and `tools/buck/providers/index.ts` so the unified "Sync Providers" step covers Erlang alongside Go/Node.

### Provider Rule (third_party/providers/defs_erlang.bzl)

- Minimal genrule stamp mirroring Node:
  - Inputs: `lockfile` + `patch_paths` (content‑addressed).
  - Output: `<name>.stamp` produced by hashing inputs.
  - Public visibility; tiny by design.

### Buck Macros (erlang/defs.bzl)

- Thin wrappers (mirroring Node macros):
  - `nix_erlang_lib(name, srcs=..., deps=[], labels=["lang:erlang", "kind:lib"], lockfile=..., importer=..., **kwargs)`
  - `nix_erlang_app(name, ... kind:bin ...)`
  - `nix_erlang_test(name, ... kind:test ...)` (optional, may wrap `ct` or `eunit` via genrule)
- Behavior:
  - Stamp `labels` including `lockfile:<path>#<importer>`, `lang:erlang`, and `kind:*`.
  - Append providers from `//third_party/providers:auto_map.bzl` using `MODULE_PROVIDERS["//pkg:name"]`.
  - Under the hood, start with `genrule` + `rebar3` invocation inside a hermetic Nix env (acceptance: parity with direct `rebar3 compile`).
- Notes:
  - Keep macro interfaces stable so we can transparently swap the implementation to native `erlang_*` rules later.
  - Encourage per‑target one‑test‑per‑file conventions when adding Erlang tests.

### Patching Workflow (tools/patch/patch-erlang.ts)

- Subcommands under the outer `patch-pkg`:
  - `start erlang <pkg>`: Resolve `<pkg>` against the importer’s lockfile; fetch its source (Hex or git) into a temp editable dir (macOS: APFS CoW or copy); set `NIX_ERLANG_DEV_OVERRIDE_JSON` for the exact key; optionally open `$PATCH_EDITOR`.
  - `apply erlang <pkg>`: Produce a unified diff vs original sources and write to `patches/erlang/<key>.patch` where `<key>` is `name@version` or normalized git key; run provider sync + auto‑map; clear overrides and temp.
  - `reset erlang <pkg>`: Abandon and clean temp + override.
  - `session erlang <pkg>`: Long‑lived edit; Ctrl‑D commits (`apply`), Ctrl‑C aborts (`reset`).
- Idempotency: Reapplying the same patch is a no‑op; dev overrides forbidden in CI.
- Filename encoding: For git deps, encode `/` as `__` when forming `<key>` (reuse `tools/lib/providers.ts` encode/decode helpers) to mirror consistency with other languages.

### Exporter Adapter (tools/buck/export-graph.ts)

- Add a minimal Erlang adapter with two responsibilities:
  - Stamp labels onto Erlang targets if macros are not yet stamping (temporary safety net).
  - Validate invariants in `error` mode (warn in local dev only):
    - Erlang sources present but no `lang:erlang` label → warn/fail.
    - Missing `lockfile:<path>#<importer>` label on Erlang targets → warn/fail.
  - Note: The authoritative dep discovery (like Go’s `go list`) is not required initially; we rely on lockfile‑scoped providers. If needed later, we can add a `rebar3 deps-tree` exporter path.

### Prebuild Guard

- Extend `tools/buck/prebuild-guard.ts` to:
  - If any `rebar.lock` exists, require a corresponding `TARGETS.erlang.auto` provider file.
  - Ensure `auto_map.bzl` exists when Erlang labels are present.
- Local UX: In non‑strict mode, allow auto‑regeneration by invoking the Erlang provider sync driver when files are stale, mirroring existing behavior for other languages.

### CI Stages

- Mirror the existing stages:
  1. Codegen (no‑op or Erlang codegen if used) → OK to keep stub.
  2. Export Graph (`tools/buck/export-graph.ts`)
  3. Sync Providers (Go) — existing
  4. Sync Providers (Node) — existing
  5. **Sync Providers (Erlang)** — new: run via unified orchestrator (`node tools/buck/sync-providers.ts` picks Erlang driver)
  6. Generate auto_map → includes Erlang providers
  7. Prebuild Guard
  8. Build & Test

### WASM Targets (Outlook)

Repo‑level WASM support exists, but compiling BEAM code to WASM is not practical today. If a credible interpreter‑in‑WASM path emerges, we can add an optional `erlangWasmApp` template that packages a minimal runtime for WASI. Providers/patching remain unchanged. This is not part of the initial Erlang plan.

### Testing Plan (zx tests; one‑test‑per‑file)

- Determinism/idempotency: `sync-providers-erlang` writes identical output across runs with unchanged inputs; detects duplicate patch keys; stable ordering.
- Auto‑map wiring: Erlang targets with `lockfile:<path>#<importer>` labels pull in the matching provider; unrelated providers are absent.
- Patching E2E: Create a temporary `rebar.lock`, add a dummy patch `pkg@ver.patch`, run sync + auto‑map, verify only targets bound to that lockfile depend on the provider.
- Dev override guard: CI fails when `NIX_ERLANG_DEV_OVERRIDE_JSON` is set.
- Harness: Follow repo conventions — one test per file; run with `buck2 test` and external timeouts; coverage via `-- --env COVERAGE=1` when enabled.

### Risks and Mitigations

- **R1: Lockfile Parsing Complexity** — Rebar’s lockfile format is an Erlang term; Hex and git entries vary.
  - Mitigation: Implement a tiny parser using an Erlang one‑liner under Nix (`erl -noshell -eval ...`) to convert to JSON deterministically. Cache outputs keyed by lockfile hash. Provide a pure‑JS fallback for local dev if `erl` is missing, but require it in CI.
- **R2: Git Dep Identity** — Normalizing git URLs and pins consistently is error‑prone.
  - Mitigation: Normalize to `git+<host>/<owner>/<repo>@<rev>` by parsing with URL libs; strip protocol/user; always require a pinned commit in lockfile; error if floating.
- **R3: Nix Builder Complexity** — Building via `beamPackages` may differ across platforms and OTP versions.
  - Mitigation: Pin `erlang`/`rebar3` versions via flake inputs; add a small matrix smoke test across supported systems; fail fast with clear messages if versions mismatch.
- **R4: Absence of Native Buck Erlang Rules** — Initially using `genrule` leaves ergonomics/perf on the table.
  - Mitigation: Keep macros thin and replace internals with native rules later without changing macro interfaces.
- **R5: Patching Non‑Hex Git Deps** — Applying patches to arbitrary git deps may require custom fetch flows.
  - Mitigation: During `apply`, record the original tarball/tree for the exact rev and generate patches relative to it; Nix template applies patches post‑fetch via `patches` array, same as Go.
- **R6: Umbrella Projects** — Multiple apps may share a root `rebar.lock`.
  - Mitigation: Treat each importer as an app directory; allow explicit `importer` param in macros; compute effective sets per importer by reading each app’s `rebar.config` + `deps` used.
- **R7: Lockfile shape drift** — Future Rebar3 changes could alter `rebar.lock` structure.
  - Mitigation: Keep the lock parser tiny and table‑driven; add version detection; fail fast with an actionable message and a pointer to update the parser.

### Areas of Concern

- Rebar profiles and optional deps may alter the effective set; we start with `default` profile and later extend to profile‑scoped providers if needed.
- Some Erlang projects include vendored deps; provider wiring should not double‑count them. We will ignore vendored directories by convention (`_build`, `deps`, `vendor`) and rely on lockfile entries only.
- Windows support is out of scope initially; focus on `aarch64-darwin`, `aarch64-linux`, `x86_64-linux`.
- Publish/Release workflows (e.g., OTP releases) are not covered here; ensure boundaries so later additions don’t impact provider semantics.

### Completion Criteria

- `tools/nix/templates/erlang.nix` implements `erlangApp` and `erlangLib` with patch/override maps and CI override guard.
- `erlang/defs.bzl` exists; macros stamp labels and append providers from `auto_map.bzl`.
- `third_party/providers/defs_erlang.bzl` exists; `TARGETS.erlang.auto` is generated deterministically by `sync-providers-erlang.ts`.
- `gen-auto-map.ts` maps Erlang lockfile labels to providers; macros consume them.
- `patch-pkg` supports Erlang with `start/apply/reset/session` flows.
- zx tests for provider determinism and auto‑map wiring pass locally and in CI.
- Capability gating wired in `tools/nix/langs.json`; sparse checkout disables Erlang cleanly.

### Phased Implementation (small, verifiable steps)

1. Scaffolding and invariants
   - Create `patches/erlang/` (empty), `third_party/providers/defs_erlang.bzl` (genrule stamp), stub macros in `erlang/defs.bzl` stamping labels.
   - Verification: Macros compile; labels appear in `tools/buck/graph.json` via exporter.
2. Provider sync (Erlang)
   - Implement `tools/buck/sync-providers-erlang.ts`; parse `rebar.lock`, emit `TARGETS.erlang.auto` idempotently; add zx tests.
   - Verification: With a dummy lockfile and dummy patches, generator output is stable; collisions detected.
3. Auto‑map integration
   - Ensure `gen-auto-map.ts` maps Erlang lockfile labels to provider names (reuse Node path); add wiring tests.
   - Verification: Targets depend only on their importer’s provider.
4. Nix templates
   - Add `tools/nix/templates/erlang.nix` using `beamPackages` + Rebar3; implement patch/override maps; CI override guard.
   - Verification: Build a small sample Erlang lib/app under Buck via macros; parity with direct `rebar3 compile`.
5. Patching UX
   - Add `tools/patch/patch-erlang.ts`; hook into `patch-pkg`; canonical patch filenames; run glue on apply.
   - Verification: Start→edit→apply produces a patch file and updates provider + auto‑map.
6. CI stages
   - Add Erlang provider sync into CI; extend prebuild guard; ensure green on matrix.
   - Verification: Glue generated; builds succeed; tests pass.
7. Capability gating
   - Add `erlang` entry to `tools/nix/langs.json` (required and optional paths); ensure glue respects gating.
   - Verification: Removing required paths disables Erlang glue without affecting other languages.

### Notes on Code Reuse

- Reuse `tools/lib/providers.ts` for provider naming; keep one source of truth.
- Reuse `tools/buck/gen-auto-map.ts` machinery for mapping `lockfile:...#...` labels.
- Mirror Node provider generator structure for Erlang (naming, hashing, validations, idempotency).
- Follow Go’s Nix patch/override map patterns inside `erlang.nix`.
- Reuse `tools/buck/sync-providers.ts` orchestrator and `tools/buck/providers/index.ts` driver registry pattern to integrate Erlang cleanly.

### Future Extensions

- Add Elixir/Mix support with `mix.lock` as lockfile and `mix` tooling; reuse the same lockfile+importer label and provider generator shape.
- Introduce native Buck Erlang rules to replace genrule wrappers; keep macro interfaces stable.
- Optional: Profile‑aware providers (`lockfile:...#<importer>@<profile>`) if divergence becomes necessary.
