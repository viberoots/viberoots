## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 27

This installment follows Part 26. Part 26 tightened importer-scoped wiring, made provider policy explicit, and reduced Node macro bootstrapping drift.

In Part 27 I close the remaining gaps that I still see in the repository today:

- Some Nix-calling Node macros still carry too much “compose the primitives correctly” knowledge in the call sites.
- Go tests still require call sites to remember label stamping. This shows up in synthesized test targets.
- Several macros repeat the same small “pop and normalize” patterns for patch dirs and nixpkgs labels.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Add one shared helper for importer-scoped, Nix-calling genrule macros (dict-safe, workspace-root aware)

### Description

Node has a small set of genrule-style macros that call Nix. The repository already has the right primitives:

- importer-scoped wiring (`prepare_importer_*` helpers)
- global Nix inputs as real action inputs (`wire_global_nix_inputs`)
- Nix command bootstrapping (`//build-tools/lang:nix_shell.bzl`)
- dict-safe attachment helpers (`attach_items_dict_safe`)

The leak is that each Nix-calling macro still has to assemble a correct combination of these primitives. This is easy to drift. It also means that “how to call Nix from an importer-scoped macro” is not a single abstraction boundary in `//build-tools/lang`.

This PR adds one shared helper in `//build-tools/lang` that composes these pieces into one stable surface for importer-scoped, Nix-calling genrule macros. Node macros will use it in PR‑2.

Clarification: I do not need to preserve backwards compatibility yet. This PR can introduce a new helper surface and immediately cut over the macros that use it in later PRs, with no compatibility shims.

### Scope & Changes

- Add a new helper in `//build-tools/lang` (location choice: `//build-tools/lang:importer_wiring.bzl` or `//build-tools/lang:nix_calling_macros.bzl`) that:
  - enforces exactly one importer-scoped lockfile label (`lockfile:<path>#<importer>`)
  - stamps `lang:*` and `kind:*`
  - derives the importer and returns it to the caller
  - attaches importer-local patches as real action inputs into a selected attribute
    - supports both list and dict-shaped inputs
    - preserves deterministic key prefixes for synthetic dict keys
  - realizes provider edges deterministically into a selected attribute
    - supports both list and dict-shaped inputs
  - optionally injects `build-tools/tools/buck/workspace-root.env` into dict-shaped `srcs` maps in a standardized way
  - wires `global_nix_inputs()` into action inputs in a standardized way
    - supports `stamp=True|False` so call sites can opt into observability or keep exporter noise down
- Add one short section to `build-tools/lang/defs_common.bzl` re-exporting the helper, so language macro files do not need to import a new low-level module.

Non-goals in this PR:

- No changes to provider generation behavior.
- No changes to lockfile label semantics.
- No changes to Node command strings. This PR is only wiring.

### Tests (in this PR)

- Add a probe-style Starlark test that exercises the new helper in both shapes:
  - list-shaped `srcs`
  - dict-shaped `srcs`
    The test should assert:
  - importer-local patch files are present as action inputs
  - provider edges are present as action inputs when realized into `srcs`
  - `global_nix_inputs()` are present as action inputs when enabled
  - `build-tools/tools/buck/workspace-root.env` injection is present when enabled
- Add a TypeScript test that asserts the macro surface does not bypass the shared helper:
  - the Node Nix-calling macro file should contain a single call to the shared helper and should not import lower-level wiring modules directly
  - this keeps drift pressure on the helper, not on call sites

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - add a section describing the “importer-scoped, Nix-calling genrule macro” helper and when to use it
  - include a minimal example using dict-shaped `srcs`
- Update `build-tools/docs/abstractions.md`:
  - explicitly list “Nix-calling importer-scoped macros” as a contract and point at the helper surface

### Acceptance Criteria

- There is one shared helper surface in `//build-tools/lang` for importer-scoped macros that call Nix via genrule commands.
- The helper handles list/dict input shapes and does not require call sites to hand-roll workspace-root or global-input wiring.
- Tests prove the helper attaches patch inputs, provider edges, and global Nix inputs deterministically.
- Docs point at the helper as the canonical mechanism.

### Risks

Moderate. These wiring helpers touch dict-safe behavior, which can have subtle failure modes if keys collide or ordering is not stable. The probe tests should assert invariants rather than exact key names beyond a stable prefix.

### Consequence of Not Implementing

We keep bespoke composition logic inside each Nix-calling macro. That encourages copy/paste and makes future bootstrap changes risky.

### Downsides for Implementing

This adds one more helper surface in `//build-tools/lang`. That is acceptable only if it removes duplicated call-site wiring.

### Recommendation

Implement.

---

