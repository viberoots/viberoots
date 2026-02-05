## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 18

This installment follows Part 17. It closes the remaining abstraction leaks that show up now that C++, Go, PNPM (Node), and Python are at feature parity.

The intent is to keep the shared seams stable:

- Label contracts and normalizers stay identical across TypeScript, Starlark, and Nix.
- “Importer-scoped ecosystems” remain label-driven (Node + Python), with consistent parsing and error surfaces.
- Macro authoring does not require re-implementing list-vs-dict input handling per language.
- CLI surfaces do not claim capabilities that the underlying Nix/flake implementation does not provide.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Eliminate sanitizer drift in TypeScript callsites (use the canonical sanitize contract everywhere)

### Description

We already define a canonical sanitizer contract in:

- Starlark: `build-tools/lang/sanitize.bzl:sanitize_name`
- Nix: `build-tools/tools/nix/lib/lang-helpers.nix:sanitizeName`

Some TypeScript tooling callsites still re-implement sanitizer logic locally (for example, `build-tools/tools/buck/node-cli-bundle.ts` and `build-tools/tools/dev/build-selected.ts`). This is a drift vector because sanitizer output is part of external interfaces (flake attribute names, output filenames).

### Scope & Changes

- Add a TypeScript sanitizer helper in `build-tools/tools/lib/` (e.g. `build-tools/tools/lib/sanitize.ts`) that implements the exact contract:
  - replace `//` with empty string
  - replace `:` `/` and space with `-`
- Refactor TypeScript callsites to use the helper:
  - `build-tools/tools/buck/node-cli-bundle.ts` (importer attr sanitization)
  - `build-tools/tools/dev/build-selected.ts` (flake attr naming and logging)
  - any other ad-hoc sanitizer implementations found in tooling scripts
- Keep the Starlark and Nix implementations unchanged; this PR is about eliminating TS drift.

### Tests (in this PR)

- Update the existing parity tests to use the TS helper (rather than duplicating `replaceAll(...)` logic inline):
  - `build-tools/tools/tests/lang/sanitize-name.parity.test.ts`
  - `build-tools/tools/tests/cpp/sanitize-name.parity.test.ts`
- Add one more test case that covers a drift-prone input (cell prefix + config suffix) and asserts the sanitizer contract still matches the Starlark probe’s output filename.

### Docs (in this PR)

- Update tooling docs to state:
  - TypeScript must not hand-roll sanitization when the output participates in naming contracts
  - the canonical entrypoint is the new helper in `build-tools/tools/lib/`.

### Acceptance Criteria

- No TypeScript callsite uses a bespoke sanitizer for the canonical `sanitize_name` contract.
- Existing parity tests still pass, and they now validate the shared helper rather than duplicated logic.
- Flake attribute names and bundle lookup behavior remain unchanged (only implementation is consolidated).

### Risks

- If any callsite relied on a subtly different sanitizer, it will now align to the canonical one. That is intended, but it may require updating expectations in a small number of tests.

### Consequence of Not Implementing

- Sanitizer drift remains likely as more tooling is added.

### Downsides for Implementing

- Small refactor plus small test updates.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches TypeScript tooling files and existing parity tests. Safe in tooling slices.

---

## PR‑2: Make importer-scoped lockfile label parsing a single contract (TS ↔ Starlark ↔ Nix parity)

### Description

Importer-scoped lockfile labels (`lockfile:<path>#<importer>`) are the shared contract that drives:

- provider selection (`auto_map.bzl`)
- importer patch wiring (Node/Python macros)
- Node planner importers (flake attributes keyed by importer)

Today:

- TypeScript already has a parser and unit tests: `build-tools/tools/lib/labels.ts:parseLockfileLabel` and `build-tools/tools/tests/lib/labels.parse-lockfile-label.test.ts`.
- Starlark validates lockfile label shape strictly: `build-tools/lang/lockfile_labels.bzl:_parse_importer_scoped_lockfile_label`.
- Nix (Node planner) still does a minimal `splitString "#"` without the same validation surface.

This is a drift vector because small differences (extra `#`, importer mismatch, leading `./`) surface as confusing downstream failures.

### Scope & Changes

- Add a small shared Nix parsing helper in `build-tools/tools/nix/planner/lib.nix` (or a similarly central planner helper) with the same contract as TS/Starlark:
  - input must start with `lockfile:`
  - must contain exactly one `#`
  - both `path` and `importer` must be non-empty
  - normalize lockfile path by stripping leading `./` (match TS behavior)
  - (Node policy) importer must be `.` or equal to `dirname(lockfilePath)`
