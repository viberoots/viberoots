## Linking Plan - Phase 3 (Python extension modules: in-repo, planner-built runtimes)

This document is a development plan to implement **Phase 3** from `linking-roadmap.md`.

I am keeping the plan as a list of PRs. Each PR includes its own tests and documentation updates. I am not planning any tests-only or docs-only PRs. No functionality should land without tests in the same PR.

## Prerequisites (must already be true from Phases 0, 1, and 2)

Phase 3 assumes the shared and native primitives are already available and verified:

- deterministic union at the macro layer (`deps := deps ∪ link_deps ∪ header_deps`) and override validation
- planner-level deterministic link closure resolver exists (`link_closure = direct|transitive`, optional per-dep overrides)
- exporter surface includes the intent attributes (`link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`)
- `nix_cpp_headers` exists and planners can materialize `kind:headers` via `T.cppHeaders`
- C++ native in-repo linking works (planner materializes `T.cppLib` for C++ consumers) so Python extensions can reuse the same producer shape
- Wasm linking semantics are already in place, so Phase 3 can be explicit about the boundary: Python native extensions are not supported for Python WASM backends

If any of these are missing, I should address the missing Phase 0/1/2 item first rather than trying to patch around it inside Phase 3.

---

## PR-1: Add `nix_python_extension_module` macro (importer-scoped) and lock down the exported node contract (`kind:pyext`)

### Description

Phase 3 introduces a new in-repo producer: a CPython extension module built from C/C++ sources and imported from Python at runtime.

This PR focuses on the Buck surface and the exported-graph contract:

- an importer-scoped macro (`nix_python_extension_module`) with lockfile label validation consistent with other Python targets
- a planner-visible kind (`kind:pyext`) stamped as `lang:python`
- an exported node surface that includes the fields the Python planner and `T.pyExt` will need (notably `module`, plus link intent attrs)

This PR does not yet build a working native module. That comes in PR-2 when the template and planner wiring exist.

### Scope & Changes

- Add `nix_python_extension_module` to `build-tools/python/defs.bzl`:
  - enforce importer-scoped lockfile label conventions (consistent with other Python macros)
  - accept required attrs:
    - `module` (import name, e.g. `"mypkg._native"`)
    - `srcs` and optional `headers`
    - `deps`, `nixpkg_deps`, `cflags`, `ldflags`
  - accept link intent attrs (default values consistent with shared primitives):
    - `link_deps` (default `[]`)
    - `header_deps` (default `[]`)
    - `link_closure` (default `"direct"`)
    - `link_closure_overrides` (default `{}` or `None`, consistent with Phase 0)
  - compute `deps := deps ∪ link_deps ∪ header_deps` using the shared helper and preserve the intent attrs on the rule so they appear in the exported graph
- Add `kind:pyext` stamping and ensure the node shape is planner-visible:
  - `labels` must include `lang:python` and `kind:pyext`
  - node must export `module` as a string
- Extend the exporter surface if needed so `build-tools/tools/buck/graph.json` includes `module` for `kind:pyext` nodes.
  - If the exporter already carries unknown attrs through for this rule shape, keep the change minimal and only add `module` if it is missing.

### Tests (in this PR)

Add zx tests (one test per file):

- `build-tools/tools/tests/python/python.pyext.macro.enforces.lockfile-label.test.ts`
  - temp repo defines a `nix_python_extension_module` with an invalid or missing `lockfile_label`
  - asserts the failure is fast and targeted (macro-level error)
- `build-tools/tools/tests/python/python.pyext.attrs.exported-by-graph.test.ts`
  - temp repo defines a `nix_python_extension_module` with:
    - `module`
    - `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides`
  - runs `build-tools/tools/buck/export-graph.ts`
  - asserts the node in `build-tools/tools/buck/graph.json` includes:
    - `labels` (`lang:python`, `kind:pyext`)
    - `module`
    - the link intent attrs
- `build-tools/tools/tests/python/python.pyext.deps-union.deterministic.cquery.test.ts`
  - temp repo defines a `nix_python_extension_module` where `deps`, `link_deps`, and `header_deps` overlap
  - asserts cquery sees `deps` as the deterministic union

### Docs (in this PR)

- Update `build-tools/docs/python-extension-design.md`:
  - document the macro signature and defaults as implemented
  - document the required exported-graph fields for `kind:pyext` (especially `module` and the link intent attrs)

### Acceptance Criteria

- `nix_python_extension_module` exists, is importer-scoped, and stamps `lang:python`, `kind:pyext`.
- `deps := deps ∪ link_deps ∪ header_deps` is deterministic and locked by test.
- `build-tools/tools/buck/graph.json` contains `module` and link intent attrs for a `kind:pyext` node that sets them.
- Documentation describes the macro and exported-graph contract in one place.

