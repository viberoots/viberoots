# Nixpkgs Source Selection Implementation Plan

This plan implements the design in
[`nixpkgs-source-selection-design.md`](nixpkgs-source-selection-design.md). The goal is target-scoped
nixpkgs profile selection first, followed by per-attr package pins that point directly at named
nixpkgs profiles and carry per-pin rationale.

The plan follows the PR-section style used by current viberoots implementation plans. The PR labels
in this document are planning labels only.

## Reviewed Context

- [`nixpkgs-source-selection-design.md`](nixpkgs-source-selection-design.md)
- [`build-system-design.md`](build-system-design.md)
- [`abstractions.md`](abstractions.md)
- [`cpp/curated-providers.md`](cpp/curated-providers.md)
- [`remote-build-setup.md`](remote-build-setup.md)
- [`../../docs/handbook/starlark-api.md`](../../docs/handbook/starlark-api.md)
- [`../../docs/handbook/provider-sync-cookbook.md`](../../docs/handbook/provider-sync-cookbook.md)
- [`../../docs/viberoots-source-modes.md`](../../docs/viberoots-source-modes.md)
- [`../../docs/history/process/turbo-mode.md`](../../docs/history/process/turbo-mode.md)

## Implementation Guardrails

- Do not add documentation-only PRs or testing-only PRs. Each PR must implement a coherent behavior
  slice and include tests and documentation for that slice.
- Do not use milestone names such as `V1`, `V2`, `phase1`, `phase2`, `PR1`, `PR2`, `pr1`, or `pr2`
  in public APIs, internal identifiers, comments, tests, generated graph fields, fixture names,
  diagnostics, or docs that describe shipped behavior. These labels are planning shorthand only.
- Use behavior names in code: `nixpkgs_profile`, `nixpkg_pins`, `sourcePlanFor`, `pkgsForProfile`,
  `resolveNixpkgAttr`, `profile_name`, `resolution_kind`, and similarly descriptive names.
- Do not introduce a separate reusable package-pin registry namespace. The registry owns named
  nixpkgs profiles; target-local `nixpkg_pins` map attrs directly to those profiles.
- Do not encode package-specific compatibility rules in viberoots. Viberoots validates deterministic
  source selection; compile, link, test, and runtime-package failures remain the normal feedback path
  for incompatible package combinations.
- Do not classify nixpkgs attrs as tools, headers, libraries, or runtimes for pin policy. A pin
  applies to every selected-target use of the normalized attr.
- Do not expose raw commits, flake URLs, nar hashes, overlays, Nix import arguments, or executable
  target-local source-selection code in BUILD files.
- Do not make labels the source of truth for source selection. Labels may be observability stamps,
  but explicit graph fields and resolver inputs are authoritative.
- Preserve current default behavior for targets that omit `nixpkgs_profile` and `nixpkg_pins`.
- Keep the implementation compatible with local selected builds, filtered flake snapshots, remote
  source snapshots, and consumer workspace generated flakes.
- Avoid compatibility shims for old experimental names. There are no users of this feature yet, so
  the implementation should land with the final names from the design.

## Validation Policy

- Each PR must add focused tests for its own changed behavior and update user-facing or design docs
  for the same scope.
- Each PR that changes Starlark macro surfaces must test defaulting, malformed attr rejection, and
  planner-visible stub propagation.
- Each PR that changes graph export must test both cquery graph export and inline graph export.
- Each PR that changes Nix planner behavior must test local selected builds and the resolver path
  with realistic graph fixtures.
- Each PR that changes filtered or remote source behavior must test selected local, filtered flake,
  and source snapshot/cache-manifest parity for the affected fields.
- Tests should assert behavior directly rather than matching broad log text. Diagnostics tests should
  verify the target label, normalized attr, profile name, and actionable fix text.
- If focused validation fails, investigate the root cause before continuing. Do not weaken tests,
  loosen assertions, or add fallbacks that hide source-selection bugs.

## Turbo Mode Policy

