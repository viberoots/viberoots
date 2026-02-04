# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 31

This installment follows Part 30. Part 30 focused on planner-visible wiring, kind vocabulary enforcement, provider naming hygiene, and patch lint deduplication. In Part 31 I focus on the remaining contract seams that still risk drift now that parity is in place.

The themes in this installment are:

- Make “dev override” environment variable names a single, shared contract across Nix and TypeScript tooling.
- Expand the patch and provider contract surface so it describes the behavior we already rely on (Node global patches, importer effective set policies, lockfile label auto-attach requirements).
- Remove remaining Node-only helper duplication by extracting reusable patch selection and patch key mapping utilities.
- Add targeted parity tests for importer support rules to prevent TS and Starlark from drifting.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Make dev override env names a shared, single source of truth (Nix + TS)

### Description

Dev overrides are a cross-language workflow contract. Today the Nix planner treats env names as data (via `build-tools/tools/nix/planner/overrides.nix`), but several TypeScript call sites still hardcode the env names directly.

That split is a drift surface. It is easy to rename or add an override variable in one place and forget another (patch tooling, startup checks, prebuild notices, tests).

This PR introduces a single source of truth for override env names and refactors both Nix and TypeScript to read from it.

### Scope & Changes

- Add a shared override-env manifest file (data only) that maps language id to env var name.
  - The manifest is intended to be read by both Nix and Node tooling.
- Refactor Nix planner override detection:
  - Replace hardcoded Nix mapping with reading the manifest.
  - Preserve behavior: warn locally (via the existing notice surface), fail in CI.
- Refactor TypeScript call sites to read the manifest:
  - `build-tools/tools/dev/startup-check.ts` warning blocks
  - `build-tools/tools/patch/*` language handlers where override env is passed into shared workflows
  - Any prebuild notice tooling that lists active overrides
- Keep all env var names stable in this PR. The goal is to unify the source, not to rename.

Non-goals in this PR:

- No change to how overrides affect derivations.
- No change to patch directory layouts or provider sync behavior.

### Tests (in this PR)

- Add a focused unit test that asserts:
  - the manifest contains entries for `go`, `cpp`, `python`
  - TypeScript tooling resolves the expected env name for each language
- Add a focused planner-side test that asserts the planner detects overrides using the manifest mapping (log present when enabled, suppressed when `PLANNER_NO_DEV_OVERRIDE_LOG=1`).
- Add a focused patch-tool test that asserts the echoed snippet uses the manifest-derived env name (not a hardcoded string).

### Docs (in this PR)

- Update `abstractions.md`:
  - Document the override env manifest as a contract surface.
  - State the rule: “Do not hardcode override env var names in tooling.”
- Update `docs/handbook/patching.md`:
  - Point to the manifest as the canonical list of override env vars and the “unset before CI” guidance.

### Acceptance Criteria

- Nix planner and TypeScript tooling read override env names from a single source.
- No call sites hardcode `NIX_*_DEV_OVERRIDE_JSON` names.
- Behavior is stable: local warning semantics and CI forbiddance remain unchanged.

### Risks

Low to moderate. The risk is missing a call site and silently changing warning behavior. Tests must cover a representative set of entry points (planner detection, patch snippet output, startup warnings).

### Consequence of Not Implementing

Override env naming remains a drift surface. This becomes more costly as we add more override-aware tooling and CI guards.

### Downsides for Implementing

Some refactor churn, plus one more contract file to maintain. This is acceptable if it prevents future drift.

### Recommendation

Implement.

---

## PR‑2: Expand the patch and provider contract surface to match actual behavior

### Description

We have a patch model contract (`build-tools/tools/lib/lang-contracts.ts` and `lang/lang_contracts.bzl`) that drives tooling messaging and enables consistent reasoning about invalidation. However, it does not fully describe the behavior we already depend on:

- Node uses importer-local patches and can also include a global patch dir when patches match the importer effective set.
- Python provider sync has strict and non-strict parsing modes, which changes failure behavior.
- Importer-scoped lockfile label auto-attach requires kind stamping, which is a real and deliberate constraint.

