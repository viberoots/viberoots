## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 19

This installment follows Part 18. It turns the remaining “works in most cases” seams into explicit contracts, and removes the last few places where a label can be considered valid by one layer but cannot be satisfied by another layer.

The intent is to keep the shared seams stable:

- Label contracts and normalizers stay identical across TypeScript, Starlark, and Nix.
- Importer-scoped ecosystems remain label-driven (Node + Python), with one supported importer set and consistent parsing and error surfaces.
- Provider generation and auto-mapping never emit references to providers that are impossible to generate.
- Node/Python patch inclusion policies remain intentional and documented, not accidental behavior.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Close the importer-scoped lockfile label contract hole (`#.` only allowed for repo-root lockfiles)

### Description

Today, `lockfile:<path>#<importer>` parsing accepts `#.` as an importer suffix even when the lockfile is not at repo root. This is permissive, but it is a drift vector because it creates “valid” labels that do not match how the rest of the system reasons about importers.

We should tighten the shared contract:

- `importer == "."` is valid only when `dirname(lockfilePath) == "."` (repo-root lockfiles).
- Otherwise, `importer` must equal `dirname(lockfilePath)` (POSIX semantics).

This hardens the importer-dir consistency rule and prevents a class of labels that are easy to stamp accidentally but are ambiguous or non-actionable downstream.

### Scope & Changes

- Update the Starlark validator in `lang/lockfile_labels.bzl`:
  - allow `#.` only when the lockfile path is at repo root
  - otherwise require `#<dirname(lockfilePath)>`
  - keep `./` stripping normalization unchanged
- Update the TypeScript parser in `tools/lib/labels.ts` to match the same rule.
- Update any callers that rely on the old permissive behavior (expected to be rare).
- If Nix planner code parses lockfile labels (directly or indirectly), centralize parsing in a tiny helper and apply the same rule so Nix error text matches TS/Starlark.

### Tests (in this PR)

- Update `tools/tests/lib/labels.parse-lockfile-label.test.ts`:
  - add a regression case asserting `lockfile:apps/web/pnpm-lock.yaml#.` is rejected
  - keep existing valid root lockfile case `lockfile:pnpm-lock.yaml#.` passing
- Update `tools/tests/labels/lockfile-label.parity.test.ts`:
  - add a parity case for the now-invalid `lockfile:apps/web/pnpm-lock.yaml#.` label and assert both TS and Starlark reject it
  - keep normalization (`lockfile:./apps/web/...`) coverage intact
- Add a small planner regression (if applicable) to ensure the Nix-side parser fails deterministically on the same invalid label.

### Docs (in this PR)

- Update the handbook section defining lockfile labels to state the tightened rule:
  - `#.` is only for repo-root lockfiles
  - non-root lockfiles must use `#<dirname(lockfilePath)>`
  - `./` stripping normalization is part of the contract

### Acceptance Criteria

- TS and Starlark agree on the lockfile label validity matrix, including the new `#.` restriction.
- The parity test suite proves TS ↔ Starlark behavior matches for valid/invalid/normalized labels.
- No behavior change for correctly labeled targets.

### Risks

- If any targets were manually stamped with `#.` for non-root lockfiles, this PR will surface them. That is intended and should be fixed in the same PR (or a small follow-up if the cleanup is large).

### Consequence of Not Implementing

- A permissive contract remains, and future tooling will continue to accept labels that are ambiguous and hard to reason about.

### Downsides for Implementing

- Small contract hardening plus updating a few tests and potentially a few callsites.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `lang/lockfile_labels.bzl`, `tools/lib/labels.ts`, and narrow tests. Safe in tooling slices.

---

## PR‑2: Align provider generation with the lockfile-label contract (support root importers explicitly, avoid impossible provider mappings)

### Description

The system currently has a structural footgun: it is possible for a target to carry a valid lockfile label, for `auto_map.bzl` to map that label to a provider, and for provider sync to never generate that provider because it filters lockfiles/importers differently.

This PR makes provider generation and auto-map wiring satisfy the same set of supported importer labels, and explicitly decides what “root importer” means for importer-scoped ecosystems.

### Scope & Changes

- Introduce one shared “supported importer label” policy on the TypeScript side (used by provider sync and provider index generation):
  - allow importer `"."` (repo-root lockfile importers)
  - allow importers under `apps/*` and `libs/*`
  - reject everything else
- Update `tools/lib/provider-sync-driver.ts` to:
  - stop pre-filtering lockfiles to only `apps/*` or `libs/*`
  - instead, rely on the shared supported-importer predicate on the importer label(s) returned by parsers
  - ensure we never emit mappings for providers we will not generate
- Update provider index generation (Node/Python) to apply the same supported-importer policy.
- Ensure `tools/buck/gen-auto-map.ts` continues to map lockfile labels and nixpkg labels, but add a targeted check (warn or fail depending on existing conventions) if a lockfile label parses successfully but the corresponding provider is not expected to be generated under the supported-importer policy.

