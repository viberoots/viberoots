## Go-backed Node addon e2e test — gaps remediation plan

This plan closes the gaps surfaced by the new e2e test for the scaffolded Go addon. It keeps the architecture minimal and deterministic while aligning with the repository rules and methodology. The core change is to make the Node test builder link the Go c-archive via Nix (not Buck), and to simplify Buck visibility for the Node test by depending on the local copy step.

### Scope and completion criteria

- Scope
  - Update the Node test builder in the flake to correctly link a Go c-archive into the C N-API addon.
  - Adjust the scaffolded Node TARGETS to avoid cross-package visibility issues for Buck tests.
  - Keep exporter/provider flows unchanged. No new provider shapes.
- Completion criteria
  - On a temp scaffolded project created by `scaf new ts go-addon demo`:
    - `nix build .#node-test.libs_demo` succeeds; the test report exists and the Node addon runs `add(2, 3) = 5`.
    - Optional: `buck2 test --target-platforms prelude//platforms:default //projects/libs/demo:unit` succeeds.
  - Full repository suite passes with `i && b && ALL_TESTS=1 v` after direnv loads.

### Gaps diagnosed

- Flake builder path for Node tests did not link the Go c-archive into the C addon, causing a missing header (e.g., `demo-go.h`) at compile time.
- Buck-path Node test (`//projects/libs/<name>:unit`) depended on `//projects/libs/<name>-native:napi_addon` and hit a visibility/config nuance. Even with `visibility = ["PUBLIC"]`, the dependency was rejected in our Buck test environment.

### Design: precise fixes

1. Flake-node test builder composes Go c-archive into the addon (no planner dependency)

- Change the flake’s `makeNodeTest` so that when a sibling native addon package exists (`libs/<name>-native`), it builds the Go c-archive via the Go Nix template and passes it into the addon template as `nixCxxPkgs`.
- This mirrors what the planner (Buck graph → repoGoCArchivesFor) would do, but stays entirely in Nix for the per-importer Node test derivation. No buck graph or planner call is needed for this path.

Code reference (current `makeNodeTest` snippet):

```248:391:build-tools/tools/nix/flake.nix
        makeNodeTest = importerDir: let
          nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          name = builtins.baseNameOf importerDir;
          sanitize = (import ./build-tools/tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
          # Optional: if a sibling native addon package exists at libs/<name>-native,
          # build a Node-API addon derivation and make its artifact available for tests.
          hasNative = builtins.pathExists (./. + ("/" + importerDir + "-native"));
          TAddon = import ./build-tools/tools/nix/templates/cpp-node-addon.nix { inherit pkgs; };
          addonName = name + "_addon";
          addonDrv = if hasNative then TAddon.cppNodeAddon {
            name = sanitize name;
            addonName = sanitize addonName;
            srcRoot = ./.;
            subdir = importerDir + "-native";
            includes = [ "include" ];
          } else null;
          ...
```

- Update the above to import the language templates and build the Go c-archive:
  - `T = import ./build-tools/tools/nix/lang-templates.nix { inherit pkgs; };`
  - Compute `modulesToml = ./libs/${name}-go/gomod2nix.toml` and `subdir = "libs/${name}-go"`.
  - `carchive = T.Go.goCArchive { name = "libs/${name}-go:carchive"; inherit modulesToml; subdir = "libs/${name}-go"; srcRoot = ./.; };`
  - Pass `nixCxxPkgs = [ carchive ]` to `TAddon.cppNodeAddon` and keep `includes = [ "include" ]` (the template already adds `-isystem <drv>/include` and `-L<drv>/lib`).

Acceptance checks

- Building `.#node-test.libs_demo` no longer fails with a missing header (e.g., `demo-go.h`).
- `cpp-node-addon` logs show non-empty `nixInc` and linker flags, inferring the static libraries from the c-archive output.

2. Buck test visibility: make the Node test depend on the local copy, not the native target

- The scaffolded Node test currently depends directly on `//projects/libs/<name>-native:napi_addon`. To avoid cross-package visibility and keep the dependency strictly within the Node package, change it to depend on `:copy_addon`.

Code reference (current template):

```23:28:build-tools/tools/scaffolding/templates/ts/go-addon/libs/{{ name }}/TARGETS.jinja
{% if includeNodeTests -%}
nix_node_test(
    name = "unit",
    deps = ["//projects/libs/{{ name }}-native:napi_addon"],
    lockfile_label = "lockfile:{{ lockfilePath }}#{{ importer }}",
)
{%- endif %}
```

- Update to:
  - `deps = [":copy_addon"]`.
  - Keep the `:copy_addon` rule unchanged: it copies the `.node` file into `native/<addon_name>.node` so the Node loader can require it by stable path.

Acceptance checks

- In a temp run, `buck2 test --target-platforms prelude//platforms:default //projects/libs/demo:unit` succeeds (platform chosen to avoid unspecified config complaints on Go rules).

### Implementation phases and tasks

Phase 1 — Flake builder integration (Go c-archive → addon)

- Task 1.1: Edit `build-tools/tools/nix/flake.nix` in `makeNodeTest`:
  - Import `T = import ./build-tools/tools/nix/lang-templates.nix { inherit pkgs; };`
  - If `hasNative`, build `carchive = T.Go.goCArchive { modulesToml = ./libs/${name}-go/gomod2nix.toml; subdir = "libs/${name}-go"; srcRoot = ./.; name = "libs/${name}-go:carchive"; };`
  - Call `TAddon.cppNodeAddon` with `nixCxxPkgs = [ carchive ]` (keep `includes = [ "include" ]` and existing flags).
