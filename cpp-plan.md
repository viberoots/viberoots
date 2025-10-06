## C++ Enablement Plan — Architecture, Phases, and Detailed Design

This document proposes adding C++ as a first-class language to the repo with minimal ceremony and strong determinism. We reuse the Phase 3–4 architecture: exporter → planner (Nix) → macros → provider sync → auto-map → prebuild guard → tests. The plan targets templates for libraries and binaries, optional third-party patching, and sparse-checkout grace.

### Scope

- Templates: `cpp/lib`, `cpp/bin`
- Planner templates and mapping
- Exporter adapter and labels
- Macros (`//cpp/defs.bzl`) stamping `lang:cpp` + `kind:*`
- Provider sync:
  - v1: no module providers (Buck deps for local libs/prebuilts)
  - v2: nixpkgs-backed providers for third-party C++ libraries (canonical source)
- Scaffolding and diagnostics integration
- Go + cgo via nixpkgs providers (follow-up PR in this plan)

### Principles

- Deterministic outputs; stable sorts
- Partial-clone safe discovery
- Minimal approvals: add files + manifest, run codegen, run tests
- Small, readable functions (low cyclomatic complexity)
- Fix leaky or unfitting abstractions as we go (don’t force Go-centric shapes onto C++). Prefer targeted refactors to shared helpers rather than per-language workarounds.
- Continuously reduce cyclomatic complexity and enhance readability/self-documentation with clear names and small, purpose-led helpers.

### Refactoring and abstraction policy (applies to all PRs)

- If a Go-based helper or interface does not fit C++ semantics, refactor the shared surface (e.g., split helpers, introduce optional capabilities) instead of contorting C++ code.
- Keep refactors incremental and test-backed; prefer interface additions over breaking changes. Migrate existing consumers (Go) in the same PR when the change is low-risk; otherwise, provide a temporary adapter.
- Use manifest-driven hints to avoid language-specific conditionals in shared code. Where branching is unavoidable, isolate it behind minimal, well-named functions.

---

### Project rules and operational requirements (global)

- Follow repository rules and design docs at all times: `@METHODOLOGY.XML` and `@build-system-design.md`.
- Never commit without first verifying that all tests are wired and passing. Run the full suite with coverage and the project's external timeout policy (e.g., `buck2 test //... -- --env COVERAGE=1`).
- Ensure the dev shell environment is loaded via `direnv` so required tools (e.g., `buck2`, `timeout`, `nix`, `pnpm`) are on PATH. If needed: `direnv allow` and ensure your shell evaluates `direnv` before running commands.

See also: `getting-started-on-a-pr.md` for a practical, step-by-step guide (env, commands, DoD, troubleshooting, and examples).

---

### Sparse checkout and auto-discovery policy (global requirement)

- Must work with partial clones and sparse checkouts: if `cpp` files are absent, the system fails gracefully (no crashes), and other languages continue to work.
- No centralized registration step post-checkout: the presence of `cpp` files (planner plugin `tools/nix/planner/cpp.nix`, macros under `cpp/`, templates under `tools/nix/templates/cpp.nix`) is sufficient to enable C++.
- Planner discovery: prefer manifest-driven (`tools/nix/langs.json`) when present; otherwise fall back to on-disk existence check for `tools/nix/planner/cpp.nix`.
- Exporter adapter discovery: adapter files under `tools/buck/exporter/lang/` are glob-loaded; missing files simply mean no adapter for that language.
- Diagnostics: must clearly indicate when C++ is disabled due to missing required paths.

---

## Architecture

1. Exporter (Buck → JSON):
   - Detect C++ targets via `rule_type` prefixes (`cxx_`) and/or `lang:cpp` labels.
   - Attach labels to nodes:
     - `lang:cpp` and `kind:bin|lib|test` via macros
     - Optional module-like labels only if we adopt patchable third-party flows later (not required for initial bring-up).