This plan may use the turbo-mode process from
[`../../docs/history/process/turbo-mode.md`](../../docs/history/process/turbo-mode.md), but only as
a constrained validation cadence. Source selection is fundamental build-system behavior, so turbo
mode means deferring full validation to named checkpoints, not replacing full validation with focused
tests.

For this implementation run, use the current viberoots commit as the initial scoped-verify base:

```bash
GITHUB_BASE_REF=1555522a2ddf5bbfe03f5c2ecedaf649a271fe8b v
```

Future runs must use the correct viberoots base ref for their own starting point. Do not reuse this
commit if the range starts elsewhere. A wrong base ref can make `v` choose the wrong changed-file
scope.

Every time a full-suite run passes and the validated changes are committed, that resulting commit
becomes the new base ref for later scoped `v` invocations in this implementation range. The initial
base above is only valid until the first passing full-suite checkpoint commit supersedes it.

Turbo-mode cadence for this plan:

- Before PR-1: establish or cite a full-validation baseline for the current base commit.
- PR-1 and PR-2: focused validation is acceptable if registry/default parity and graph export tests
  pass and no shared test harness behavior changes.
- PR-3: full validation checkpoint after whole-target profile resolution works locally and in
  filtered builds. After the passing full-suite result is committed, use that commit as the new
  scoped-verify base.
- PR-4: focused validation is acceptable if source-aware identity and dev override tests pass.
- PR-5: run broad targeted validation for package pins, then continue directly to PR-6 before
  treating package pins as remote/cache ready.
- PR-6: full validation checkpoint after filtered, remote, cache, and consumer workspace parity
  lands. After the passing full-suite result is committed, use that commit as the new
  scoped-verify base.
- PR-7: mandatory final full validation and plan assessment checkpoint.

Each PR still needs focused tests, docs for its scope, scope review, and an integration-debt entry
for any intentionally deferred broader validation. A checkpoint cannot close while the ledger has
open source-selection risks.

## De-Risking Checkpoints

### Checkpoint A: Profile Registry And Default Parity

After PR-1, the registry and default profile path should preserve today's behavior. Continue only if
targets without source-selection attrs still resolve exactly as before and registry/profile errors are
clear.

### Checkpoint B: Whole-Target Profile Works End To End

After PR-3, a selected C++ target should build with a non-default `nixpkgs_profile`, including
compiler/stdenv and ordinary nixpkg attr resolution from that profile. Continue only if local selected
builds and filtered flake builds agree on the selected profile. This is a full-validation checkpoint
when turbo mode is active.

### Checkpoint C: Package Pins Preserve Explicit Identity

After PR-5, a selected target should resolve pinned attrs from their declared profiles, leave
unpinned attrs on the target profile, and keep same-name attrs from different profiles distinct.
Continue only if viberoots does not add package compatibility logic and pin diagnostics are
actionable.

### Checkpoint D: Remote And Consumer Parity

After PR-6, source snapshots, filtered snapshots, cache manifests, and generated consumer workspace
flakes should all carry enough source-plan evidence to reproduce and explain selected builds. Continue
only if local, filtered, and remote-prepared plans are equivalent for the same target. This is a
full-validation checkpoint when turbo mode is active.

## Integration Debt Ledger

Use this ledger for deliberate follow-up discovered during implementation. Do not use it to hide
failing tests, weakened assertions, or behavior regressions.

| Area     | Introduced by | Owner PR | Status | Notes                                                                                   |
| -------- | ------------- | -------- | ------ | --------------------------------------------------------------------------------------- |
| None yet | N/A           | N/A      | Open   | Add entries only when a PR deliberately defers integration work with explicit approval. |

## PR-1: Profile Registry And Resolver Foundation

### 1. Intent

Introduce the lockfile-backed nixpkgs profile registry and resolver foundation while preserving the
current default behavior.

### 2. Scope of changes

- Add a build-tools-owned nixpkgs source registry with:
  - `schemaVersion`
  - `profiles.default`
  - optional profile rationale strings
  - per-system support for `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux`
- Add planner helpers:
  - `nixpkgsRegistry`
  - `pkgsForProfile profile_name`
  - default source-plan construction for targets with no explicit source-selection attrs