### Risks

Low to medium. This introduces a new macro surface and a new node kind, and it depends on exporter behavior for a new rule shape.

### Consequence of Not Implementing

The Python planner cannot observe or reason about in-repo native extension modules in a deterministic way, and later template work will not have a stable node contract.

### Downsides for Implementing

Adds a new public macro surface that must remain stable. The benefit is a clear, explicit contract instead of ad hoc patterns.

### Recommendation

Implement.

---

## PR-2: Implement `T.pyExt` and wire `kind:pyext` into Python planner and `pyApp`/`pyLib` overlays

### Description

This PR makes Phase 3 “work” at the primary user level:

- an extension module can be built as a derivation that produces `$out/site/<module path>${EXT_SUFFIX}`
- a planner-built Python app or library can depend on that module, and the resulting runtime can import it

This PR focuses on artifact shape and runtime composition. It does not yet implement in-repo native linking via `link_deps`. That comes in PR-3.

### Scope & Changes

- Add a new Nix template `T.pyExt` (canonical surface under `build-tools/tools/nix/templates/`):
  - compile and link the extension from `srcs`
  - output contract:
    - `$out/site/<module path>${EXT_SUFFIX}`
  - compute `EXT_SUFFIX` from the interpreter used at runtime (do not hardcode)
- Extend Python planner (`build-tools/tools/nix/planner/python.nix`):
  - recognize `kind:pyext`
  - instantiate `T.pyExt` for `kind:pyext` nodes
  - when planning `pyApp` / `pyLib` nodes:
    - collect direct `kind:pyext` deps
    - pass them as `nativeModuleOverlays` (or the equivalent template input) to the Python templates
- Extend Python templates and adapter wiring (`build-tools/tools/nix/templates/python.nix` and uv adapter integration) so `pyApp` and `pyLib` can merge extension overlays:
  - copy each overlay’s `$out/site/**` into the final `$out/site/**` deterministically
  - keep ordering deterministic and stable (do not rely on filesystem traversal order)

### Tests (in this PR)

Add zx integration tests (one test per file). These should validate runtime behavior by actually importing the module from the planner-built output.

- `build-tools/tools/tests/python/python.pyext.imported-by-pyapp.build-and-run.test.ts`
  - temp repo defines:
    - `nix_python_extension_module` implementing a minimal module with one function (C or C++)
    - `nix_python_binary` that imports the module and calls the function
  - builds the Python binary via the normal planner-selected path
  - runs the produced wrapper and asserts output is correct
- `build-tools/tools/tests/python/python.pyext.imported-by-pylib.runtime-import.test.ts`
  - temp repo defines:
    - `nix_python_extension_module`
    - `nix_python_library` that depends on it
    - a minimal `nix_python_binary` that depends on the library and imports through it
  - asserts the composed runtime can import the extension module successfully

### Docs (in this PR)

- Update `build-tools/docs/python-extension-design.md`:
  - document `T.pyExt` output contract (`$out/site/...${EXT_SUFFIX}`)
  - document the overlay mechanism used by `pyApp`/`pyLib` to include native modules

### Acceptance Criteria

- `T.pyExt` exists and produces a native module under `$out/site/<module path>${EXT_SUFFIX}`.
- A planner-built Python app can import and execute the extension module.
- A planner-built Python library that depends on an extension module is importable in a downstream app.
- Overlay composition is deterministic and covered by tests.

### Risks

Medium. CPython extension build details are platform-sensitive (Darwin/Linux), and runtime composition needs to be correct to avoid fragile `PYTHONPATH` behavior.

### Consequence of Not Implementing

Phase 3 would define a macro and graph shape but still not produce a usable runtime artifact for Python apps/libs.

### Downsides for Implementing

Adds a new template and planner kind and requires ongoing maintenance as Python templates evolve.

### Recommendation

Implement.

---

## PR-3: Build-time Python deps for `T.pyExt` via the uv wheelhouse environment (lockfile + patches)

### Description

Many real-world extension modules need Python packages at build time (headers from `numpy`, `pybind11`, etc).

This PR makes that deterministic by reusing the existing uv-driven Python environment machinery (wheelhouse keyed by `uv.lock` + patches) as an input to extension builds.

This PR is about build-time Python deps only. It does not add in-repo native linking via `link_deps` yet.

### Scope & Changes

- Extend the Python templates/uv adapter wiring to expose a stable “wheelhouse env” for build-time use:
  - reuse the existing wheelhouse derivation contract (as described in `build-tools/docs/python-extension-design.md`)
  - ensure it is keyed only by importer inputs (lockfile + patches + global Nix inputs), not by extension sources