### Tests (in this PR)

- Add a focused test that exercises a root lockfile label end-to-end:
  - ensure a graph node labeled `lockfile:pnpm-lock.yaml#.` maps to a provider label
  - ensure provider sync emits the corresponding `lf_*` provider target when a root lockfile exists
- Add a regression test ensuring unsupported importer labels do not generate providers or auto-map entries (for example, `lockfile:third_party/pnpm-lock.yaml#third_party`).
- Keep Node and Python behaviors locked down independently:
  - Node: provider includes all importer-local patches (unchanged)
  - Python: provider filters patches by `uv.lock` effective set (unchanged)

### Docs (in this PR)

- Update the “importer-scoped ecosystems” doc section:
  - explicitly list supported importer labels: `"."`, `apps/*`, `libs/*`
  - describe what root importer `"."` means, and when it is expected to exist
  - describe that auto-map mappings are only meaningful when provider sync can generate providers for the same importer set

### Acceptance Criteria

- For any supported importer label, `auto_map.bzl` never references a provider that provider sync cannot generate.
- Root lockfile labels are either supported end-to-end or rejected end-to-end. This PR makes the behavior explicit and tested.
- Existing Node/Python patch inclusion policies remain unchanged.

### Risks

- If there are existing lockfiles outside `apps/*` and `libs/*` that should participate, this PR will require an explicit policy decision (expand supported importers or keep them excluded).

### Consequence of Not Implementing

- The system continues to allow “valid labels” that can map to “non-existent providers”, making failures dependent on where the label is interpreted.

### Downsides for Implementing