- Update `build-tools/tools/nix/planner/node.nix` to use the helper:
  - require exactly one `lockfile:` label for Node targets that the planner intends to build
  - if multiple lockfile labels are present, fail with a deterministic error that references the target and the labels
- Keep TS parsing behavior unchanged (it already strips `./`); this PR hardens parity and centralizes Nix behavior.

This PR intentionally does not change provider selection semantics (`auto_map.bzl` remains lockfile + nixpkg only).

### Tests (in this PR)

- Add a parity test `build-tools/tools/tests/labels/lockfile-label.parity.test.ts` that:
  - feeds a table of valid and invalid lockfile labels
  - asserts TS parsing results (or null) match Starlark behavior via `importer_from_labels_probe` (and a new probe that also writes the normalized lockfile path, not only importer)
  - locks down normalization (`lockfile:./projects/apps/web/pnpm-lock.yaml#projects/apps/web` → `projects/apps/web/pnpm-lock.yaml#projects/apps/web`)
- Add a planner regression test that evaluates the Node planner on a tiny synthetic graph:
  - case 1: exactly one lockfile label → importer resolves deterministically
  - case 2: two lockfile labels → evaluation fails with the expected error text

### Docs (in this PR)

- Update the handbook section that defines label shapes to state the canonical contract:
  - exact label form
  - normalization rules (`./` stripping)
  - importer-dir consistency rule
- Add a short note in the “adding language” doc that importer-scoped languages must adopt this exact label parsing contract across TS/Starlark/Nix.

### Acceptance Criteria

- Node planner importer parsing has the same contract as TS/Starlark and fails deterministically on malformed or multiple lockfile labels.
- TS/Starlark/Nix tests prove parity on a representative label matrix (valid, invalid, and normalization cases).
- No behavior change for correctly labeled targets.

### Risks

- If any existing targets carry multiple `lockfile:` labels, this PR will surface them. That is intended, but could require cleanup in the same PR (or a small follow-up).

### Consequence of Not Implementing

- Lockfile label drift remains likely, and future debugging continues to depend on where parsing happens (TS exporter vs Starlark macro vs Nix planner).

### Downsides for Implementing

- One small Nix helper + a new probe rule or probe extension + parity tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `build-tools/tools/lib/labels.ts`, `build-tools/lang/lockfile_labels.bzl`, `build-tools/tools/nix/planner/*`, and narrow tests. Safe in tooling slices that include the exporter/planner.

---

## PR‑3: Remove the Node CLI bundling API leak (make the bundle entry contract explicit)

### Description

The Node CLI bundling flow (Buck macro → bundler script → `nix build ...#node-cli.<importer>`) currently accepts an `entry` parameter at the macro surface and carries it as an input, but the underlying flake implementation bundles a fixed entry (`src/index.ts`) per importer.

This is an abstraction leak because the caller can supply an entry that is ignored by the actual bundle build, and the resulting behavior is non-obvious.

### Scope & Changes

- In `build-tools/node/defs_nix.bzl:nix_node_cli_bin`:
  - in `bundle=False` mode: keep `entry` behavior unchanged (copy a file to `$OUT`)
  - in `bundle=True` mode: enforce the contract explicitly:
    - require `entry` to be unset or equal to the fixed bundle entry (`src/index.ts`)
    - otherwise fail with a clear message explaining the supported bundled entry contract
- In `build-tools/tools/buck/node-cli-bundle.ts`:
  - remove `--entry` (or treat it as a hard error) so the tool surface matches the flake behavior
- In `flake.nix`:
  - keep bundling entry fixed (do not add a new configuration surface in this PR)

This PR does not attempt to generalize the flake to support arbitrary bundle entries. It makes the existing behavior explicit and safe.

### Tests (in this PR)

- Add a regression test under `build-tools/tools/tests/node/bundle/` that:
  - creates a temp importer with a minimal layout and lockfile wiring
  - calls the bundled macro path with a non-default `entry` and asserts it fails with the expected error text
  - calls it with default/unset `entry` and asserts the bundling path proceeds (smoke success)

### Docs (in this PR)

- Update the Node macro handbook section to describe:
  - bundled mode uses a fixed entry (`src/index.ts`) today
  - non-bundled mode supports arbitrary `entry` copying
  - how to migrate if a repo wants multiple CLIs per importer (future work: additional flake attrs per importer)