This PR expands the contract shape to include these policies explicitly and refactors tooling to consult the contract instead of encoding behavior implicitly in multiple places.

### Scope & Changes

- Extend the contract surface:
  - Add explicit provider patch inclusion policy per importer-scoped ecosystem (`all` vs `effective-set-only`).
  - Add optional global patch dir inputs per language (when applicable).
  - Add explicit “lockfile label auto-attach requirements” metadata (for example, requires `kind:*` stamping).
  - Keep the contract small and limited to behaviors we already implement.
- Refactor relevant tooling to use the contract:
  - Provider sync entry points for Node and Python should not restate inclusion policy in comments only.
  - `patch-pkg` usage and one-liners should be derived from the expanded contract so messaging stays accurate as policies evolve.
  - Any lint or diagnostics that explain importer-scoped lockfile label expectations should reference the contract vocabulary.

Non-goals in this PR:

- No change to actual provider sync output, patch layout, or importer selection behavior.
- No change to exporter routing logic.

### Tests (in this PR)

- Add a unit test that asserts contract values for:
  - `node` importer patch inclusion policy is `all` for importer-local patches and supports a global patch dir for effective-set matches.
  - `python` importer patch inclusion policy is `effective-set-only`.
- Add a parity test that compares contract-derived messaging to the `patch-pkg` help text output for at least one package-local and one importer-local language.
- Add a focused test that asserts the exporter lockfile label auto-attach requirement remains “requires kind stamp” (using a minimal simulated node fixture).

### Docs (in this PR)

- Update `abstractions.md`:
  - Document the expanded contract fields and their meaning.
  - Document the Node “global patches” behavior in the same terms used by the contract.
- Update `docs/handbook/provider-sync-cookbook.md`:
  - Describe importer patch inclusion policies using the contract vocabulary.

### Acceptance Criteria

- The contract describes the behaviors we already rely on across Node and Python importer-scoped providers.
- Tooling messaging and diagnostics are derived from the contract, not duplicated per language.
- Provider sync outputs remain stable.

### Risks

Low to moderate. The contract is a public interface between tools. The risk is adding fields that are too vague and then become a dumping ground. Keep the contract explicit and minimal.

### Consequence of Not Implementing

We continue to have “policy as comments” in per-language files and drift risk when behavior changes. The contract remains incomplete and less useful as a debugging and enforcement surface.

### Downsides for Implementing

Some contract churn and import churn. The benefit is fewer implicit assumptions and less repeated policy encoding.

### Recommendation

Implement.

---

## PR‑3: Extract shared “effective set patch selection” utilities and refactor Node provider sync onto them

### Description

Importer-scoped provider sync already uses a shared driver, but Node still carries bespoke logic around:

- building a global `<name>@<version> -> patch path` mapping from a flat patch dir
- merging global patch paths with importer-local patch paths based on the effective set

This PR extracts those utilities into a small shared library so Node provider sync and any future importer-scoped ecosystems reuse the same selection logic and normalization rules.

### Scope & Changes

- Add a small TS helper module under `build-tools/tools/lib/` for:
  - scanning a flat patch dir into a key map suitable for “effective set” selection
  - selecting patch paths for a given importer effective set with stable ordering and dedupe
- Refactor Node provider sync:
  - Replace bespoke “global patch mapping” construction and selection with the shared helper.
  - Preserve behavior exactly, including case normalization and deterministic ordering.
- Keep Python provider sync unchanged, but ensure the new helper is compatible with the driver patterns (in case Python ever gains a global patch dir).

Non-goals in this PR:

- No change to inclusion policy (`all` for importer-local patches, effective-set match for global patches).
- No change to provider naming or output file format.

### Tests (in this PR)

- Add unit tests for the new helper covering:
  - key normalization (case-insensitive mapping)
  - deterministic ordering
  - correct selection when effective set contains keys with different case spellings
- Add a regression test that compares Node provider sync output before and after the refactor on a small fixture (golden output).

