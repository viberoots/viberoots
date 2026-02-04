## Ruby as a First-class Language (incl. Rails)

This document proposes how to add Ruby (including a Ruby on Rails web app template) as a first‑class language in this repository. It follows the project methodology and reuses the same architectural patterns used for Go and Node: Buck2 as the orchestrator, Nix for hermetic builds via dynamic derivations, zx TypeScript scripts for glue generation, flat patch directories, provider auto‑wiring, and macro‑based target ergonomics.

### Design goals

- Align with Methodology constraints: deterministic builds, minimal moving parts, clear module boundaries, and reproducible patching.
- Reuse existing provider naming, auto_map, glue, and patching patterns to minimize new surface area.
- Support both generic Ruby libraries and a Rails web app template.
- Keep partial clone friendly: Ruby support is enabled by file presence; other languages keep working without Ruby.

### Linking expectations

I follow the repo-wide linking model described in `cpp-linking.md`, `build-tools/docs/wasm-linking.md`, and `linking-roadmap.md`. If this language does not introduce native or cross-language linking, `deps` remains a graph edge list and no link intent is inferred.

- `deps` is the Buck graph edge list. It does not imply link intent.
- `link_deps` declares linkable inputs. `header_deps` is include-only when that concept applies.
- Macros compute `deps := deps ∪ link_deps ∪ header_deps` deterministically and validate `link_closure_overrides` keys.
- `link_closure` defaults to `"direct"`. `"transitive"` follows `link_deps` only via `build-tools/tools/nix/planner/link-closure.nix`.
- Ordering is deterministic and unsupported deps fail fast with targeted errors.

### C interop requirement

If the language can support C interop, I must provide a documented and tested path to link or call C code using the repo linking model (explicit `link_deps` and deterministic closure). If the language cannot support C interop, this doc must state why and list the constraints.

### Shared wiring and contracts (current repo)

Use the canonical helper surface from `//lang:defs_common.bzl` and `//lang:language_wiring.bzl`. Macro call sites should not re‑implement wiring or load provider maps directly.

- Preferred macro entrypoint: `prepare_language_wiring(...)` (non‑mutating), with `wiring=` for `genrule`, `nix_calling_genrule`, `non_genrule`, or `srcsless_rule`.
- Provider wiring: load `MODULE_PROVIDERS` from `//lang:auto_map.bzl` and use `providers_for`/`realize_provider_edges` for deterministic provider edges.
- Lockfile labels (importer‑scoped languages): `lockfile:<path>#<importer>` with supported importer roots `.` and `apps/*`/`libs/*`; importer‑scoped macros must live in the importer package so importer‑local patch globs are valid action inputs.
- Patch model contract: `lang/lang_contracts.bzl` and `build-tools/tools/lib/lang-contracts.ts` define `patch_scope:*` stamping and whether glue runs on patch apply/remove.
- Global Nix inputs: for Nix‑calling macros, use `wire_global_nix_inputs(...)` so `global_nix_inputs()` are real action inputs; labels are observability only.

## Architecture overview

- Buck2 computes the build graph, we export configured nodes to `build-tools/tools/buck/graph.json` (existing exporter, extended with a Ruby adapter). The Ruby adapter reads each target’s `Gemfile.lock` and emits deterministic labels per gem.
- Nix dynamic derivations plan Ruby builds via new language templates in `build-tools/tools/nix/templates/ruby.nix`, invoked from the planner (`graph-generator.nix`).
- Patches live in `patches/ruby/*.patch` with flat naming `<gem>@<version>.patch`. A Ruby provider sync script generates `third_party/providers/TARGETS.ruby.auto` with one provider per gem@version. Auto‑map ties targets to providers via `module:<gem>@<version>` labels.
- Patching workflow is unified under `patch-pkg` with a Ruby handler that supports start/reset/apply/session, dev overrides via `NIX_RUBY_DEV_OVERRIDE_JSON`, and idempotency.

## Path invariants and naming