- Small refactor in the provider sync driver plus a couple of focused regression tests.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/lib/provider-sync-driver.ts`, provider index helpers, and narrow tests. Safe in tooling slices.

---

## PR‑3: Centralize Node “synthetic lockfile discovery” policy (remove bespoke scanning from provider sync)

### Description

Node provider sync currently embeds a policy that, when an importer under `apps/*` or `libs/*` has `package.json` but no `pnpm-lock.yaml`, we still synthesize the lockfile path so a metadata-only provider can exist.

This policy is useful, but keeping it inside `tools/buck/providers/node.ts` is a drift vector:

- other components (exporter, provider index, future language tooling) can easily re-implement the policy slightly differently
- tests end up validating the behavior indirectly rather than through a single contract

### Scope & Changes

- Extract the Node synthetic lockfile discovery policy into `tools/lib/importers.ts` (or a dedicated shared helper) with a clear name and contract, for example:
  - “discover PNPM lockfiles plus workspace importers missing lockfiles but containing `package.json`”
- Refactor `tools/buck/providers/node.ts` to use the shared helper.
- Update the Node exporter and/or other tooling that needs consistent importer discovery to use the same helper when applicable (avoid re-implementations).

### Tests (in this PR)

- Add a focused provider-sync test that:
  - creates a temp repo with `apps/demo/package.json` but no `apps/demo/pnpm-lock.yaml`
  - asserts provider sync emits a provider for `apps/demo` (metadata-only provider)
  - asserts behavior is deterministic and idempotent across runs
- Add a regression case ensuring importers outside the supported importer set do not get synthetic providers.

### Docs (in this PR)

- Document the synthetic lockfile behavior in the Node provider sync docs:
  - when we synthesize providers
  - what guarantees it provides (stable edges, deterministic mapping)
  - what it does not do (it does not claim dependencies exist without a lockfile)

### Acceptance Criteria

- Node provider sync no longer contains bespoke filesystem scanning for synthetic lockfiles.
- The synthetic-lockfile policy is defined once and tested directly.
- Provider output remains unchanged for existing repos that already have real lockfiles.

### Risks

- If any tooling implicitly relied on the old scanning order or implicit filters, this refactor could surface those assumptions. Tests should lock down output ordering and content.

### Consequence of Not Implementing

- The policy remains duplicated and likely to drift as more tooling is added.

### Downsides for Implementing

- Mechanical refactor plus one new focused test and doc update.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/lib/importers.ts`, `tools/buck/providers/node.ts`, and narrow provider tests. Safe in Node-focused slices.

---

## PR‑4: Make importer-scoped patch inclusion policy explicit in the public contract (Node vs Python), and lock it down with one “policy test”

### Description

Node and Python are both importer-scoped ecosystems, but they intentionally have different patch inclusion behavior:

- Node: include all importer-local patches under `<importer>/patches/node/*.patch`
- Python: include only patches that match the `uv.lock` effective set

This policy is already described in `build-system-design.md`, but it is not treated as a public contract in the handbook, and there is no single focused regression test in `tools/tests/` that fails if the policy drifts. This makes it easy for a future refactor to accidentally unify these behaviors and silently change invalidation semantics.

This PR makes the policy explicit as part of the public contract and adds one focused test that fails if the policy drifts.

### Scope & Changes

- Add a single, centralized “patch inclusion policy” description near the shared driver:
  - document which flag (`includeAllImporterLocalPatches`) is used and why
  - ensure the policy is an explicit language-level decision rather than an incidental default
- If any docs describe importer-scoped providers without mentioning this policy difference, update them for correctness.

### Tests (in this PR)

- Add one table-driven regression test that runs the shared importer provider sync driver with:
  - a fake importer effective set
  - a set of importer-local patches including one patch not in the effective set
  - and asserts:
    - Node selects all importer-local patches
    - Python selects only effective-set patches

### Docs (in this PR)

- Update handbook/provider documentation to state:
  - Node invalidation is “any importer-local patch change”
  - Python invalidation is “patches for locked deps only”
  - how to reason about rebuilds and why the policies differ

### Acceptance Criteria

- The policy difference is documented in a single authoritative place and reinforced by one regression test.
- A future refactor that accidentally unifies the behaviors fails tests immediately.

### Risks

- None expected beyond normal doc/test maintenance. This PR should not change behavior.

### Consequence of Not Implementing

- The policy difference remains implicit, making it easy for future changes to alter invalidation semantics unintentionally.

### Downsides for Implementing

- One small test and a doc update.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/lib/provider-sync-driver.ts` docs/comments and a narrow TS test. Safe in tooling slices.

---

## PR‑5: Make `./` normalization truly identical across TS/Starlark/Nix (strip repeated leading `./` segments)

### Description

We tightened the lockfile label contract in PR‑1 and explicitly treat “leading `./` is stripped” as part of the shared label contract.

However, there is still a small cross-language drift vector:

- Starlark and Nix strip **repeated** leading `./` segments (e.g. `././apps/web/...`).
- TypeScript currently strips only the first leading `./` segment.

This creates a narrow class of labels that are “valid” in one layer and “invalid” in another. Even if rare, it violates the stated design goal that label normalizers are identical across TypeScript, Starlark, and Nix.

This PR makes the primary path robust by making TypeScript’s normalization exactly match Starlark/Nix, without adding any fallback logic that could hide bugs.

### Scope & Changes

- Update `tools/lib/labels.ts` lockfile label parsing to strip **all** repeated leading `./` segments from the lockfile path (mirror `lang/lockfile_labels.bzl` and `tools/nix/planner/lib.nix`).
- Keep strict parsing rules unchanged:
  - exactly one `#`
  - non-empty path and importer
  - importer-dir consistency (`#.` only for repo-root lockfiles; otherwise `#<dirname(lockfilePath)>`)
- Do not add new “accept and guess” behavior. If the label is malformed after normalization, it remains invalid.

### Tests (in this PR)

- Update `tools/tests/lib/labels.parse-lockfile-label.strips-leading-dot-slash.test.ts` (or add a dedicated test) to assert:
  - `lockfile:././apps/web/pnpm-lock.yaml#apps/web` parses successfully and normalizes to the same canonical lockfile path as `lockfile:apps/web/pnpm-lock.yaml#apps/web`.
- Update `tools/tests/labels/lockfile-label.parity.test.ts` to add a TS ↔ Starlark parity case for the repeated `./` form.

### Docs (in this PR)

- Update the handbook lockfile label contract language to clarify that **any number** of leading `./` segments are stripped (not just one).

### Acceptance Criteria

- TS, Starlark, and Nix accept and normalize the repeated-leading-`./` lockfile label form identically.
- The parity test suite proves TS ↔ Starlark behavior matches for the repeated `./` case.
- No changes in behavior for already-canonical labels.

### Risks

- Very low. This expands normalization for a small input class and reduces drift.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Touches `tools/lib/labels.ts` and narrow tests/docs only. Safe in tooling slices.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑1 (lockfile label contract hardening) first. It defines the validity matrix that all other work depends on.
2. PR‑5 (normalization parity) next. It ensures the shared “leading `./` stripping” contract is literally identical across TS/Starlark/Nix.
3. PR‑2 (provider generation alignment) next. It removes the “valid label → impossible provider” class of failures.
4. PR‑3 (Node synthetic lockfile policy extraction) after PR‑2. It is easiest to review once importer support rules are settled.
5. PR‑4 (patch inclusion policy contract test + docs) can land anytime after PR‑2, but is simplest once provider sync behavior is stable.

---

## Verification & Backout Strategy

Each PR should include:

- A focused regression test that fails if the newly tightened contract regresses.
- A doc update that describes the user-visible contract in “what happens” terms.

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests/docs together
  - keep any new tests only if they still reproduce the issue on the prior baseline and remain meaningful