- Keep the default profile wired to the existing `inputs.nixpkgs` behavior.
- Add targeted diagnostics for missing registry files, invalid registry schema, unknown profile names,
  and unsupported systems.
- Update docs for the registry shape and profile import policy in the same PR.

### 3. Tests

- Registry schema validation accepts the default registry.
- Unknown profile names fail with the selected target and registry path.
- Existing default C++ nixpkg attr resolution still resolves from the default profile.
- Profile imports are system-specific and do not read ambient environment variables for source
  identity.

### 4. Acceptance criteria

- Existing selected builds with no source-selection attrs remain behaviorally unchanged.
- `pkgsForProfile "default"` resolves to the same package set the planner uses today.
- Missing or malformed registry input fails closed with actionable diagnostics.

### 5. Risks

- Registry import may accidentally apply overlays/config differently from the current default import.
- Treating the registry as a coarse action input may initially invalidate more builds than necessary.

### 6. Consequence of not implementing

Target-level profile selection and package pins have no lockfile-backed source of truth.

### 7. Recommendation

Implement.

## PR-2: Starlark And Graph Source-Selection Fields

### 1. Intent

Add final BUILD-facing fields and graph export support without enabling non-default package
resolution yet.

### 2. Scope of changes

- Add shared Starlark handling for:
  - `nixpkgs_profile = "default"`
  - `nixpkg_pins = {}`
- Validate Starlark shape:
  - profile names are strings
  - pin maps are dictionaries
  - pin entries are dictionaries
  - pin entries include string `nixpkgs_profile`
  - pin entries include non-empty string `rationale`
  - obvious raw commit-looking values and raw flake URLs are rejected where possible
- Represent `nixpkg_pins` as a nested string dictionary where rule attrs are needed.
- Add `nixpkgs_profile` and `nixpkg_pins` attrs to planner-visible stubs and Nix-calling rules that
  represent targets consuming `nixpkg_deps`.
- Update both graph export paths:
  - `build-tools/tools/buck/exporter/cquery/attrs.ts`
  - `build-tools/tools/buck/export-inline.ts`
- Add shared TypeScript normalization for `nixpkg_pins` so cquery and inline graph exports preserve
  the same nested map shape.
- Reject non-empty `nixpkg_pins` before package-pin resolution is implemented. Do not silently ignore
  pins.
- Update Starlark API docs for the accepted attrs and temporary unsupported non-empty pin behavior.

### 3. Tests

- Macro defaulting emits `nixpkgs_profile = "default"` and empty `nixpkg_pins` in planner-visible
  attrs.
- Malformed pin maps fail in Buck analysis with clear messages.
- Cquery and inline graph exports produce the same source-selection fields.
- Planner-visible companion targets preserve source-selection attrs from public macros.
- A non-empty pin map fails explicitly until pin resolution lands.

### 4. Acceptance criteria

- All Nix-backed artifact macros that consume `nixpkg_deps` preserve the new fields through the graph.
- Empty pins are schema-stable and behavior-preserving.
- Non-empty pins are impossible to write accidentally without a hard failure.

### 5. Risks

- Nested dict attr propagation may be missed in one planner-visible stub or Nix-calling rule.
- Inline and cquery exports may diverge without shared normalization.

### 6. Consequence of not implementing

The planner cannot receive source-selection intent consistently from BUILD files.

### 7. Recommendation

Implement.

## PR-3: Whole-Target Profile Resolution

### 1. Intent

Make `nixpkgs_profile` behavior real for selected targets, including compiler/stdenv and ordinary
nixpkg attr resolution from the selected profile.

### 2. Scope of changes

- Route all selected-target nixpkg attr resolution through `resolveNixpkgAttr`.
- Build a source plan for each selected target using:
  - target-level `nixpkgs_profile`
  - empty `nixpkg_pins`
- Add a multi-profile Nix template boundary:
  - either instantiate language templates with the selected target's profile `pkgs`
  - or pass `base_profile_pkgs` plus resolved package records into template constructors
- Ensure templates no longer resolve nixpkg attrs against one global `pkgs` value.
- Wire C++ first, then apply the same resolver entrypoint to Go CGO and Python native extension paths
  touched by selected builds.