## PR‑2: Refactor Node Nix-calling macros to use the shared helper and remove remaining bespoke wiring

### Description

After PR‑1, Node Nix-calling macros should not assemble importer wiring, patch inputs, provider edges, and global Nix inputs manually. They should call one shared helper and then focus only on their rule-specific command and outputs.

This PR migrates:

- `build-tools/node/defs_nix.bzl:node_webapp`
- `build-tools/node/defs_nix.bzl:nix_node_cli_bin(bundle=True)`

The goal is to make these macros “thin wrappers” over the shared wiring surface and `//build-tools/lang:nix_shell.bzl` command helpers.

Clarification: I do not need to preserve backwards compatibility yet. This PR can change macro implementation details directly as long as behavior is stable.

### Scope & Changes

- Update `build-tools/node/defs_nix.bzl`:
  - replace direct calls to `prepare_importer_non_genrule_wiring(...)`, `wire_global_nix_inputs(...)`, and ad-hoc `srcs` map injection with a single call to the shared helper from PR‑1
  - ensure both macros still:
    - enforce exactly one lockfile label
    - attach importer-local patch inputs as real action inputs
    - realize provider edges into action inputs (since these are genrule-style rules)
    - include `global_nix_inputs()` as real action inputs (stamp remains `True` for these macros)
    - support workspace-root injection for temp-repo tests
- Keep existing behavior for `nix_node_test` (it uses `stamp=False` intentionally and has different execution semantics).

### Tests (in this PR)

- Extend the existing Node macro tests that assert importer-local patches are action inputs to cover:
  - `node_webapp`
  - `nix_node_cli_bin(bundle=True)`
    This should remain a “wiring test” and should not depend on exact command strings.
- Add or extend a temp-repo scenario test that confirms:
  - the macros can derive workspace root via `build-tools/tools/buck/workspace-root.env` in a sandboxed genrule environment
  - the macro reaches the point where the bootstrapped command would be invoked (no flake-root resolution failures)

### Docs (in this PR)

- Update `docs/handbook/node-macros.md`:
  - document the shared helper as the canonical wiring path for Node macros that call Nix
  - include a short section explaining why `nix_node_test` uses `stamp=False` but still wires global inputs as action inputs
- Update `build-tools/docs/build-system-design.md`:
  - point at the shared helper for “importer-scoped, Nix-calling genrule macros” rather than describing the composition as a macro-specific responsibility

### Acceptance Criteria

- `build-tools/node/defs_nix.bzl` Nix-calling macros do not hand-assemble importer wiring or global input wiring.
- Tests prove patch invalidation and provider wiring are unchanged.
- Temp-repo scenarios still work.
- Docs describe the canonical helper surface.

### Risks

Moderate. Node Nix-calling macros are sensitive to sandbox behavior. The tests must cover the known failure mode: flake root and workspace root resolution in genrules.

### Consequence of Not Implementing

Node macro call sites remain a drift-prone aggregation point for build policy and wiring constraints.

### Downsides for Implementing

Some macro churn. The benefit is lower drift risk and a simpler review surface for new macros.

### Recommendation

Implement.

---

## PR‑3: Centralize Go test label stamping and remove manual stamping from synthesized Go tests

### Description

Go macros already stamp `lang:*` and `kind:*` for libraries and binaries. Go tests are currently different. They rely on call sites to set labels. This shows up as manual label lists for synthesized `*_test` targets in `build-tools/go/defs.bzl`.

This is a cross-language abstraction leak because other languages treat label stamping as a macro responsibility, not a call-site requirement.

This PR makes Go tests follow the same rule: `nix_go_test(...)` stamps its own `lang:go` and `kind:test` labels, and synthesized targets do not need to remember label lists.

Clarification: I do not need to preserve backwards compatibility yet. This PR can tighten the macro behavior as long as exported graph semantics remain stable.

### Scope & Changes

- Update `build-tools/go/defs.bzl:nix_go_test` to call `stamp_labels(kwargs, "go", "test")`.
  - This should dedupe cleanly if the caller already supplied labels.
- Update `build-tools/go/defs.bzl` synthesized `*_test` call sites (auto-wired tests) to stop passing literal `labels = ["lang:go", "kind:test"]`.
- Optional tightening: add a small Starlark probe test that asserts `nix_go_test(...)` always includes `lang:go` and `kind:test` labels even when `labels` is absent or empty.

### Tests (in this PR)

- Add a Starlark probe test that exercises `nix_go_test(...)` label stamping:
  - case 1: no explicit labels passed
  - case 2: explicit labels passed, stamping dedupes correctly