2. Planner (Nix dynamic derivations):
   - `tools/nix/planner/cpp.nix` plugin exposes:
     - `isTarget(n)` → true if `rule_type` matches `cxx_*` or `lang:cpp` present
     - `kindOf(n)` → "bin" for `cxx_binary`, "lib" for `cxx_library`, "test" for `cxx_test` (or `kind:*` labels)
     - `mkApp(name)`, `mkLib(name)` → call into `tools/nix/templates/cpp.nix`
   - `modulesFileFor(name)` → not used initially (no lockfile); return `null`/"" safely
   - Discovery: manifest-driven (`tools/nix/langs.json`); fallback to on-disk plugin existence for sparse checkouts (no centralized registration)

3. Templates (Nix):
   - `tools/nix/templates/cpp.nix` implements two functions `cppApp` and `cppLib`:
     - Inputs: `name`, `srcRoot`, `subdir`, `defines`, `includes`, `cflags`, `ldflags`
     - Use `pkgs.stdenv.mkDerivation` with a small `buildPhase` that calls `c++`/`ar` via `pkgs.llvm` or repo toolchain
     - Honor `//toolchains/cxx.bzl` rules for purity; do not read workspace tools
     - No patches/overrides in v1; later PR can adopt a patch story similar to Go if needed

4. Macros (`//cpp/defs.bzl`):
   - Thin wrappers around `cxx_*` that:
     - Stamp `lang:cpp` + `kind:*` via `lang/defs_common.bzl#stamp_labels`
     - Append `MODULE_PROVIDERS` deps (noop for v1 if we have no provider mapping)

5. Provider sync & auto-map:
   - v1: skip module providers (auto-map returns empty for C++ targets)
   - v2: add nixpkgs-backed providers:
     - Labels: `nixpkg:<attrPath>` (e.g., `nixpkg:pkgs.zlib`)
     - Providers stamp the exact nix derivation (pin via `flake.lock`/overlays)
   - Auto-map is trivial: Buck targets depending on `nix_cxx_library` pick up the provider nodes
   - Sparse checkout: if provider files or overlays are absent, generation skips gracefully; other languages continue to work

---

## Recommended sequencing (minimize risk, maximize reuse)

Phase A → Phase B → Phase C → Phase D

1. PR 1 — C++ providers from nixpkgs (foundation for native deps)
2. PR 2 — Go cgo via nixpkgs (zlib minimal fixture)
3. PR 3 — Go cgo via nixpkgs (add openssl second fixture)
4. PR 4–12 — C++ v1 core (manifest, planner, templates, exporter, macros, scaffolding, tests, diagnostics)
5. PR 13–14 — Go↔C interop (Go→C repo_cgo_deps; C→Go c-archive/c-shared)
6. PR 15 — Overlay-based patching for nixpkgs C++ libs (optional)

7. Diagnostics:
   - `tools/dev/langs-diagnose.ts` already shows detected adapters and planner plugins; add the `cpp` manifest entry to participate in output.

---

## Detailed PRs

## Phase B — C++ v1 core

### PR 4: Manifest entry + validator

Intent/Impact

- Introduce `cpp` in `tools/nix/langs.json` so codegen, diagnostics, and planner discovery include it.

Design

- Add language entry:
  - `id: "cpp"`
  - `displayName: "C++"`
  - `requiredPaths: ["cpp/defs.bzl", "tools/nix/templates/cpp.nix"]`
  - `kinds: ["bin", "lib", "test"]`
  - `templatesDir: "tools/scaffolding/templates/cpp"`
  - `capabilities: { patching: false }`
- Update `tools/dev/validate-langs.ts` schema if needed (likely no changes).

Acceptance criteria

- Validator passes; diagnostics lists `cpp` (enabled when paths exist).

Risks

- None significant; optional fields remain optional.

If not implemented

- C++ won’t be discoverable by planner/adapters.

---

### PR 5: Planner plugin for C++

Intent/Impact

- Add `tools/nix/planner/cpp.nix` to build derivations for C++ targets.

Design

- `isTarget(n)`: `hasPrefix (n.rule_type or "") "cxx_"` or `hasAnyLabel (n.labels or []) ["lang:cpp"]`
- `kindOf(n)`: `bin` for `cxx_binary`, `lib` for `cxx_library`, `test` for `cxx_test`, else null
- `mkApp(name)`: `T.cppApp { inherit name; srcRoot = repoRoot; subdir = (pkgPathOf name); }`
- `mkLib(name)`: `T.cppLib { inherit name; srcRoot = repoRoot; subdir = (pkgPathOf name); }`
- `modulesFileFor(name)`: return `""` (unused)

