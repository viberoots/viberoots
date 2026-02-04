### Local Patching – 3‑PR Delivery Plan (Go/C++ parity with pnpm)

This document lays out three focused PRs to complete Go/C++ local patching and align the experience with pnpm’s importer‑scoped flow. Each PR is small, independently valuable, and includes implementation‑agnostic tests that exercise the system the way a user would (via `patch-pkg`, Buck/Nix, and cquery), not by relying on internal functions.

---

## PR 1 — Go: finalize local patching; remove global plumbing

- Scope
  - Remove global Go provider generation and index:
    - Delete `build-tools/tools/buck/providers/go.ts` and associated generation paths from provider index.
    - Stop mapping Go `module:` labels to providers in auto‑map (keep labels for diagnostics only).
  - Prebuild guard cleanup:
    - Remove enforcement for `third_party/providers/TARGETS.go.auto` and `provider_index.*` (Go).
    - Keep Node/C++ non‑Go guard behavior unchanged.
  - Ensure Go macros + planner + templates are “local patch” complete:
    - Macros include `local_patch_dirs` (already supported).
    - Planner passes the detected patch directories to the Go Nix template (already supported).
    - Go Nix template accepts multiple `patchDirs` and merges deterministically (already supported).
  - Documentation update:
    - Document Go local patching as canonical: `patches/go/*.patch` under the target package.
    - Include filename convention `<importPath with '/' → '__'>@<version>.patch`.

- Acceptance criteria
  - Go builds/tests succeed without any global Go provider or index files.
  - Editing a local Go patch invalidates only the owning target and its reverse deps.
  - No prebuild-guard failures related to Go provider/index files.

- Tests (implementation‑agnostic; user‑flow oriented)
  - Local patch invalidation test:
    - Scaffold a small Go lib/app.
    - Add a patch under `<pkg>/patches/go/…`.
    - Run: `buck2 build //<pkg>:<name>` → success.
    - Modify the patch content; assert only rdeps of `//<pkg>:<name>` appear in `buck2 cquery 'testsof(rdeps(//..., //<pkg>:<name>))'`.
  - Sparse‑checkout friendly test:
    - Create a temp repo subset containing only the Go target directory + minimal shared files.
    - Build the target; verify success with the local patch present.
  - Guard cleanup test (presence only):
    - With a repo containing Go patches but no global Go provider artifacts, run prebuild guard; it should not fail on Go‑specific outputs.

---

## PR 2 — C++: explicit nixpkgs at call sites; planner pass‑through; drop provider reliance

- Scope
  - Extend `nix_cpp_*` macros to accept `nixpkg_deps` (e.g., `["pkgs.zlib", "pkgs.openssl"]`) and stamp `nixpkg:<attr>` labels.
  - Planner (`build-tools/tools/nix/planner/cpp.nix`) uses stamped `nixpkg:` labels (already supported) to pass `nixCxxAttrs` to `build-tools/tools/nix/templates/cpp.nix`.
  - `build-tools/tools/nix/templates/cpp.nix` already consumes `nixCxxAttrs` to produce include/lib flags; validate and keep deterministic ordering.
  - Reduce reliance on C++ provider auto‑map for `nixpkg:` propagation:
    - No need to attach provider deps at call sites just to reflect `nixpkg:` labels.
    - Keep existing provider mapping only if required for legacy sample targets; de‑emphasize in docs.
  - Documentation update:
    - Show call‑site pattern with `nixpkg_deps` and local patches under `patches/cpp/*.patch`.

- Acceptance criteria
  - Adding `nixpkg_deps` at a `nix_cpp_*` call site results in correct headers/libs being used (deterministically) by `cpp.nix`.
  - Builds/tests do not depend on provider auto‑map for propagating `nixpkg:` to the planner.
  - Local C++ patches applied via Buck `srcs` → planner → `cpp.nix` are honored.