- Extend the exporter-side tests that check for consistent `lang:*` / `kind:*` labeling to include a Go test target created via the auto-wiring path.

### Docs (in this PR)

- Update `build-tools/docs/abstractions.md`:
  - in the “label stamping” contract, clarify that Go tests are stamped by the macro, like other languages
- Update `docs/handbook/adding-language.md`:
  - include Go test stamping as an example of “stamping belongs in the macro, not in call sites”

### Acceptance Criteria

- `nix_go_test(...)` stamps `lang:go` and `kind:test`.
- Auto-wired Go tests no longer manually pass the same label list.
- Tests lock down the behavior.

### Risks

Low. This should only reduce the possibility of missing labels. `stamp_labels(...)` dedupes and should not introduce new labels beyond the intended stamps.

### Consequence of Not Implementing

We keep a small but recurring leak. New synthesized or helper test targets will repeat label lists and can drift.

### Downsides for Implementing

Minimal churn in a macro file. The payoff is reduced drift and fewer call-site responsibilities.

### Recommendation

Implement.

---

## PR‑4: Reduce repeated macro boilerplate for patch dirs and nixpkgs labels across Go and C++

### Description

Go and C++ macros repeatedly implement small “pop and normalize” patterns:

- pop `local_patch_dirs` with a default computed from `default_package_patch_dirs("<lang>")`
- pop `nixpkg_deps` and then call `append_nixpkg_labels(...)`

This duplication is not large, but it is a drift risk. When we change default patch dir policy or nixpkgs label normalization, we should not need to update multiple language macro files.

This PR introduces one small shared helper surface in `//build-tools/lang` and migrates Go and C++ macros to use it. I will keep it narrow to avoid growing a “macro framework”.

### Scope & Changes

- Add a small helper in `//build-tools/lang` (location choice: `//build-tools/lang:defs_common.bzl` or a new `//build-tools/lang:macro_kwargs.bzl`) that:
  - pops `local_patch_dirs` from kwargs with a language default (`default_package_patch_dirs(lang)`)
  - pops `nixpkg_deps` from kwargs as a list of strings (or empty list)
  - optionally appends nixpkg labels via the existing canonical normalizer
- Refactor:
  - `build-tools/go/defs.bzl:nix_go_library` and `nix_go_binary`
  - `build-tools/cpp/defs.bzl:_cpp_common` and the wasm variants
    to use the helper instead of duplicating the same `kwargs.pop(...)` patterns.

Non-goals:

- No changes to patch invalidation model.
- No changes to provider mapping behavior.

### Tests (in this PR)

- Add a Starlark probe test that asserts the helper:
  - returns the same default patch dirs as `default_package_patch_dirs(lang)`
  - preserves caller-provided `local_patch_dirs` when set
  - reads `nixpkg_deps` as a list and ignores non-list shapes deterministically
- Add a probe test that exercises the Go and C++ macros through the helper and asserts:
  - patch inputs are included from the returned patch dirs
  - nixpkg labels are appended as expected

### Docs (in this PR)

- Update `docs/handbook/adding-language.md`:
  - recommend using the helper when implementing package-local patching macros for a new language
- Update `build-tools/docs/abstractions.md`:
  - point macro authors to the helper to avoid duplicating default patch dir handling and nixpkg label appends

### Acceptance Criteria

- Go and C++ macros no longer duplicate `local_patch_dirs` and `nixpkg_deps` pop logic.
- Tests lock down the helper surface and prevent silent drift.
- Docs point macro authors to the shared helper rather than repeating call-site patterns.

### Risks

Low. This is an internal refactor. The main risk is subtle behavior changes when callers pass unexpected types. The helper should preserve current “be tolerant but deterministic” behavior.

### Consequence of Not Implementing

We keep repeated code patterns across languages. That increases review burden and drift risk for small policy changes.

### Downsides for Implementing

One more helper surface. The surface must remain small and avoid becoming a general macro utility library.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain:

1. PR‑1 first. It creates the shared helper for importer-scoped, Nix-calling genrules.
2. PR‑2 next. It migrates Node Nix-calling macros onto the helper and removes bespoke wiring.
3. PR‑3 next. It removes a remaining labeling leak in Go tests and tightens consistency with other languages.
4. PR‑4 last. It is a small DRY refactor across Go and C++ macro boilerplate.

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that asserts the relevant macro or helper contract behavior
- a doc update that points at the canonical helper surface and uses the same terms used by the tests

Backout strategy:

- Each PR is independently revertible.
- If PR‑2 exposes an unhandled sandbox environment edge case, I will keep the helper surface from PR‑1 and revert only the Node macro migrations. Then I will iterate on the helper until the invariant is stable.