- Patches: `patches/ruby/*.patch` (flat directory, one patch per `gem@version`).
- Nix templates: `build-tools/tools/nix/templates/ruby.nix` (consumed by `build-tools/tools/nix/lang-templates.nix`).
- Planner registry: Ruby entry in `graph-generator.nix` (dispatch by `rule_type` or `labels`), calling `rubyApp`/`rubyLib` from `lang-templates.nix`.
- Providers:
  - Ruby provider rules generated to `third_party/providers/TARGETS.ruby.auto`.
  - Provider macro defined in `third_party/providers/defs_ruby.bzl` (tiny genrule stamp).
- Macros: `ruby/defs.bzl` thin wrappers over upstream rules (or genrules) that stamp labels and append providers from `//lang:auto_map.bzl`.
- Labels:
  - Per‑gem labels: `module:<gem>@<version>` added to Ruby targets by the exporter.
  - Optional lockfile label: `lockfile:<path/to/Gemfile.lock>` for diagnostics (not used for providers).

## Nix integration (templates)

Add `build-tools/tools/nix/templates/ruby.nix` that exposes two functions mirroring Go’s `goApp`/`goLib` pattern:

- `rubyApp` — builds an app using Bundler; targeted at Rails apps but generic enough for any app with a `Gemfile.lock`.
- `rubyLib` — builds a library/test environment using Bundler.

Key behaviors (consistent with Go templates):

- Build inputs: `name`, `gemfileLock`, optional `gemset` (if using bundix), `subdir` (default "."), `devOverrideEnv` (default `NIX_RUBY_DEV_OVERRIDE_JSON`), and `patchDir` (default `../../patches/ruby`).
- `patchesMapFromDir` scans `patchDir` into a map `{"<gem>@<version>" = [ /abs/path.patch ... ]}` at Nix eval time, identical to Go’s approach.
- `devOverrides` reads JSON from `NIX_RUBY_DEV_OVERRIDE_JSON`: `{ "<gem>@<version>": "/abs/dev/path" }`.
- CI guardrails: if `CI=true` and dev overrides are set, throw.
- Patching: inject patches per gem using the chosen Ruby Nix builder (see below), and override `src` when dev overrides point to a local path.

Recommended base in nixpkgs:

- Use `bundlerEnv`/`bundlerApp` from nixpkgs to realize a hermetic bundle from `Gemfile.lock` (optionally with `bundix` generated `gemset.nix`).
- Implement a small overlay inside `ruby.nix` to patch specific gems:
  - Build the bundler spec set (via bundix or a small parser) to a derivation set `gemDerivations`.
  - For each gem, apply `(patchesMap.${gemName}@${gemVersion} or [])` as `patches` and conditionally override `src` with `devOverrides`.
  - Compose a new `bundlerEnv`/`bundlerApp` from the patched derivations.

Notes:

- The exact nixpkgs API shape varies by release; keep the template small and localize any builder differences behind helper functions in `ruby.nix`.
- Prefer a fixed Ruby version (e.g., `ruby_3_2` or `ruby_3_3`) provided by the repo’s flake.

## Planner integration (`graph-generator.nix`)

- Add a Ruby entry to the planner dispatch (mirroring Go):
  - Detect via `rule_type` or `labels` containing `lang:ruby`.
  - Compute `kind` as `bin` (app) vs `lib` based on `rule_type` or `labels` (`kind:bin`/`kind:lib`).
  - Extract `gemfileLock` location and `subdir` from node attributes (the Ruby macros will forward these).
  - Instantiate `rubyApp` or `rubyLib` from `build-tools/tools/nix/lang-templates.nix`.

## Exporter labels (Ruby adapter)

Extend the zx exporter with a Ruby adapter (similar to Go/Node adapters):

- For each configured Ruby target, read its `Gemfile.lock` and compute the effective set of gems used by that target.
- Emit one label per gem: `module:<gem>@<version>`.
- Implementation options:
  - Preferred: shell out to Ruby for robust parsing to avoid re‑implementing Bundler’s lockfile parser:
    - `ruby -rbundler -e 'puts Bundler::LockfileParser.new(File.read("Gemfile.lock")).specs.map{|s| "#{s.name}@#{s.version}" }'`
  - Fallback: minimal JS parser for the standard lockfile format (acceptable for MVP; replace with Ruby parser when available).