- Tests (implementation‑agnostic; user‑flow oriented)
  - Call‑site attrs test:
    - Scaffold a C++ lib/app that uses zlib symbols.
    - In `TARGETS`, add `nixpkg_deps = ["pkgs.zlib"]`.
    - Build: `buck2 build //<pkg>:<name>` → success; verify binary links (e.g., presence of `-lz` in a captured build log or successful use).
  - Local patch application test:
    - Add `<pkg>/patches/cpp/fix.patch` modifying a source line in `src/…`.
    - Build before/after; assert the output reflects the change (e.g., changed string or behavior).
  - Minimal invalidation test:
    - Tweak the patch; verify only reverse deps of the patched target are affected by `cquery testsof(rdeps(…))`.

---

## PR 3 — Remove global C++ overlay/provider artifacts; align patch‑pkg & scaffolds; end‑to‑end tests

- Scope
  - Remove (or gate off) the global overlay scanner for `patches/cpp/**`:
    - Stop scanning `patches/cpp/**` to patch nixpkgs globally in `build-tools/tools/nix/overlays/cpp-patches.nix` for the main build path.
    - If needed for niche flows, keep a documented, opt‑in overlay separate from the default local‑patch path.
  - Prebuild guard cleanup:
    - Drop checks that indirectly depended on global C++ patch overlay/provider artifacts.
  - `patch-pkg` updates (Go/C++):
    - Default to local mode; `start/apply` writes to `<pkg>/patches/<lang>`.
    - No provider sync step for Go/C++; a rebuild suffices.
    - Keep Node’s importer‑scoped flow unchanged.
  - Scaffolding & docs:
    - Ensure new Go/C++ scaffolds create `patches/<lang>/` and include commented examples.
    - Update handbook to reflect local patching as canonical for Go/C++.
  - Add e2e invalidation + sparse‑checkout tests covering both languages.

- Acceptance criteria
  - No global C++ overlay/provider artifacts are required to build/test local‑patch projects.
  - `patch-pkg start/apply` for Go/C++ writes patches locally; rebuild consumes them; invalidation is precise.
  - Sparse‑checkout flows work (target dir + essentials only).

- Tests (implementation‑agnostic; user‑flow oriented)
  - patch‑pkg round‑trip tests (Go and C++):
    - Create a scaffold; run:
      - `patch-pkg start <lang> --target //<pkg>:<name> <module-or-attr>`
      - Edit in the temp workspace; `patch-pkg apply …`
      - Build: `buck2 build //<pkg>:<name>` → success; assert the visible effect (string change, log, or symbol used).
    - Re‑apply the same patch: idempotent; no rebuild churn outside reverse deps.
  - Sparse‑checkout e2e test:
    - Copy only `//<pkg>` directory (+ minimal shared files) into a temp repo.
    - Build/test; ensure success with local patches present.
  - Invalidation e2e test:
    - Introduce a downstream target depending on the patched target.
    - Modify patch; compute `buck2 cquery 'testsof(rdeps(//..., //<pkg>:<name>))'` and assert the affected set matches expectation.

---

## General testing guidance (keeps tests implementation‑agnostic)

- Interact only via public surfaces:
  - `patch-pkg` CLI for patch workflows.
  - `buck2 build/test/cquery` for builds, tests, and impact analysis.
  - Nix builds invoked by macros/runners (where applicable).
- Avoid coupling to internal modules; assert outcomes users care about:
  - Artifacts build and run.
  - Behavior reflects patch edits.
  - Impacted sets (via `cquery`) change precisely when patches change.
  - No reliance on global provider/index files for Go/C++.
- For timing‑sensitive operations, use an external timeout wrapper (consistent with project conventions).

---

## Rollback and safety

- Each PR is independently revertible.
- Keep commit strata small; ensure the suite and zx tests are green after each commit.
- If optional overlays are retained for niche C++ flows, gate them behind explicit opt‑in with clear docs.