- Extend `T.pyExt` to optionally build inside (or against) that wheelhouse environment:
  - provide a stable way for extension builds to locate Python package headers that come from the lockfile (for example `pybind11` include dirs)
  - keep behavior deterministic and hermetic (no network, no ambient user site-packages)
- Extend the Python planner (`build-tools/tools/nix/planner/python.nix`) for `kind:pyext` nodes to pass the wheelhouse env input derived from the importer boundary.

### Tests (in this PR)

Add zx integration tests (one test per file). These should validate that build-time Python deps are available deterministically from the lockfile environment.

- `build-tools/tools/tests/python/python.pyext.build-time-python-deps.from-lockfile.builds.test.ts`
  - temp repo defines:
    - a Python importer lockfile that includes a header-providing package (for example `pybind11` or a minimal package the repo already uses for this purpose)
    - a `nix_python_extension_module` that includes a header from that package at compile time
  - builds the extension module and asserts it succeeds
- `build-tools/tools/tests/python/python.pyext.build-time-python-deps.deterministic-across-builds.test.ts`
  - temp repo builds the same extension twice and asserts the wheelhouse/env input used by the extension is stable (using existing “build log” or input-fingerprint harness patterns)

### Docs (in this PR)

- Update `build-tools/docs/python-extension-design.md`:
  - document the build-time Python deps contract:
    - how `T.pyExt` obtains build-time Python package headers from the importer lockfile
    - determinism rules and what inputs key the wheelhouse/env

### Acceptance Criteria

- A Python extension module can build while consuming headers provided by a Python package from the importer lockfile environment.
- The build-time Python deps input is deterministic and keyed by importer inputs (lockfile + patches).
- Documentation matches the tested behavior.

### Risks

Medium. Build-time Python deps can be subtle because it is easy to accidentally rely on ambient Python state. The tests must ensure the build input comes from the wheelhouse/env, not from the user machine.

### Consequence of Not Implementing

Extension modules that depend on Python-package-provided headers will be forced into ad hoc, non-deterministic include path hacks or additional manual nixpkgs wiring.

### Downsides for Implementing

Adds template/planner wiring complexity, but it reuses existing uv2nix wheelhouse machinery instead of inventing a new Python environment model for extension builds.

### Recommendation

Implement.

---

## PR-4: Add in-repo native linking for Python extensions via `link_deps`/`header_deps` (direct + transitive closure)

### Description

Phase 3 should allow extension modules to link in-repo native code explicitly, using the same intent model as native C++ and Wasm linking:

- `link_deps` expresses link intent
- `header_deps` expresses include intent
- `link_closure` controls whether closure is direct or transitive (following `link_deps` on producers)

This PR teaches the Python planner and `T.pyExt` how to materialize link inputs for supported producers and fails fast on unsupported targets.

### Scope & Changes

- Extend the Python planner (`build-tools/tools/nix/planner/python.nix`) `kind:pyext` construction:
  - read `link_deps`, `header_deps`, `link_closure`, `link_closure_overrides` from the exported node
  - compute a resolved ordered unique list using the shared closure resolver (`build-tools/tools/nix/planner/link-closure.nix`)
    - roots are the consumer’s `link_deps`
    - traversal follows `link_deps` on producer nodes
  - validate each resolved dep is a supported native producer for Phase 3:
    - C++ native libraries (`lang:cpp`, `kind:lib` or the repo’s canonical C++ producer stamps)
    - header-only deps (`lang:cpp`, `kind:headers`) for `header_deps`
    - optional: Go c-archives, if the existing repo surface (`T.goCArchive`) is stable and already used by C++ consumers
  - materialize Nix inputs:
    - C++ libs via `T.cppLib`
    - header-only deps via `T.cppHeaders`
    - optional: Go c-archives via `T.goCArchive`
- Extend `T.pyExt` to accept repo-provided native link inputs:
  - accept a list of link packages (analogous to `nixCxxPkgs`) and include roots derived from `T.cppHeaders`
  - keep ordering deterministic and stable (reflect resolved closure order)
- Add targeted error messages:
  - unsupported label in `link_deps`
  - invalid closure mode
  - variant mismatches where applicable (for example: reject Wasm producers as link deps for native CPython extensions)

### Tests (in this PR)

Add zx integration tests (one test per file). These should validate real symbol resolution by calling into a symbol implemented in the linked library.

- `build-tools/tools/tests/python/python.pyext.links-cpp-lib.via-link-deps.build-and-run.test.ts`
  - temp repo defines:
    - `nix_cpp_library` exporting a function (e.g. `int add(int,int)`)
    - `nix_python_extension_module` that links it via `link_deps` and exposes a Python-callable wrapper
    - a Python binary that imports the module and asserts the function returns the expected value