- Optionally, include `lockfile:<relative/path/to/Gemfile.lock>` for diagnostics.
- Cache by `(Gemfile.lock hash, Ruby version, bundle config)`. Emit identical labels across runs (sorted, deduped).

Why per‑gem labels? It enables fine‑grained invalidation (only targets that transitively use the patched gem rebuild), matching Go’s precision and reusing the existing `module:` auto‑map handling.

## Providers and auto‑map

- Provider macro: add `//third_party/providers/defs_ruby.bzl` with:

```starlark
def ruby_gem_patch(name, gem_key, patch_path):
    genrule(
        name = name,
        srcs = [patch_path],
        out = name + ".stamp",
        cmd = "if command -v sha256sum >/dev/null; then cat $SRCS | sha256sum > $OUT; else cat $SRCS | shasum -a 256 > $OUT; fi",
        visibility = ["//visibility:public"],
    )
```

- Provider sync: add `build-tools/tools/buck/sync-providers-ruby.ts` (zx) that:
  - Scans `patches/ruby/*.patch` (flat directory).
  - Decodes a gem key from filename (`<gem>@<version>.patch` → `<gem>@<version>`; lowercase).
  - Emits deterministic `third_party/providers/TARGETS.ruby.auto` with one `ruby_gem_patch(...)` per gem@version.
  - Enforces one patch per gem@version (fail on duplicates). Warn on subdirectories.
  - Use `providerNameForModuleKey(gem, version)` from `build-tools/tools/lib/providers.ts` for naming to keep consistency (`mod_<hash>_<suffix>`).

- Auto‑map: no changes required. `build-tools/tools/buck/gen-auto-map.ts` already maps `module:<…>` labels to provider names via `providerNameForModuleKey`. Ruby targets will automatically pick up the correct providers.

## Buck macros (`ruby/defs.bzl`)

Provide thin macros consistent with Go/Node style and `lang/defs_common.bzl` helpers:

```starlark
load("@prelude//:defs.bzl", "genrule")  # or appropriate upstream ruby rules when available

def _providers_for(name):
    MODULE_PROVIDERS = {}
    load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])

def nix_ruby_lib(name, labels = [], deps = [], gemfile = "Gemfile", lockfile = "Gemfile.lock", **kwargs):
    labels = labels + ["lang:ruby", "kind:lib"]
    deps = deps + _providers_for(name)
    genrule(name = name, srcs = [gemfile, lockfile], out = name + ".stamp", cmd = "echo ruby_lib > $OUT", labels = labels, deps = deps, **kwargs)

def nix_ruby_app(name, labels = [], deps = [], gemfile = "Gemfile", lockfile = "Gemfile.lock", **kwargs):
    labels = labels + ["lang:ruby", "kind:bin"]
    deps = deps + _providers_for(name)
    genrule(name = name, srcs = [gemfile, lockfile], out = name + ".stamp", cmd = "echo ruby_app > $OUT", labels = labels, deps = deps, **kwargs)
```

Notes:

- The above is an illustrative shell; in practice you’ll wrap real Ruby build/test rules or a thin genrule that triggers the Nix build artifact wired by the planner. The important parts are label stamping and provider appending.

## Patching workflow (`patch-pkg ruby`)

Add a Ruby handler `build-tools/tools/patch/patch-ruby.ts` implementing the shared `LanguageHandler` interface:

- `start <gem>`: materialize a writable copy of the gem source (prefer APFS CoW on macOS; `cp -a` fallback). Set `NIX_RUBY_DEV_OVERRIDE_JSON["<gem>@<version>"] = "/abs/tmp/dir"`. Optionally open `$PATCH_EDITOR`.
- `apply <gem>`: compute a unified diff from the original gem source to the temp dir and write to `patches/ruby/<gem>@<version>.patch`. Then run glue: `sync-providers` and `gen-auto-map`. Clear the override and delete the temp dir.
- `reset <gem>`: remove override and delete the temp dir.
- `session <gem>`: long‑lived editing; Ctrl‑D → `apply`; Ctrl‑C → `reset`.