- Update diagnostics to print the selected target profile in debug and failure contexts.
- Update `build-system-design.md`, `abstractions.md`, and C++ curated provider docs for whole-target
  profile behavior.

### 3. Tests

- A target with no new attrs uses the default profile.
- A C++ target with non-default `nixpkgs_profile` resolves all `nixpkg_deps` from that profile.
- Compiler/stdenv for a selected C++ target comes from the target-level profile.
- Go CGO and Python native extension selected paths call the shared resolver where applicable.
- Filtered flake selected builds preserve the same whole-target profile plan as local selected
  builds.

### 4. Acceptance criteria

- Whole-target profile selection is user-visible and documented.
- The behavior is deterministic across local selected builds and filtered flake builds.
- No package-pin behavior is exposed beyond the explicit unsupported failure from PR-2.

### 5. Risks

- The current template stack is closed over one `pkgs`; changing that boundary may expose hidden
  assumptions in C++ templates.
- Overlay/config assignment per profile may need careful default-profile parity checks.

### 6. Consequence of not implementing

Users cannot move a target to a coherent alternate nixpkgs universe.

### 7. Recommendation

Implement.

## PR-4: Source-Aware Identity And Dev Override Policy

### 1. Intent

Prepare internals for package pins by making source identity part of package identity and resolving
dev override behavior before same-name attrs can come from multiple profiles.

### 2. Scope of changes

- Replace attr-only nixpkg dedupe with identity keyed by:
  - normalized attr
  - resolved profile name
- Preserve source identity in resolved package records:
  - `attr`
  - `resolution_kind`
  - `profile_name`
  - optional pin `rationale`
  - derivation
- Add conflict diagnostics that report target label, normalized attr, profile name, and resolution
  kind.
- Define and implement dev override behavior for package-pin readiness:
  - prefer profile-qualified override keys
  - or reject dev overrides when package pins are active until profile-qualified overrides land
- Keep provider labels as attr declarations, not source-selection authority.
- Update provider-sync docs if diagnostics or sidecars expose source-plan data.

### 3. Tests

- Same attr from two profiles remains distinct internally.
- Attr-only dedupe no longer collapses profile-distinct records in resolver tests.
- Dev overrides are either profile-qualified or rejected when non-default source plans are active,
  according to the implemented policy.
- Provider mapping still works without generating per-profile provider targets.

### 4. Acceptance criteria

- Package identity is source-aware before non-empty package pins are accepted.
- Diagnostics explain profile-distinct packages without exposing raw commits by default.
- Existing provider and curated nixpkg dependency workflows keep working.

### 5. Risks

- Changing dedupe identity can expose assumptions in templates or diagnostics that expect strings.
- Dev override policy may require more UI polish once users exercise package pins.

### 6. Consequence of not implementing

Package pins would be unsafe to expose because same-name attrs from different profiles could collapse
or be overridden incorrectly.

### 7. Recommendation

Implement.

## PR-5: Package Pins

### 1. Intent

Enable target-local per-attr pins that resolve named attrs from declared nixpkgs profiles and require
per-pin rationale.

### 2. Scope of changes

- Accept non-empty `nixpkg_pins` with the final shape:

  ```starlark
  nixpkg_pins = {
      "pkgs.openssl": {
          "nixpkgs_profile": "nixpkgs-23_11",
          "rationale": "Compatibility with legacy TLS peer during migration.",
      },
  }
  ```

- Validate target-local pin objects in the planner:
  - normalized attr key is valid
  - referenced profile exists in the registry for the selected system
  - rationale is non-empty
  - pin key is part of the selected target's resolved nixpkg attr set or fails/warns according to
    the implemented undeclared-pin policy
- Resolve pinned attrs from their declared `nixpkgs_profile`.
- Resolve unpinned attrs from the target-level `nixpkgs_profile`.
- Apply pins uniformly to every selected-target use of the normalized attr. Do not add build/header,
  link/runtime, tool/library, or package-specific compatibility classification.
