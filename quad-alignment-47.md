# Quad Alignment Plan - Close Cross-Language Patch Parsing Gap - Part 47

This plan closes the remaining gap identified in the cross-language abstraction review.

Each PR includes code, tests, and documentation updates together.

Scope: C++ patch filename parsing refactor to use the shared decoder and add parity coverage for the
overlay.

Non-goals: no standalone docs-only or tests-only PRs.

Completion criteria: the C++ overlay uses the canonical patch filename decoder, and a test guards
parity with the shared contract.

---

## PR-1: Unify C++ overlay patch filename decoding with shared contract

### Description

I will refactor the C++ Nix overlay to use the shared patch filename decoding helper so the
cross-language contract is enforced in one place. I will add a parity test that guards the overlay
decode behavior against the canonical helper.

### Scope & Changes

- Update `tools/nix/overlays/cpp-patches.nix`:
  - Replace the hand-rolled `<enc>@<ver>.patch` parsing with
    `tools/nix/lib/lang-helpers.nix:decodePatchFilename`.
  - Keep the existing attr decoding (`__` -> `/` then `/` -> `.`) to preserve the nixpkgs attr
    mapping.
- Add or extend a test under `tools/tests/nix/` to assert the overlay decode uses the canonical
  decoder and matches expected keys for a small fixture set.
- Update `abstractions.md` to call out the overlay as using the shared decoder, so any future drift
  is reviewable.

### Tests (in this PR)

- Add a Nix test fixture that:
  - Feeds a small list of patch filenames into `decodePatchFilename`.
  - Asserts the overlay-level decoding path yields the same `{ importPath, version }` pairs.
  - Covers the "last @ is version" rule and empty/invalid cases.

### Docs (in this PR)

- Update `abstractions.md` to list the C++ overlay as a consumer of
  `tools/nix/lib/lang-helpers.nix:decodePatchFilename`.

### Acceptance Criteria

- `tools/nix/overlays/cpp-patches.nix` no longer implements its own filename parsing.
- The overlay still selects the same patches for a given nixpkgs attribute and version.
- New parity test passes and protects the contract.

### Risks

Behavior drift in the overlay if the refactor changes how invalid filenames are handled.

### Mitigation

Add a focused parity test that covers valid and invalid filenames and asserts no change to the set
of applied patches.

### Consequence of Not Implementing

Patch filename decoding remains duplicated in the overlay and can drift from the shared contract.

### Downsides for Implementing

Small refactor and an additional test fixture to maintain.

### Recommendation

Implement.