Acceptance criteria

- `nix build .#graph-generator` succeeds with dummy C++ targets.

Risks

- None; plugin small and pure.

If not implemented

- Planner won’t create C++ derivations; no Nix build.

---

### PR 6: C++ Nix template — cppLib

Intent/Impact

- Provide a hermetic derivation for C++ libraries, driven by Buck metadata.

Design

- `tools/nix/templates/cpp.nix`:
  - `cppLib = { name, srcRoot ? ../../.., subdir ? ".", includes ? [], defines ? [], cflags ? [], ldflags ? [] }: ...`
  - Use `pkgs.llvmPackages` (or Buck-provided toolchain path) for `clang++`/`ar`.
  - `src = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir))`
  - Simple `buildPhase` for lib:
    - compile `*.cc/*.cpp` to `*.o`
    - archive to `lib{name}.a`
- Determinism:
  - sort file lists; pass flags in stable order; use `-fno-record-gcc-switches` where applicable

Acceptance criteria

- Building a small scaffolded lib/bin succeeds via Nix template calls.

Risks

- Over-customization; keep templates minimal, rely on Buck to control inputs.

If not implemented

- Planner derivations cannot build resulting artifacts.

---

### PR 7: C++ Nix template — cppApp

Intent/Impact

- Provide a hermetic derivation for C++ binaries that links objects with stable flags.

Design

- `tools/nix/templates/cpp.nix`:
  - `cppApp = { name, srcRoot ? ../../.., subdir ? ".", includes ? [], defines ? [], cflags ? [], ldflags ? [] }: ...`
  - Compile objects from `subdir` and link with `clang++`/`ldflags`
  - Determinism: same ordering policies as cppLib

Acceptance criteria

- Building a small scaffolded bin succeeds via `cppApp` template.

Risks

- Linker flag variance; keep flags minimal and sorted.

If not implemented

- Planner derivations cannot build binaries.

---

### PR 8: Exporter adapter for C++ (minimal)

Intent/Impact

- Allow exporter to recognize C++ nodes and attach deterministic base labels (`lang:cpp`, `kind:*`), deferring fine-grained module labels.

Design

- `tools/buck/exporter/lang/cpp.ts`:
  - `isNode(n)`: `isRuleType(n, "cxx_") || hasLabel(n, "lang:cpp")`
  - `buildBatches`: trivial (group by directory or single batch)
  - `attachLabels`: preserve and sort labels; no extra labels for now

Acceptance criteria

- Exported graph JSON contains stamped labels for C++ targets.

Risks

- None; minimal scope.

If not implemented

- Exporter remains Go-centric; labels miss `lang:cpp` on non-macro targets.

---

### PR 8.1: Multi-adapter orchestration in exporter

Intent/Impact

- Enable mixed-language exports (e.g., Go + C++) in a single run by orchestrating all present adapters and deterministically merging their enrichments.
- Keep the exporter language-agnostic; all language-specific logic remains inside adapters.

Adapter contract (no breaking changes)

- File: `tools/buck/exporter/lang/contract.ts`
- Types (reference):
  ```ts
  export type Node = {
    name: string;
    rule_type?: string;
    labels?: string[];
    srcs?: string[];
    [k: string]: any;
  };
  export type Batch = {
    key: string;
    nodes: string[];
    env?: Record<string, string>;
    args?: string[];
  };
  export interface Adapter {
    name: string; // e.g., "go", "cpp"
    isNode(n: Node): boolean; // adapter claims a node
    buildBatches(nodes: Node[]): Promise<Batch[]>; // optional heavy preprocessing per config tuple
    attachLabels(nodes: Node[], batches?: Batch[], cacheDir?: string): Promise<Node[]>; // return new/updated nodes
  }
  ```
- Backward compatible: Adapters may ignore `batches` and `cacheDir` (e.g., `cpp`).