- Add diagnostics for:
  - unknown profile in a pin
  - missing rationale
  - undeclared pin attr
  - valid multi-profile source plan
- Update user docs with examples that show promoting repeated pins to target-level
  `nixpkgs_profile`.

### 3. Tests

- A selected target resolves a pinned attr from the pin profile and unpinned attrs from the target
  profile.
- Missing pin rationale fails with target label and normalized attr.
- Unknown pin profile fails with target label, normalized attr, and registry path.
- A pin key absent from the resolved nixpkg attr set fails or warns according to the implemented
  policy.
- A package that happens to contain tools and libraries is not treated specially by viberoots.
- A protobuf-like fixture with intentionally mismatched attrs is allowed to reach normal build
  failure rather than being rejected by source-selection policy.
- Local and filtered selected builds produce the same pin source plan.

### 4. Acceptance criteria

- Users can pin individual attrs directly to named nixpkgs profiles with per-pin rationale.
- Viberoots does not encode package compatibility knowledge.
- The same normalized attr resolves consistently from the same profile everywhere in the selected
  target plan.

### 5. Risks

- Users may expect pins to create undeclared dependencies; diagnostics must explain that pins only
  redirect attrs already consumed by the selected plan.
- Some language templates may need follow-up if their transitive attr collection is not planner
  visible enough for clear undeclared-pin diagnostics.

### 6. Consequence of not implementing

Users can only move whole targets to alternate profiles and cannot express narrow reviewed
exceptions.

### 7. Recommendation

Implement.

## PR-6: Filtered, Remote, Cache, And Consumer Workspace Parity

### 1. Intent

Make source-selection evidence durable across filtered flake snapshots, remote source snapshots,
cache manifests, and generated consumer workspace flakes.

### 2. Scope of changes

- Ensure filtered flake snapshots include:
  - registry file
  - flake inputs used by registry profiles
  - `flake.lock`
  - graph JSON source-selection fields
  - planner resolver code
- Update generated workspace flakes in `build-tools/tools/lib/consumer-bootstrap.ts` so consumer
  workspaces can expose additional lockfile-backed nixpkgs inputs and registry extension data.
- Update selected-build source choice in `build-tools/tools/dev/build-selected.ts`.
- Update filtered snapshot helpers:
  - `build-tools/tools/dev/filtered-flake.ts`
  - `build-tools/tools/dev/nix-build-filtered-flake.ts`
  - `build-tools/tools/dev/nix-build-filtered-flake-lib.ts`
  - `build-tools/cpp/private/nix_build.bzl`
- Add source-plan evidence to:
  - `build-tools/tools/dev/source-snapshot.ts`
  - `build-tools/tools/ci/cache-manifest.ts`
  - `build-tools/tools/ci/publish-nix-cache-manifest.ts`
- Use a minimal manifest shape:

  ```json
  {
    "target": "//projects/apps/demo:tool",
    "nixpkgs_profile": "default",
    "nixpkg_pins": {
      "pkgs.openssl": {
        "nixpkgs_profile": "nixpkgs-23_11"
      }
    }
  }
  ```

- Update remote-build and source-mode docs for source-plan evidence and consumer registry extension.

### 3. Tests

- Filtered flake snapshots include the registry and relevant lockfile-backed inputs.
- Remote source snapshots include source-plan evidence for selected targets.
- Cache manifests include normalized attr/profile evidence without requiring pin rationales.
- Local selected builds, filtered selected builds, and remote-prepared builds resolve the same source
  plan for the same target.
- Consumer workspace generated flakes can expose an additional profile and use it in a selected target
  fixture.

### 4. Acceptance criteria

- Source-selection behavior is reproducible outside the live workspace.
- Cache and remote diagnostics can explain which profile supplied each pinned attr.
- Consumer workspace extension points are documented and validated by fixture tests.

### 5. Risks

- Treating the registry file as a coarse global input may cause noisy invalidation initially.
- Consumer workspace flake extension needs careful ownership boundaries so generated state stays under
  `.viberoots/workspace/**`.

### 6. Consequence of not implementing

Package pins may work locally but fail or become opaque in filtered, remote, or consumer workspace
flows.