Idempotency: reapplying the same patch is a no‑op and must not trigger rebuilds.

Dev overrides: show a local warning whenever `NIX_RUBY_DEV_OVERRIDE_JSON` is set; fail in CI.

## Rails app template (scaffolding)

Add scaffolding templates under `build-tools/tools/scaffolding/templates/ruby/rails-app`:

- Files:
  - `Gemfile` with minimal Rails, Puma, and standard gems.
  - `Gemfile.lock` placeholder (generated during install in dev shell).
  - `config/`, `app/`, `bin/rails` minimal skeleton.
  - `TARGETS` using `nix_ruby_app(...)` and stamping `labels = ["lang:ruby", "kind:bin"]`.
  - README with commands.

Integration notes:

- Assets: prefer `jsbundling-rails` with `esbuild` for minimal Node coupling. If Node is used, keep it importer‑scoped via the Node provider system (label `lockfile:<path>#<importer>` on the Node targets used by the app).
- Database: default to SQLite for local dev to minimize dependencies.

## CI and glue

- CI stages unchanged in shape; Ruby plugs into existing glue:
  1. Export Graph: exporter includes Ruby adapter, writes `graph.json`.
  2. Sync Providers: run `build-tools/tools/buck/sync-providers.ts` which delegates to language drivers including Ruby (or call `sync-providers-ruby.ts` directly if not yet integrated).
  3. Generate auto_map: unchanged.
  4. Build & Test: Buck builds that pull in Ruby derivations via the planner.
  5. Pre‑build guard: unchanged; it validates glue presence. Optionally extend to detect `Gemfile.lock` → requires `TARGETS.ruby.auto` present.

## WASM Targets (Exploratory)

Given repository WASM facilities, Ruby’s WASM story is interpreter‑based rather than compilation:

- Option: evaluate embedding a Ruby interpreter compiled to WASM (e.g., mruby/mruby‑wasm) for browser/WASI use cases.
- Planner/macros: add an optional `nix_ruby_wasm_app` template that packages a minimal runtime + app; reuse patch/override maps where applicable.
- Tests: run under `WebAssembly.instantiate` (freestanding) or `node:wasi` and assert a trivial function.

This remains a later‑phase exploration and is not required for baseline Ruby support.

## Tests

Add zx tests, one per file, consistent with repo conventions:

- Provider sync determinism: `build-tools/tools/tests/ruby/sync-providers-ruby.deterministic.test.ts`.
- Exporter labels correctness: `build-tools/tools/tests/ruby/exporter.ruby-labels.test.ts` — ensures `module:<gem>@<version>` labels match `Gemfile.lock` contents.
- Auto‑map wiring: reuse `build-tools/tools/tests/e2e-provider-wiring.ts` to assert that a Ruby target depends on the expected `mod_*` providers.
- Patching idempotency: create/edit/apply the same patch twice; second run is a no‑op.

Run tests with repo conventions (external timeouts and coverage env).

## Phases (ordered, verifiable)

1. Scaffolding & invariants
   - Create `patches/ruby/` and `third_party/providers/defs_ruby.bzl`.
   - Add `build-tools/tools/nix/templates/ruby.nix` with placeholder functions; wire in `lang-templates.nix`.
   - Acceptance: `sync-providers-ruby.ts` runs idempotently on empty patches.

2. Planner & macros
   - Add `ruby/defs.bzl` with `nix_ruby_app/lib/test` that stamp labels and append providers.
   - Add planner dispatch for Ruby targets and call `rubyApp/rubyLib`.
   - Acceptance: building a sample target triggers Nix instantiation without patches.

3. Exporter adapter
   - Implement Ruby adapter to parse `Gemfile.lock` and emit `module:<gem>@<version>` labels per target.
   - Acceptance: labels are stable, sorted, and correct for a sample app.