Dispatcher/orchestration (exporter main)

- Discovery: Glob-load present adapters from `tools/buck/exporter/lang/*.ts` (already implemented for single adapter).
- Active set: `active = adapters.filter(a => nodes.some(n => a.isNode(n)))`.
- Batching:
  - For each `a ∈ active`: `nodesA = nodes.filter(a.isNode)`; `batchesA = await a.buildBatches(nodesA)`.
  - Cache directory: `${cacheRoot}/adapters/${a.name}` where `cacheRoot` defaults to `tools/buck/.cache` (created if missing). Stable path → deterministic keys.
- Deterministic execution order:
  - Sort `active` by `a.name` ascending.
  - Execute adapters sequentially by default to simplify determinism and IO (can parallelize later with bounded concurrency if needed).
- Merge algorithm (per adapter):
  - `enrichedA = await a.attachLabels(nodes, batchesA, cacheDirA)`.
  - Fold by `node.name`:
    - Fields touched by adapters today: only `labels`.
    - Merge rule for labels: `labels' = sort(unique((labels || []) ∪ (labelsA || [])))`.
    - Never delete labels; adapters only add.
    - For future adapter fields, additions must be monotonic and merged via set-union or last-writer by adapter-name order; keep the merge central and trivial.

Determinism & stability

- Inputs: Original `nodes` array, adapter presence, adapter source code, and any adapter cache contents keyed by batch `key`.
- Ordering: Sort adapters by `name`; within each adapter, sort batches by `key`; sort node merges by `node.name`.
- Output: `nodesOut` with labels lexicographically sorted; metrics (optional) include adapter names and batch keys in sorted order.

Caching

- Provide `cacheDirA` to adapters; content and eviction policy are adapter-owned.
- Go adapter may reuse its existing batch cache keyed by `(toolchain, GOOS/GOARCH/CGO, tags, go.mod/sum hash)`; `cpp` adapter typically no-ops.

Metrics & diagnostics (optional but recommended)

- Extend `--metrics-out` JSON with:
  - `adaptersActive: string[]` (sorted)
  - `adapterBatches: Record<string,string[]>` mapping adapter → sorted batch keys
  - `labelsAddedByAdapter: Record<string, number>` (counts)

Sparse-checkout grace

- If an adapter file is absent, it is simply not discovered → not active.
- If an adapter is present but no nodes match `isNode`, it is not active.
- No cross-language hard requirements: exporter runs with any subset of adapters.

Error handling

- Adapter failure should fail the run with a concise message prefixed with `[adapter:<name>]`.
- For batch-level failures, include `batch.key` in the error to aid debugging.
- Do not partially apply labels; fail-fast preserves determinism.

Pseudocode (sketch)

```ts
const adapters = loadPresentAdapters(); // discovered from lang/*.ts
const active = adapters
  .filter((a) => nodes.some(a.isNode))
  .sort((a, b) => a.name.localeCompare(b.name));
const byName = new Map(nodes.map((n) => [n.name, { ...n, labels: [...(n.labels || [])].sort() }]));
for (const a of active) {
  const nodesA = nodes.filter(a.isNode).sort((x, y) => x.name.localeCompare(y.name));
  const batchesA = await a.buildBatches(nodesA);
  const cacheDirA = path.join(cacheRoot, "adapters", a.name);
  const enriched = await a.attachLabels(nodes, batchesA, cacheDirA);
  for (const n of enriched) {
    const cur = byName.get(n.name) || n;
    const labs = new Set([...(cur.labels || []), ...(n.labels || [])]);
    byName.set(n.name, { ...cur, labels: Array.from(labs).sort() });
  }
}
const out = Array.from(byName.values()).sort((x, y) => x.name.localeCompare(y.name));
```

Tests (add to `tools/tests/exporter/`)

- `exporter.mixed-lang.labels.merge.test.ts`:
  - Simulated nodes: 1 Go lib/test and 1 C++ bin.
  - Expect: Go targets keep `lang:go` + module labels; C++ target gets `lang:cpp` + `kind:bin`.
  - Labels are deduped and lexicographically sorted per node.