### 7. Recommendation

Implement.

## PR-7: Cross-Language Hardening And Final Diagnostics

### 1. Intent

Finish source-selection support across the supported native dependency paths and make diagnostics and
docs complete enough for user adoption.

### 2. Scope of changes

- Harden C++, Go CGO, Python native extension, and C++ Node addon paths against missing source-plan
  propagation.
- Add graph inspection or planner inspection output for selected target source plans.
- Ensure diagnostics avoid raw commits by default but can point users to lockfile evidence when
  needed.
- Finalize dev override docs and overlay/profile behavior docs.
- Update:
  - `build-tools/docs/abstractions.md`
  - `build-tools/docs/build-system-design.md`
  - `build-tools/docs/cpp/curated-providers.md`
  - `docs/handbook/starlark-api.md`
  - `docs/handbook/provider-sync-cookbook.md` if provider diagnostics expose source-plan data
  - language docs whose native dependency paths consume `nixpkg_deps`

### 3. Tests

- Planner-visible companions missing source-selection attrs fail focused regression tests.
- C++, Go CGO, Python native extension, and C++ Node addon fixtures resolve source plans through the
  same resolver.
- Debug inspection output includes target, `nixpkgs_profile`, normalized attrs, profiles, and pin
  rationales where appropriate.
- Docs examples in `starlark-api.md` match implemented defaults and failure behavior.
- A final focused validation run covers local selected, filtered, remote/cache evidence, and consumer
  workspace profile extension fixtures.

### 4. Acceptance criteria

- The implementation is consistent across supported native dependency paths.
- User-facing docs describe the final API and do not mention planning labels as code concepts.
- Diagnostics are actionable for unknown profiles, missing rationale, undeclared pins, and valid
  multi-profile plans.

### 5. Risks

- Cross-language fixtures may reveal inconsistent attr collection behavior that needs small local
  fixes.
- Inspection output can become too verbose if it prints low-level lockfile details by default.

### 6. Consequence of not implementing

The feature may be technically available but uneven across languages and hard to debug.

### 7. Recommendation

Implement.

## Rollout And Sequencing

1. PR-1 establishes the registry and default resolver foundation.
2. PR-2 lands final Starlark and graph fields while failing closed for non-empty pins.
3. PR-3 makes whole-target profile selection work end to end.
4. PR-4 makes package identity source-aware before pins are enabled.
5. PR-5 enables package pins.
6. PR-6 makes filtered, remote, cache, and consumer workspace flows source-plan aware.
7. PR-7 hardens cross-language behavior and final diagnostics.

The sequence intentionally makes whole-target profile selection the first usable behavior while
keeping the resolver shape ready for package pins. Each PR should be independently reviewable and
should leave the repository with passing focused validation for its scope.

## Verification And Backout Strategy

- PR-1 backout removes the registry/resolver foundation and returns all selected builds to the current
  single-`pkgs` path.
- PR-2 backout removes graph/Starlark fields before non-default behavior depends on them.
- PR-3 backout disables whole-target profile resolution but leaves graph fields harmless if PR-2
  remains.
- PR-4 backout restores attr-only identity only if package pins have not shipped; after PR-5 this is
  not safe without also backing out pins.
- PR-5 backout disables non-empty `nixpkg_pins` and restores the explicit failure behavior from PR-2.
- PR-6 backout should disable remote/cache source-plan evidence only together with package-pin remote
  use, because local/remote parity is required once pins are user-visible.
- PR-7 backout should be limited to the affected language hardening or inspection surface; core source
  selection should already be covered by earlier PRs.

Before enabling package pins for users, run the Checkpoint C validation set. Before treating pins as
remote/cache ready, run the Checkpoint D validation set.

When turbo mode is active, run the mandatory final full validation after PR-7 with the correct
viberoots base ref for this implementation range. For this run, scoped `v` invocations should start
with `GITHUB_BASE_REF=1555522a2ddf5bbfe03f5c2ecedaf649a271fe8b`, then move to each committed
full-suite checkpoint after it passes. Future runs should replace the initial value with their actual
starting commit.