- `build-tools/tools/tests/python/python.pyext.transitive-closure.follows-link-deps.build-and-run.test.ts`
  - temp repo defines:
    - C++ lib `core` with `link_deps=["//libs/support:support"]` and uses a symbol from `support`
    - extension module links only `core` with `link_closure="transitive"`
    - runtime asserts success (import + function call)
- `build-tools/tools/tests/python/python.pyext.link-deps.unsupported-target.fails-fast.test.ts`
  - temp repo places a non-native producer target in `link_deps`
  - asserts the error message is targeted and names the expected stamps

### Docs (in this PR)

- Update `build-tools/docs/python-extension-design.md`:
  - document the linking model as implemented:
    - how `link_deps` and `header_deps` are interpreted
    - direct vs transitive closure
    - what producers are supported for linking
  - document the intended error shape for unsupported deps

### Acceptance Criteria

- A Python extension module can link an in-repo C++ library via `link_deps` and prove it by calling into it at runtime.
- `link_closure="transitive"` follows `link_deps` on producers recursively and succeeds when a transitive link requirement exists.
- Unsupported `link_deps` entries fail fast with an actionable error message.
- Documentation matches the tested behavior.

### Risks

Medium. This touches planner logic and cross-language linking boundaries, and link ordering issues can produce non-obvious failures.

### Consequence of Not Implementing

Extensions remain limited to `nixpkg_deps` and cannot link in-repo native code explicitly, which blocks adoption for mixed Python/C++ repos.

### Downsides for Implementing

Adds planner complexity, but concentrates it in one place and reuses the shared closure resolver rather than inventing a new model.

### Recommendation

Implement.

---

## PR-5: Hardening for Phase 3 invariants (determinism, invalidation, and backend boundaries)

### Description

After Phase 3 works, this PR locks down the invariants that keep it stable:

- deterministic ordering of overlay merges and link inputs
- invalidation when in-repo native dependencies change (including patch changes)
- clear boundaries around unsupported backends (Python WASM targets remain “pure Python only”)

### Scope & Changes

- Determinism hardening:
  - ensure the resolved native link closure list is stable and unique
  - ensure `nativeModuleOverlays` merge order is stable
  - ensure `T.pyExt` consumes link inputs in a stable order
- Invalidation hardening:
  - ensure changes to a linked in-repo native producer’s patch surface invalidate the Python extension and downstream Python app/lib that imports it
  - ensure the invalidation edge is visible in the graph surface used by the planner (avoid hidden dependencies)
- Backend boundary enforcement:
  - if a Python WASM backend is selected, fail fast when `kind:pyext` is in the dependency closure, with a targeted error explaining the limitation

### Tests (in this PR)

Add zx tests (one test per file):

- `build-tools/tools/tests/python/python.pyext.link-input-ordering.deterministic.test.ts`
  - temp repo with multiple in-repo link deps and a fixed expected resolved order
  - runs multiple builds and asserts ordering is stable
- `build-tools/tools/tests/python/python.pyext.patch-invalidation.rebuilds-consumers.test.ts`
  - temp repo:
    - Python app imports extension module
    - extension links an in-repo C++ lib
    - modify a `.patch` file under the C++ producer’s patch surface
  - asserts the Python app rebuilds (using existing invalidation harness patterns)
- `build-tools/tools/tests/python/python.pyext.rejected-by-wasm-backend.fails-fast.test.ts`
  - temp repo selects a Python WASM backend and depends on `kind:pyext`
  - asserts the failure message is targeted and names the unsupported combination

### Docs (in this PR)

- Update `build-tools/docs/python-extension-design.md`:
  - document determinism rules for Phase 3 ordering
  - document invalidation guarantees at a high level
  - document the backend boundary for Python WASM targets and the expected error

### Acceptance Criteria

- Ordering is deterministic and locked by tests.
- Patch invalidation is accurate for Phase 3 end-to-end (producer change rebuilds importer runtime).
- Unsupported backend combinations fail fast with actionable error messages.
- Documentation matches the tested behavior.

### Risks

Low to medium. This is mostly hardening, but it may expose missing dependency edges or nondeterministic behavior in existing templates.

### Consequence of Not Implementing

Phase 3 could work on a happy path but remain fragile, with nondeterminism or hidden invalidation gaps that appear later as the repo grows.

### Downsides for Implementing

Adds integration tests that exercise cross-language edges and invalidation, which increases test runtime. The benefit is stable semantics.

### Recommendation

Implement.

---