- `exporter.adapters.inactive.skip.test.ts`:
  - Remove `tools/buck/exporter/lang/cpp.ts` from temp repo; ensure run still succeeds and Go labels present.
- `exporter.metrics.adapters.batches.test.ts` (if metrics enabled):
  - Verify `adaptersActive` and `adapterBatches` include `go` and `cpp` appropriately.

Acceptance criteria

- Mixed-language graph export yields correct per-language labels with no loss/duplication; ordering of labels is deterministic.
- Existing single-language tests remain green; new mixed-language tests pass.
- Exporter remains sparse-checkout friendly: missing adapters simply reduce the active set.

Risks

- Orchestration adds control flow to `exporter/main.ts`.
  - Mitigation: keep logic in 3 small, well-named helpers (`computeActive`, `runAdapter`, `mergeNodes`) with ≤10 cyclomatic complexity each.
- Potential hidden coupling via shared fields in the future.
  - Mitigation: enforce “adapters only add, never delete” policy; centralize merge for touched fields.

If not implemented

- Mixed-language graphs may lack labels for the non-selected language, reducing diagnostics and downstream provider wiring quality.

---

### PR 9: Macros (`//cpp/defs.bzl`) and stamping lint

Intent/Impact

- Introduce `nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_test` wrappers to stamp labels and later attach providers.

Design

- `load("//lang:defs_common.bzl", "stamp_labels", "dedupe_preserve", "normalize_labels")`
- For each macro:
  - `stamp_labels(kwargs, "cpp", "lib|bin|test")`
  - forward user attrs (`srcs`, `deps`, `includes`, `defines`, `cflags`, `ldflags`)
  - append auto providers (currently none)
- Ensure `tools/dev/stamping-lint.ts` checks C++ targets: C++ rules with sources must include `lang:cpp` through macros.

Acceptance criteria

- Converting a sample `cxx_*` target to `nix_cpp_*` preserves behavior and stamps labels.

Risks

- Mis-stamping edge cases; tests cover detection.

If not implemented

- Exporter may warn on missing labels; ergonomics remain inconsistent.

---

### PR 10: Scaffolding templates (cpp/lib and cpp/bin)

Intent/Impact

- Add copier templates for `cpp/lib` and `cpp/bin` producing runnable examples and `TARGETS` using `nix_cpp_*` macros.

Design

- `tools/scaffolding/templates/cpp/lib`:
  - `libs/{{ name }}/`
  - `TARGETS` with `nix_cpp_library(name = "{{ name }}", srcs = glob(["src/**/*.cpp"]))`
  - minimal `src/{{ name }}.cpp` and a single `*_test.cpp` (one test per file convention)
- `tools/scaffolding/templates/cpp/bin`:
  - `apps/{{ name }}/`
  - `TARGETS` with `nix_cpp_binary(name = "{{ name }}", srcs = ["src/main.cpp"], deps = [])`
  - `src/main.cpp` hello world

Acceptance criteria

- `scaf new cpp lib demo-lib` and `scaf new cpp bin demo-cli` both build and the test passes.

Risks

- Template drift; rely on `scaf validate` tests.

If not implemented

- Onboarding requires hand-writing `TARGETS`.

---

### PR 11: Tests — e2e scaffold-and-build (lib/bin)

Intent/Impact

- Provide e2e tests that scaffold, export graph, and build via Nix; extend diagnostics to show C++ status.

- Design

- Tests under `tools/tests/cpp/`:
  - `cpp.scaffold-and-build.lib.test.ts`
  - `cpp.scaffold-and-build.bin.test.ts`
  - Validate labels include `lang:cpp` and `kind:*`
  - Validate planner builds derivations and outputs exist

Acceptance criteria

- All tests pass locally and in CI; diagnostics show C++ when enabled.

Risks

- CI toolchain availability; rely on repo toolchain settings and Buck’s C++ toolchain config.

If not implemented

- Gaps can regress silently.

---

## Future work (not in this plan)

- Lockfile-driven ecosystems (e.g., vcpkg/Conan) with providers and labels (optional alongside nixpkgs)
- Cross-platform matrix coverage for different standard libraries

---

## Acceptance and alignment checklist