### Docs (in this PR)

- Update `abstractions.md`:
  - Identify the canonical module for “effective set patch selection”.
- Update `docs/handbook/provider-sync-cookbook.md`:
  - Add guidance: “Do not hand-roll global patch selection, use the shared helper.”

### Acceptance Criteria

- Node provider sync no longer constructs or selects global patches using bespoke logic.
- Provider sync output remains byte-for-byte stable on the fixture.
- The new helper is narrow and reusable, not a second driver.

### Risks

Low. This is a refactor with behavior locked down by a golden output test.

### Consequence of Not Implementing

Node remains a special case within importer-scoped tooling, increasing drift risk and making future ecosystems harder to implement consistently.

### Downsides for Implementing

Some refactor churn and a new helper surface to maintain. This is acceptable if it removes bespoke logic from Node.

### Recommendation

Implement.

---

## PR‑4: Add importer support parity tests across TS and Starlark (prevent drift)

### Description

Importer support rules are a cross-language contract:

- TypeScript tooling decides whether a lockfile label is supported for provider generation and auto-map.
- Starlark macros enforce lockfile label shape and importer derivation rules.

We already have parity tests for lockfile label parsing and for target label normalization. However, the “supported importer roots” rule is still mostly enforced in TypeScript, with only indirect coverage from higher-level tests.

This PR adds explicit parity tests for importer support rules so changes to importer support cannot drift silently.

### Scope & Changes

- Add a small Starlark probe surface (under `//lang`) that classifies importer labels as supported or unsupported using the macro-side rules.
- Add a TypeScript parity test that:
  - runs the Starlark probe for a matrix of importer labels
  - compares results against `build-tools/tools/lib/importers.ts:isSupportedImporterLabel`
- Keep behavior stable. This PR adds enforcement, not new supported importers.

Non-goals in this PR:

- No expansion of supported importer roots.
- No change to how lockfile labels are constructed or attached.

### Tests (in this PR)

- The TS parity test described above (matrix includes `.`, `apps/foo`, `libs/bar`, and clearly unsupported cases like `build-tools/tools/x`, nested `apps/foo/bar`, and `../apps/x`).
- Add one regression test that verifies the exporter does not auto-attach lockfile labels when the nearest lockfile is under an unsupported importer root.

### Docs (in this PR)

- Update `abstractions.md`:
  - Document supported importer roots as a contract surface and point to the parity test as the guardrail.
- Update `docs/handbook/adding-language.md`:
  - Add a note for importer-scoped ecosystems: “If you change importer support rules, update the parity test matrix.”

### Acceptance Criteria

- Importer support rules are covered by an explicit TS↔Starlark parity test.
- Any future change to supported importer roots requires updating a single, obvious test matrix.

### Risks

Low. The main risk is making the matrix too small and missing a relevant case. Keep it representative and include a couple of path-shape edge cases.

### Consequence of Not Implementing

Importer support rules can drift between TS and Starlark without immediate detection, creating confusing behavior (providers generated but macros reject, or vice versa).

### Downsides for Implementing

One more probe and parity test to maintain. This is acceptable because importer support is a public contract surface.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and by keeping each PR revertible:

1. PR‑1 first. It unifies override env naming as a shared contract and removes hardcoded strings.
2. PR‑2 next. It expands the patch and provider contract so tooling and docs describe real behavior.
3. PR‑3 next. It removes remaining bespoke Node-only patch selection logic by extracting small shared helpers.
4. PR‑4 last. It adds parity enforcement once the contract and tooling surfaces are stabilized.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that asserts the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same terms used by the tests.

Backout strategy:

- PR‑1 can be reverted independently if any override warnings or CI forbiddance behavior changes unexpectedly.
- PR‑2 can be reverted independently if the contract expansion causes confusing tooling messaging. The underlying behavior remains unchanged.
- PR‑3 can be reverted independently if any provider sync output changes occur. Golden tests should prevent this.
- PR‑4 can be reverted independently if parity probes create friction in sparse or sandboxed test environments.