- Task 1.2: Ensure Go dependencies are locked for the c-archive:
  - Update the e2e test to run `build-tools/tools/bin/i` (or `zx-wrapper build-tools/tools/dev/install-deps.ts`) after scaffolding so `libs/<name>-go/gomod2nix.toml` is generated/updated before the flake builds.
- Acceptance:
  - `nix build .#node-test.libs_demo` passes in a fresh temp scaffold (macOS and Linux).

Phase 2 — Buck test visibility hardening

- Task 2.1: Update the scaffold template for the Node test deps:
  - In `build-tools/tools/scaffolding/templates/ts/go-addon/libs/{{ name }}/TARGETS.jinja`, change `deps` on `nix_node_test("unit", ...)` from `//projects/libs/<name>-native:napi_addon` to `:copy_addon`.
- Task 2.2: Validate in a temp repo:
  - `buck2 test --target-platforms prelude//platforms:default //projects/libs/demo:unit` runs and passes (optional smoke; flake path remains the main test path).
- Acceptance:
  - No visibility errors when using Buck’s Node test target locally.

E2E test update (build-tools/tools/tests/...)

- Task 3.1: Call `build-tools/tools/bin/i` early in the test to ensure `gomod2nix.toml` for the Go package is present.
- Task 3.2: Keep the e2e test on the Nix flake path (`.#node-test.libs_demo`). The builder now links the Go c-archive, so no external graph/planner calls are needed for this particular flow.
- Task 3.3: Retain coverage plumbing and report checks as currently implemented by the flake builder. Verify junit exists (or a synthesized placeholder is produced as fallback).

### Quality gates and methodology alignment

- Self-documenting, low complexity:
  - The builder logic remains straightforward: detect native sibling → build Go c-archive → pass to addon → copy to stable path.
  - No additional environment toggles or side channels are introduced.
- Determinism:
  - Go modules locked via `gomod2nix.toml`; c-archive composed by Nix from those inputs.
  - Node test uses importer-scoped node_modules derivation; all steps are pure in Nix.
- Boundaries:
  - Buck exporter/provider generation remains separate; the Node test builder does not require the Buck graph.
  - The Buck-based Node test is a separate path and is made robust by depending on the local copy step.

### Risks and mitigations

- Missing or stale `gomod2nix.toml` in the Go package:
  - Mitigation: explicitly run `build-tools/tools/bin/i` in the e2e test and document the requirement for contributors.
- Divergence between Buck and flake outputs:
  - We keep Buck for general orchestration and impact; the flake Node test derivation is a convenience to run hermetic Node tests. Unit tests for planners remain in zx tests to prevent drift.
- Cross-platform cgo variability:
  - The current Go c-archive template already feeds cgo flags and pkg-config env when needed. Validate on macOS and Linux during CI.

### CI and developer workflow

- Developer:
  - `direnv allow`
  - `build-tools/tools/bin/i` (ensures gomod2nix for new Go package)
  - `build-tools/tools/bin/b`
  - `build-tools/tools/bin/v` (full suite); the new e2e test is included.
- CI:
  - No structural changes to stages are required. The Node test builder stays pure and internal to Nix.

### Backout plan

- If linking the c-archive in the flake proves problematic, revert the flake `makeNodeTest` changes and fall back to the planner-selected addon build (graph-generator-selected). This requires exporting the Buck graph first and is more coupled to the Buck graph, but remains an option.

### File-by-file changes checklist

- build-tools/tools/nix/flake.nix
  - In `makeNodeTest`:
    - Import `T = import ./build-tools/tools/nix/lang-templates.nix { inherit pkgs; };`
    - Build `carchive = T.Go.goCArchive {...}` with `modulesToml = ./libs/${name}-go/gomod2nix.toml`, `subdir = "libs/${name}-go"`, `srcRoot = ./.`.
    - Pass `nixCxxPkgs = [ carchive ]` to `TAddon.cppNodeAddon`.
- build-tools/tools/scaffolding/templates/ts/go-addon/libs/{{ name }}/TARGETS.jinja
  - Change `nix_node_test(..., deps = [":copy_addon"], ...)`.
- build-tools/tools/tests/scaffolding/node-go-addon.nix-node-test.pass.test.ts
  - Add an early `build-tools/tools/bin/i` invocation (or `zx-wrapper build-tools/tools/dev/install-deps.ts`) to refresh `gomod2nix.toml` before building the Node test derivation.

### Acceptance

- Temp run (macOS + Linux builders):
  - `scaf new ts go-addon demo --yes`
  - `build-tools/tools/bin/i`
  - `nix build .#node-test.libs_demo` succeeds and produces non-empty `report/`.
  - Node runtime smoke: `node -e "const a=require('./libs/demo/native/demo_addon.node'); if(a.add(2,3)!==5) process.exit(3)"` exits 0.
  - Optional: `buck2 test --target-platforms prelude//platforms:default //projects/libs/demo:unit` succeeds.

This closes the gaps without expanding surface area: the Node flake builder handles cross-language linkage for tests by composing the Go c-archive directly, and Buck visibility friction is avoided for the local Node test by depending on the copy stage within the same package.**_ End Patch _**!