- Determinism: stable sorts, no ambient FS reads; pure Nix evaluation
- Partial clone grace: existence checks only; no hard failures
- Low cyclomatic complexity: small functions in adapter, planner, templates
- Consistent with build-system-design.md (Buck2 orchestrates, Nix builds)
- One-test-per-file rule adhered to in C++ scaffolds
- Full suite green with coverage

---

## Phase A — nixpkgs foundation (providers + Go cgo)

### PR 1: nixpkgs-backed C++ providers

Intent/Impact

- Use nixpkgs as the canonical source of third-party C++ libraries. Provide a first-class macro and provider wiring to make consumption deterministic and hermetic.

Design

- Labels: introduce `nixpkg:<attrPath>` (e.g., `nixpkg:pkgs.zlib` or `nixpkg:pkgs.openssl`)
- Macro: `nix_cxx_library(name, attr, headers_subdir = null, static = True, shared = False)`
  - Resolves `attr` through the flake inputs (pinned by `flake.lock`)
  - Exposes include path(s) and library outputs; links static by default
  - Emits a provider node stamped with the derivation hash
- Provider generator: extend `tools/buck/providers` with a `cpp-nixpkgs.ts` handler that renders `TARGETS.cpp.auto` entries for `nix_cxx_library` usages (or treat each macro as a self-contained provider rule)
- Auto-map: no graph analysis needed; macros add their provider deps explicitly; `auto_map.bzl` remains unchanged

Acceptance criteria

- Adding a `nix_cxx_library(:zlib)` and depending on it from a C++ target builds and links successfully on all supported platforms
- Derivation pinning via `flake.lock` ensures determinism; changing lock or overlays invalidates the right targets

Risks

- ABI/toolchain alignment: ensure the C++ toolchain used to build nixpkgs libs matches the toolchain used for consumers; document policy (prefer the same Nix toolchain for both)
- Package granularity: some nixpkgs attrs bundle multiple libs; provide `headers_subdir` or wrapper derivations if needed

If not implemented

- Third-party C++ remains ad-hoc; no canonical source; harder to ensure hermetic builds

---

### PR 2: Go cgo integration backed by nixpkgs providers

Intent/Impact

- Allow Go targets to consume nixpkgs C/C++ libraries via cgo in a deterministic, hermetic way, reusing PR 8 providers.

Design

- Macros (`//go/defs.bzl`): add optional attrs
  - `nix_cgo_deps = ["pkgs.openssl", "pkgs.zlib"]`
  - `nix_cgo_pkgconfig = { "pkgs.openssl": "openssl", "pkgs.zlib": "zlib" }` (optional overrides)
- Macro behavior:
  - Stamp as today; set tuple labels to include `cgo:enabled` when `nix_cgo_deps` non-empty
  - Wire deps to the corresponding nixpkgs provider targets from PR 1
- Exporter:
  - Add labels `cgo:enabled` and `nixpkg:<attrPath>` for diagnostics/auto-map (even if macro wires deps explicitly)
- Nix Go templates (`tools/nix/templates/go.nix`):
  - New params: `nixCgoPkgs = []`, `pkgConfigNames = {}`
  - Add `nativeBuildInputs = nixCgoPkgs ++ [ pkgs.pkg-config ]`
  - Set `CGO_ENABLED=1` when `nixCgoPkgs != []`
  - Compose `PKG_CONFIG_PATH` from `*/lib/pkgconfig`; if missing, synthesize `CGO_CFLAGS`/`CGO_LDFLAGS` using include/lib dirs

Acceptance criteria

- A sample Go lib/bin using cgo and `nix_cgo_deps = ["pkgs.zlib"]` builds and links on supported platforms
- Exporter shows `cgo:enabled` and `nixpkg:pkgs.zlib` labels; auto-map or explicit deps cause correct invalidation

Risks

- Toolchain/ABI alignment between cgo and nixpkgs libs; adopt a policy to use a consistent Nix toolchain for C/C++

If not implemented

- Go consumers of native libs remain ad-hoc; less reproducible and harder to reason about

---

## Phase C — In-repo Go↔C interop

### PR 12: Diagnostics wiring