4. Provider sync
   - Implement `build-tools/tools/buck/sync-providers-ruby.ts` using `build-tools/tools/lib/providers.ts` for naming.
   - Acceptance: adding `patches/ruby/rack@2.2.9.patch` generates one provider with stable name.

5. Auto‑map wiring
   - Ensure `gen-auto-map.ts` includes Ruby providers for targets that label gems.
   - Acceptance: only targets that transitively use `rack@2.2.9` map to its provider.

6. Patching workflow
   - Implement `build-tools/tools/patch/patch-ruby.ts` and register in `patch-pkg`.
   - Acceptance: `patch-pkg start/apply/reset ruby rack` works; glue regenerates.

7. Rails template
   - Add scaffolding and a sample app under `apps/rails-example` (optional) to validate flow.
   - Acceptance: app builds locally under Buck; provider wiring functions on a dummy gem patch.

8. Tests & CI
   - Add zx tests and enable in CI; ensure coverage is merged per repo conventions.
   - Acceptance: CI green across supported platforms.

## Assumptions to validate

- nixpkgs provides a stable `bundlerEnv`/`bundlerApp` interface suitable for per‑gem patch application and source override.
- Using `bundix` to generate `gemset.nix` is acceptable and can be invoked from `build-tools/tools/dev/install-deps.ts` similarly to `gomod2nix`.
- Exporter may invoke a local `ruby` binary to parse `Gemfile.lock` (Ruby present in dev shell and CI).
- Rails app’s minimal Node usage can be isolated (esbuild) or integrated via existing Node provider flow when needed.

## Risks and mitigations

- Per‑gem patching in Nix may require customizing how `bundlerEnv` wires gem sources.
  - Mitigation: encapsulate patch application behind thin helpers in `ruby.nix`; start with gems that unpack cleanly (no native ext), expand coverage incrementally.
- Native extensions (e.g., `pg`, `nokogiri`) need platform toolchains and headers.
  - Mitigation: reuse existing C/C++ toolchains; add minimal builder flags as needed; document supported platforms; add targeted CI jobs.
- Lockfile parsing drift.
  - Mitigation: rely on Bundler parser via Ruby; add tests against representative lockfiles.
- Rails asset pipeline may pull Node/Yarn or CSS tooling.
  - Mitigation: prefer `jsbundling-rails` with esbuild; when Node is required, wire Node providers via importer‑scoped labels to keep invalidation precise.
- Performance: large bundles can slow exporter and Nix eval.
  - Mitigation: cache lockfile parses by hash; keep templates tiny; avoid unnecessary computations at eval time.

## Areas of concern

- Cross‑platform consistency for native gems in a Nix context; ensure the dev shell and CI provide necessary system libraries.
- Precise mapping of dev overrides to gem derivations; ensure overrides don’t leak into CI and change derivation keys.
- Balancing per‑gem precision vs. complexity: if per‑gem patching becomes too heavy initially, we can temporarily fall back to per‑lockfile providers for early milestones, then graduate to per‑gem.

## Completion criteria

- `build-tools/tools/nix/templates/ruby.nix` exists and supports per‑gem patches and dev overrides.
- Planner dispatch includes Ruby; `rubyApp/rubyLib` are callable for targets.
- Exporter emits correct `module:<gem>@<version>` labels for Ruby targets.
- `sync-providers-ruby.ts` generates `TARGETS.ruby.auto` deterministically from `patches/ruby/`.
- `gen-auto-map.ts` maps Ruby targets to the right providers.
- `patch-pkg ruby` workflow works end‑to‑end and is idempotent.
- Rails template scaffolds a working example that builds under Buck2.
- Tests pass locally and in CI, with coverage following repo conventions.

- **Default mapping:** start with importer‑scoped lockfile labels (mirroring Node) so existing auto‑map wiring works out of the box. Per‑gem `module:` mapping can be added later; doing so requires extending `build-tools/tools/buck/gen-auto-map.ts` to translate Ruby `module:` labels to provider names.
- **Invalidation:** include importer‑local patch files in target `srcs` (e.g., `<importer>/patches/ruby/*.patch`) so Buck invalidation is precise. Provider stamps remain metadata‑only.