### Acceptance Criteria

- Passing a custom `entry` while `bundle=True` fails fast with a deterministic error.
- The bundler tool does not advertise unused flags.
- Existing callers using the default behavior are unaffected.

### Risks

- If any existing callers rely on `entry` being silently ignored in bundled mode, this will break them. The fix is to align those targets to the supported bundling contract.

### Consequence of Not Implementing

- The macro surface continues to claim a capability that the build system does not implement.

### Downsides for Implementing

- A small behavior change (fail-fast) plus one regression test and a doc update.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `build-tools/node/defs_nix.bzl`, `build-tools/tools/buck/node-cli-bundle.ts`, and narrow Node tests. Safe in Node-focused slices.

---

## PR‑4: Consolidate “genrule-style wiring” (patch inputs + provider edges) into one shared Starlark helper

### Description

Macros that wrap `genrule`-style rules need to handle two special cases consistently:

- attributes like `srcs` can be list-shaped or dict-shaped
- some wrappers cannot use `deps`, so dependency edges must be realized into `srcs` (or attached as synthetic dict items)

Node implements this logic in `build-tools/node/defs_core.bzl` with custom branching. This is correct but it is a drift vector and makes it easy for future languages to copy-paste a slightly different implementation.

### Scope & Changes

- Add a shared helper in `build-tools/lang/importer_wiring.bzl` (or `build-tools/lang/defs_common.bzl` if preferred) that:
  - takes `(name, kwargs, srcs, deps, lang, MODULE_PROVIDERS, lockfile_label, kind)`
  - enforces `require_single_importer_lockfile_label`
  - stamps `lang:*` and `kind:*`
  - attaches importer-local patch inputs into `srcs` with correct list/dict handling
  - realizes provider edges into `srcs` with correct list/dict handling
  - returns the fully prepared `kwargs` for a `genrule(**kwargs)` call
- Refactor `build-tools/node/defs_core.bzl:nix_node_gen` to delegate to this helper and delete the bespoke branching.

This PR does not change the underlying policies (Node includes importer-local patches as inputs; providers remain metadata-only).

### Tests (in this PR)

- Add a Starlark probe-based test that:
  - exercises the helper in both list-shaped and dict-shaped `srcs` mode
  - asserts:
    - patch inputs were attached (globbed `.patch` paths appear)
    - provider edges are attached under deterministic dict keys when dict-shaped
    - caller-provided dict mappings are preserved unchanged
- Add a regression test to prove `nix_node_gen` behavior is unchanged beyond refactor (output contents and inputs stable).

### Docs (in this PR)

- Update the macro authoring documentation to instruct:
  - for genrule-style macros, use the shared helper rather than re-implementing list/dict logic
  - explain when edges are realized into `srcs` vs `deps` and why.

### Acceptance Criteria

- Node macro code no longer contains bespoke dict-vs-list wiring logic.
- The shared helper is used by Node and is documented as the canonical pattern for future languages.
- Tests prove behavior for both input shapes.

### Risks

- Some existing tests may assert exact `srcs` dict key names. Those tests should be updated to assert semantic equivalence (presence of provider edges) rather than exact key strings when possible.

### Consequence of Not Implementing

- The repo continues to accumulate one-off macro wiring implementations.

### Downsides for Implementing

- Mechanical refactor plus one probe regression test and small doc update.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `build-tools/lang/importer_wiring.bzl`, `build-tools/node/defs_core.bzl`, and narrow Starlark/Node macro tests. Safe in Starlark-only slices.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑1 (TS sanitizer centralization) can land first. It is low-risk and reduces drift before other work.
2. PR‑2 (lockfile label parsing contract parity) next. It hardens the shared importer-scoped seam across TS/Starlark/Nix.
3. PR‑3 (Node CLI bundling leak) after PR‑2, because it benefits from clearer label parsing and sanitizer reuse.
4. PR‑4 (genrule-style wiring helper) can land in parallel with PR‑3, but it is easiest to review after PR‑2 so label semantics are stable.

---

## Verification & Backout Strategy

Each PR should include:

- A focused regression test that fails if the newly tightened contract regresses.
- A callsite-level test whenever macro behavior is refactored (probe tests are preferred for Starlark logic).
- A documentation update that describes the user-visible contract in “what happens” terms.

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests/docs together
  - keep any new tests only if they still reproduce the issue on the prior baseline and remain meaningful.