Intent/Impact

- Ensure `langs-diagnose` reports C++ status (manifest, plugin presence) and providers when applicable.

Design

- Update diagnostics to list C++ adapter/plugin presence (auto, via manifest) and show enabled/disabled state with missing paths.

Acceptance criteria

- Diagnostics output lists C++ correctly in sparse and full checkouts.

Risks

- Output verbosity; keep concise with `--json` support.

If not implemented

- Users lack fast visibility into C++ enablement state.

---

## Phase C — In-repo Go↔C interop

### PR 13: Go→C (cgo) to repo C/C++ libraries

Intent/Impact

- Allow Go targets to link against in-repo `nix_cpp_library` (or raw `cxx_library`) outputs, not just nixpkgs deps.

Design

- Extend `nix_go_*` macros with `repo_cgo_deps = [":my_c_lib", "//libs/foo:bar"]`
- Macro wires those deps and sets `CGO_ENABLED=1`
- Nix Go template accepts additional include/lib dirs from these deps via a small JSON sidecar generated by the macro (headers, libs, pkg-config paths)

Acceptance criteria

- A sample Go package with `repo_cgo_deps` builds and runs; minimal test validates function call into the C library

Risks

- Header/layout variance across C libs; rely on explicit include/lib hints in the sidecar

If not implemented

- Go cannot easily consume in-repo C code without bespoke wiring

---

### PR 14: C→Go via c-archive/c-shared

Intent/Impact

- Allow C/C++ binaries or libraries to call into Go code by building Go as c-archive or c-shared, enabling bidirectional interop.

Design

- New macro `nix_go_carchive(name, pkg, exported_headers = ["export.h"])` producing `.a`+header via `go build -buildmode=c-archive`
- Optional `nix_go_cshared` for `.so/.dylib` via `-buildmode=c-shared`
- C++ side links to the produced artifact via standard `cxx_*` rules

Acceptance criteria

- A sample C++ binary calling a Go function (exported via c-archive) links and runs

Risks

- Go toolchain/platform nuances; keep scope to supported platforms and document link flags

If not implemented

- C/C++ cannot reuse Go logic directly; requires RPC or process boundaries instead

---

## Phase D — Overlay-based patching for nixpkgs C++ libs (optional)

### PR 15: Overlay-based patching for nixpkgs C++ libs

Intent/Impact

- Allow local, reproducible patches to nixpkgs C++ libraries without vendoring. Keep CI hermetic.

Design

- Overlays: add `tools/nix/overlays/cpp-patches.nix` and wire it in `flake.nix`
- Patches live under `patches/cpp/*.patch` (flat dir). Use `fetchpatch` or pass patches directly in the overlay for the target attr
- CI guardrails: fail when a dev override env var is set (mirroring Go policy). Local warning only
- Diagnostics: extend `langs-diagnose` to list patched nixpkgs attrs (attr path + patch filenames)
- Provider input stamping (consistency with build-system-design.md):
  - Ensure the provider rule that represents a patched nixpkgs package includes both the patch files under `patches/cpp/*.patch` and the overlay files (e.g., `tools/nix/overlays/*.nix`) as explicit srcs (via a tiny content-addressed stamp rule), so Buck invalidates dependents when any of these inputs change.
  - Treat `flake.lock` as an input to the provider rule (directly or through the Nix evaluation path) to guarantee rebuilds when nixpkgs pins change.
  - Prebuild guard: extend inputs list to include overlay files and `flake.lock`; report stale/missing glue accordingly.

Acceptance criteria

- Adding a patch file and overlaying `pkgs.zlib` changes only the dependent targets; removing the patch returns to the previous state
- Modifying any overlay file or `flake.lock` updates the provider stamp and triggers the correct invalidation; prebuild guard reports these as inputs if glue is stale.

Risks

- Overlay drift across branches; rely on `flake.lock` pinning and review
- Input tracking complexity: keep the provider stamp rule deterministic (sorted file lists) to avoid spurious rebuilds.

If not implemented

- Teams cannot iteratively patch third-party C++ in a hermetic way; resort to vendoring or ad-hoc prebuilts
