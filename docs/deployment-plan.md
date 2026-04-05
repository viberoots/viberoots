# Deployment Implementation Plan - PR Breakdown

This plan covers implementation of the deployment model described in
[Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md), with the first
working end-to-end milestone prioritized around the `mini` shared-dev flow described in
[Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md).

Each PR includes code, tests, and documentation updates together.

Priority goal:

- get `mini`-based shared dev working end to end for static webapps first
- keep that path aligned with the final deployment design instead of building a throwaway shortcut
- after that first milestone, get static-webapp deploys working to Cloudflare Pages with a real
  `dev -> staging -> prod` flow for Pleomino
- continue from that first successful path until the broader deployment design is implemented

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no untested functionality landing behind "we will test later"
- no local-only shortcuts that contradict the shared-control-plane design for shared environments

Completion criteria:

- `mini` shared-dev static webapps work end to end with tested provisioning, publish, ingress, and
  smoke behavior
- static webapps can deploy to Cloudflare Pages through the shared deployment system with tested
  promotion-safe `dev -> staging -> prod` behavior for Pleomino
- the repo has a coherent implementation of deployment metadata extraction, provider capabilities,
  control-plane authority, immutable artifact handling, retry/rollback/promotion, preview cleanup,
  and authoritative records consistent with
  [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)

---

## PR-1: Deployment metadata foundation + `nixos-shared-host` static-webapp contract

### Description

I will establish the smallest reviewed metadata and validation foundation needed to support a real
provider family without baking policy into ad hoc scripts. This PR lands the `nixos-shared-host`
deployment shape for static webapps, the extraction path from `TARGETS`, and validation rules that
keep the later control-plane and host realization work deterministic.

### Scope & Changes

- Add deployment-schema support for the first `nixos-shared-host` provider family shape.
- Add `static-webapp` as the first in-scope component kind for this provider family.
- Add reviewed deployment metadata fields required for the first slice:
  - `appName`
  - `containerPort`
  - optional `healthPath`
  - optional `targetGroup`
  - provider family / publisher / provisioner references
  - `protection_class = "shared_nonprod"` defaulting rules for this provider family
- Add Buck-side extraction for canonical deployment metadata from `TARGETS`.
- Add provider-target identity normalization for `nixos-shared-host`:
  - hostname `${appName}.apps.kilty.io`
  - container identity `${appName}`
  - shared-dev target identity normalization suitable for locking and records later
- Add repo validation for the first provider-family contract:
  - reject missing required fields
  - reject duplicate `appName` values that would collide on hostname
  - reject explicit subdomain-style overrides for this provider family
  - reject use of this provider family with unsupported component kinds
- Add one sample deployment package for a static webapp targeting `mini`.

### Tests (in this PR)

- Add schema tests for `nixos-shared-host` deployment metadata.
- Add Buck extraction tests proving canonical metadata is emitted from `TARGETS`.
- Add validation tests that reject:
  - duplicate `appName`
  - missing `containerPort`
  - invalid `targetGroup`
  - unsupported component kinds for this provider family
- Add contract tests for provider-target identity derivation:
  - `${appName}.apps.kilty.io`
  - normalized container identity
  - normalized shared-dev provider-target identity

### Docs (in this PR)

- Update deployment schema and provider-capability docs for `nixos-shared-host`.
- Document the static-webapp-only initial scope and the required metadata contract.
- Document the normalization rules for hostname and container identity.

### Verification Commands

- `buck2 test //...`
- `buck2 cquery //projects/deployments/...`

### Expected Regression Scope

- `mixed`
- This PR is expected to touch both deployment/build-system code and at least one concrete
  `projects/...` deployment package. Under the current verify policy, build-system changes are
  authoritative, so default `v` / CI runs the full build-system verify scope rather than narrowing
  to project-only selection.

### Acceptance Criteria

- `TARGETS` can express a valid `nixos-shared-host` static-webapp deployment.
- Extraction produces deterministic normalized metadata for that deployment.
- Validation fails closed on hostname collisions and missing required fields.
- Documentation and tests in this PR describe the same first-slice contract.

### Risks

If the first metadata contract is too loose, later control-plane and host-state work will inherit
ambiguity.

### Mitigation

Keep the first provider-family contract intentionally narrow and validate aggressively.

### Consequence of Not Implementing

The `mini` shared-dev path would start from ad hoc local conventions instead of the repository's
authoritative deployment model.

### Downsides for Implementing

This front-loads schema and validation work before visible deployment behavior exists.

### Recommendation

Implement first so the rest of the `mini` work lands on a stable metadata foundation.

---

## PR-2: Authoritative platform state + `nixos-shared-host` realization for shared-dev static targets

### Description

I will implement the authoritative cumulative platform-state model for the reviewed
`nixos-shared-host` provider and teach the host to realize shared-dev static targets declaratively
from that state. This PR covers safe partial-slice behavior, host-side NixOS container generation,
and nginx routing generation, but stops short of the artifact publisher.

### Scope & Changes

- Implement the first authoritative platform-state artifact for `nixos-shared-host` shared-dev deployments.
- Add control-plane or deploy-side logic to update that platform state from:
  - scoped apply inputs
  - authoritative full reconcile inputs
  - explicit removal requests
- Add safe merge semantics so slice-local inputs cannot delete out-of-scope apps.
- Teach the `nixos-shared-host` configuration to consume authoritative platform state and derive:
  - one declarative NixOS container per app
  - one nginx route per app
  - deterministic backend addressing
- Add host-level conflict checks:
  - duplicate hostname rejection
  - duplicate backend identity rejection
  - undeclared hostname routing rejection
- Add a generic static-app-host container shape for the first shared-dev implementation.
- Add a reviewed host-apply path for updating a NixOS shared host declaratively from generated state.

### Tests (in this PR)

- Add platform-state merge tests for:
  - scoped apply create
  - scoped apply update
  - explicit removal
  - authoritative full reconcile
  - omission in scoped apply not implying deletion
- Add Nix or fixture-based host-generation tests proving:
  - container config generation from authoritative platform state
  - nginx route generation from the same input
  - host rejection of duplicate hostnames or backends
- Add an integration test for "partial slice plus preexisting app" proving host realization preserves
  out-of-scope apps.

### Docs (in this PR)

- Document the authoritative platform-state model for `nixos-shared-host`.
- Document scoped apply, authoritative full reconcile, and explicit removal semantics.
- Document the host realization contract for containers, routing, and deterministic backend identity.

### Verification Commands

- `buck2 test //...`
- host-generation evaluation command for the `nixos-shared-host` module as introduced in this PR

### Expected Regression Scope

- `build-system only`
- This PR should stay within deployment/control-plane, host-realization, and test infrastructure
  paths. Under the current verify policy, those build-system changes broaden default `v` / CI to
  the full build-system verify scope rather than `project-impact` selection.

### Acceptance Criteria

- `nixos-shared-host` realizes declarative shared-dev host state from one authoritative cumulative input.
- Scoped apply updates are safe with partial repo slices.
- Host generation is deterministic and fails closed on routing conflicts.
- Documentation and tests describe the same reconciliation semantics.

### Risks

Mixing slice-local manifests with declarative host state can accidentally create delete-on-omission
behavior.

### Mitigation

Make the authoritative platform-state artifact explicit and forbid host realization directly from
informationally incomplete slice inputs.

### Consequence of Not Implementing

The first visible shared-dev deployment flow would either be unsafe for partial slices or rely on a
hand-maintained host registry.

### Downsides for Implementing

Adds control-plane or deploy orchestration complexity before artifacts are flowing end to end.

### Recommendation

Implement second so the first end-to-end publish path lands on the right host-state model.

---

## PR-3: `mini` shared-dev static-webapp publisher + smoke + first end-to-end flow

### Description

I will complete the first priority milestone: a static webapp can be declared in deployment
metadata, realized on `mini`, published into its target container, and validated through the public
hostname under `*.apps.kilty.io`.

### Scope & Changes

- Implement the first built-in publisher for `nixos-shared-host` static webapps.
- Define the first `publishContract` for the generic static app-host container:
  - artifact staging path
  - activation path
  - reload or restart semantics
- Add host/container runtime support for serving the published static artifact.
- Add shared-dev smoke support that validates the public routed hostname rather than only local
  container health.
- Add an operator-facing deploy command or workflow entrypoint for:
  - ensuring target exists
  - publishing the static artifact
  - running smoke
- Record the first deployment result and published artifact identity in whatever durable local
  record form exists at this stage.

### Tests (in this PR)

- Add an end-to-end test that:
  - declares a sample static-webapp deployment for `mini`
  - updates authoritative platform state
  - applies host realization
  - publishes the built artifact into the target container
  - asserts the app is reachable at `https://${appName}.apps.kilty.io`
  - asserts smoke runs against the public routed hostname
- Add failure-path tests for:
  - publish into missing target rejected
  - smoke failure recorded as deploy failure
  - hostname reachable but wrong artifact contents rejected
- Add publisher contract tests for artifact staging and activation behavior.

### Docs (in this PR)

- Document the first complete shared-dev operator flow for static webapps.
- Document the static-webapp publish contract for `nixos-shared-host`.
- Document smoke expectations and the first failure signatures.

### Verification Commands

- `buck2 test //...`
- the first end-to-end shared-dev deploy command sequence introduced in this PR

### Expected Regression Scope

- `mixed`
- This PR is expected to change the deploy/publish tooling and the first concrete shared-dev sample
  wiring used for the end-to-end flow. Because build-system changes are present, default `v` / CI
  still runs the full build-system verify scope rather than a project-targeted subset.

### Acceptance Criteria

- A static webapp can be deployed end to end to `mini`.
- The deployment is reachable at `${appName}.apps.kilty.io`.
- Smoke validates the public target and blocks success on failure.
- The flow is covered by real end-to-end tests in this PR.

### Risks

The first visible end-to-end path can tempt us into hard-coding behavior that later breaks replay,
locking, or provider generality.

### Mitigation

Keep the publisher contract explicit and aligned with the metadata and authoritative platform-state
contracts from PR-1 and PR-2.

### Consequence of Not Implementing

The main near-term goal of working `mini` shared dev for static webapps would remain theoretical.

### Downsides for Implementing

This introduces real deployment mechanics and a heavier integration-test surface early.

### Recommendation

Implement third as the first working milestone for the broader deployment program.

---

## PR-4: Durable deployment records + run classification + provider-target identity persistence

### Description

I will add the first durable deployment-record model and canonical run classification so the system
can stop treating the initial `mini` flow as an opaque imperative script and instead record provider
identity, artifact identity, lifecycle state, and outcome using the repository's canonical terms.

### Scope & Changes

- Implement durable deployment-record persistence with canonical fields for:
  - `operation_kind`
  - `publish_mode`
  - lifecycle state
  - final outcome
  - deployment id
  - provider
  - canonical provider-target identity
  - artifact identity
- Implement record generation for the existing `mini` shared-dev path.
- Add canonical `deploy` and `explicit removal` run classification for the implemented slice.
- Preserve enough target identity to diagnose host/container routing failures.
- Add basic lineage hooks for future retry, rollback, and promotion records.
- Ensure the recorded provider-target identity is derived from authoritative deployment metadata, not
  ambient host state.

### Tests (in this PR)

- Add persistence tests for required deployment-record fields.
- Add classification tests for `deploy` and `explicit removal`.
- Add record contract tests proving canonical provider-target identity is preserved for
  `nixos-shared-host`.
- Extend the existing end-to-end `mini` static deploy test to assert durable record contents.

### Docs (in this PR)

- Document the first implemented deployment-record schema slice and operator-visible meanings.
- Document how provider-target identity is recorded for `nixos-shared-host`.
- Document the distinction between lifecycle state and final outcome for the implemented flows.

### Verification Commands

- `buck2 test //...`
- any record-inspection CLI or fixture verification command introduced in this PR

### Expected Regression Scope

- `build-system only`
- This PR should be confined to deployment runtime, persistence, and record-model code plus owned
  tests. Under the current verify policy, those build-system changes keep default `v` / CI on the
  full build-system verify scope.

### Acceptance Criteria

- The working `mini` shared-dev flow emits canonical durable deployment records.
- Records preserve provider-target identity and artifact identity in a stable, queryable form.
- Tests prove the repo is using canonical terminology instead of provider-local ad hoc fields.

### Risks

If records are bolted on after behavior ships, replay and audit semantics will drift.

### Mitigation

Introduce canonical records before retry, rollback, promotion, or preview behavior expands.

### Consequence of Not Implementing

Later control-plane features would be forced to retrofit state onto an opaque initial deploy path.

### Downsides for Implementing

Adds storage and lifecycle-state complexity before advanced operations are visible to users.

### Recommendation

Implement immediately after the first end-to-end `mini` flow works.

---

## PR-4.5: Versioned `nixos-shared-host` host install / uninstall tooling for real NixOS hosts

### Description

I will add reviewed installation tooling for turning a real NixOS host such as `mini` into a
managed `nixos-shared-host` without relying on one-off manual shell sessions or unsafe edits to
arbitrary host config. This PR introduces versioned install and uninstall scripts that are safe
across repo revisions, resilient to different existing host states, and fail closed when the host's
Nix configuration cannot be updated through a reviewed managed path.

### Scope & Changes

- Add built-in install tooling for a NixOS host to become a managed `nixos-shared-host`.
- Add built-in install tooling for a developer machine so local operator workflows can target a real
  `nixos-shared-host` safely and repeatably.
- Add built-in uninstall tooling that removes only repo-managed `nixos-shared-host` assets and does
  not assume the host is still on the same repo version that installed them.
- Genericize and rename the current operator setup manual so it documents any
  `nixos-shared-host`, not just `mini`, and make the guide invoke the reviewed install/uninstall
  scripts from this PR instead of manual setup steps.
- Introduce a versioned host-install manifest that records:
  - install-tool schema version
  - repo/tool version or fingerprint
  - managed file paths
  - managed system users, directories, and state paths
  - chosen install mode
  - any managed NixOS drop-in/import entrypoints created by the installer
- Keep install/uninstall logic in reviewed TypeScript zx tools; no substantive host mutation logic in
  ad hoc shell scripts.
- Add a reviewed dev-machine install command that accepts required host parameters either:
  - by explicit CLI flags, or
  - by structured stdin input for scripted/automation usage
- Minimum parameterized dev-machine inputs should include:
  - the hostname or SSH destination of the `nixos-shared-host`
  - the remote repo checkout path or managed root path when not defaultable
  - the remote authoritative `statePath`
  - the remote managed runtime root and records root when not defaultable
  - any reviewed SSH or transport mode selectors required by the implementation
- Support at least two reviewed install modes:
  - `emit-only`
    - generate the exact NixOS module snippet, managed state paths, and operator instructions without
      mutating the host's config
  - `managed-dropin`
    - write a dedicated repo-managed drop-in file and a dedicated import/include anchor only when the
      target NixOS config path is explicit and reviewable
- Do not silently edit arbitrary existing host files by regex guesswork.
- Require explicit operator-supplied paths or explicit reviewed detection for:
  - the host's authoritative NixOS config root
  - the managed drop-in destination
  - the authoritative `statePath`
  - the managed runtime root
  - the managed records root
- Make installer behavior robust across varying host states:
  - host already has nginx enabled
  - host already imports extra NixOS modules
  - host already has existing non-managed files under the chosen config root
  - host may be flake-based or non-flake-based
  - host may already have an older managed install manifest from a previous repo version
- Implement uninstall behavior that:
  - reads the versioned managed-install manifest
  - removes only files and directories owned by that manifest
  - preserves non-managed sibling files
  - tolerates already-missing paths
  - supports uninstalling older manifest versions through explicit compatibility shims or fail-closed
    upgrade guidance
- Add a reviewed upgrade path when an installer encounters an older managed version:
  - safe in-place migration when compatibility is reviewed
  - otherwise emit an explicit manual migration refusal rather than making guessed destructive edits
- Add explicit host-preflight checks for:
  - NixOS presence
  - required Nix features
  - write permissions
  - conflicting existing managed install anchors
  - incompatible previously managed versions
  - unsupported host config topology for in-place managed-dropin mode
- Add an operator-facing dry-run mode for install and uninstall.
- Add an operator-facing inspect/status command that reports:
  - whether the host is managed
  - which version installed it
  - which managed paths exist
  - whether the expected NixOS module import is still wired
- Add a reviewed dev-machine configuration/install manifest that records:
  - the selected `nixos-shared-host` destination hostname
  - the chosen remote paths and transport parameters
  - the local tool version or fingerprint that produced the config
  - any repo-managed local config files, shell snippets, or connection profiles created by the installer
- Replace `mini`-specific setup guidance with a generic `nixos-shared-host` installation guide that:
  - explains how to install a host
  - explains how to install a dev machine
  - explains how to inspect status
  - explains how to uninstall safely
  - uses `mini` only as an example host, not as a special-case contract

### Tests (in this PR)

- Add install-manifest schema tests for current and backward-compatible manifest versions.
- Keep all install/uninstall tests non-destructive to the real testhost system:
  - host-mutation tests must run against isolated fixture roots or temp-repo host trees
  - live-system paths such as `/etc/nixos`, `/var/lib`, system users, nginx state, and running host
    services must not be mutated by ordinary test execution
  - any test that needs real-host validation must default to dry-run or explicit opt-in execution
    and must fail closed when the required isolation boundary is not present
- Add fixture-based install tests for:
  - fresh host config root
  - host with preexisting nginx config
  - host with preexisting extra imports
  - flake-based host config
  - non-flake `/etc/nixos` style host config
- Add uninstall tests proving:
  - only manifest-owned paths are removed
  - unrelated sibling files are preserved
  - missing managed paths do not fail uninstall
  - older manifest versions either migrate safely or fail closed with an explicit message
- Add dry-run snapshot tests for install and uninstall.
- Add dev-machine installer tests proving:
  - required host parameters can be supplied by flags
  - the same parameters can be supplied by stdin
  - missing required host parameters fail closed with explicit guidance
  - install output is deterministic for the same parameter set
- Add status/inspect tests for:
  - uninstalled host
  - correctly installed host
  - partially drifted host
- Add integration tests that install, then uninstall, then reinstall into the same fixture host root.

### Docs (in this PR)

- Document the reviewed host install modes for `nixos-shared-host`.
- Document the versioned managed-install manifest contract.
- Document uninstall guarantees and non-goals.
- Rename `mini-setup.md` to a generic `nixos-shared-host` setup/install guide and update any links or
  references accordingly.
- Document the operator decision tree for:
  - `emit-only`
  - `managed-dropin`
  - dev-machine install with flag-based input
  - dev-machine install with stdin-based input
  - uninstall
  - upgrade from an older managed install version

### Verification Commands

- `buck2 test //...`
- install dry-run command for a fixture host root introduced in this PR
- uninstall dry-run command for a fixture host root introduced in this PR

### Expected Regression Scope

- `build-system only`
- This PR should live in installer, host-management, and related test/doc paths rather than
  project-owned app code. Under the current verify policy, default `v` / CI therefore runs the full
  build-system verify scope.

### Acceptance Criteria

- A real NixOS host such as `mini` can be put into a reviewed `nixos-shared-host` shape without
  unsafe ad hoc edits.
- A developer machine can be configured through a reviewed installer to target that
  `nixos-shared-host` using explicit parameterized host input.
- Uninstall removes only managed assets and remains safe across reviewed installer versions.
- The tooling fails closed when the host's Nix configuration cannot be modified through a reviewed
  managed path.
- The genericized `nixos-shared-host` setup guide matches the new installer/uninstaller workflow and
  no longer presents `mini`-specific manual steps as the primary path.
- Tests cover install, uninstall, status, versioning, and host-state variation in the same PR.

### Risks

Host-install tooling can become dangerously destructive if it guesses ownership or edits arbitrary
Nix config files heuristically.

### Mitigation

Use explicit managed install manifests, dedicated managed drop-in paths, dry-run support, and
fail-closed behavior for unsupported host layouts or unknown older versions.

### Consequence of Not Implementing

The `mini` slice would keep depending on tribal manual setup, making real host adoption fragile and
hard to reproduce safely across machines or over time.

### Downsides for Implementing

Adds host-operations complexity and version-compatibility surface area before the shared control
plane is fully in place.

### Recommendation

Implement before the shared-control-plane PR so real hosts can be brought under the reviewed
`nixos-shared-host` shape safely and repeatably.

---

## PR-4.5.1: Deployment-domain test labels + reviewed ownership boundary for verify scoping

### Description

I will make deployment-only verify scoping possible without relying on loose path heuristics by
first establishing an explicit reviewed deployment domain. This PR introduces the first deployment
test taxonomy and the narrow ownership boundary that later selector logic can trust.

### Scope & Changes

- Add an explicit deployment-domain test label, for example:
  - `domain:deployment`
- Ensure deployment-owned tests under the reviewed deployment test area receive that label
  deterministically.
- Introduce the first reviewed deployment-owned path contract for verify policy purposes only.
- Keep the initial deployment-owned allowlist intentionally narrow and explicit, covering only paths
  that are owned by the deployment system rather than the general build system.
- Introduce the complementary reviewed shared-path set that must still broaden to full build-system
  verify, including:
  - shared verify tooling
  - shared Buck/lib/dev helpers
  - prelude, toolchains, and provider infrastructure
  - root Buck/Nix config files
- Add fail-closed guardrails for taxonomy drift:
  - deployment-owned tests must carry the deployment-domain label
  - non-deployment tests must not acquire the deployment-domain label accidentally
- Keep this PR non-executing:
  - no new verify selector behavior yet
  - no deployment-only skipping of the broad build-system suite yet

### Tests (in this PR)

- Add Buck label/cquery tests proving deployment-owned tests are queryable by the reviewed
  deployment-domain label.
- Add policy tests proving reviewed deployment-owned test files are labeled and reviewed
  non-deployment test files are not.
- Add contract tests proving the reviewed shared-path set stays out of the deployment-owned domain.
- Add fail-closed tests proving taxonomy drift is rejected with actionable diagnostics.

### Docs (in this PR)

- Document the reviewed deployment-domain test label and its intended use.
- Document the first reviewed deployment-owned path boundary for verify scoping.
- Document the explicit non-goal that shared build-system paths remain on the full build-system
  verify path.

### Verification Commands

- `buck2 test //...`
- deployment label inspection commands introduced in this PR

### Expected Regression Scope

- `build-system only`
- This PR changes shared test-target generation, verify policy metadata, and related tests. Under the
  current verify policy, default `v` / CI therefore runs the full build-system verify scope.

### Acceptance Criteria

- Deployment-owned tests are queryable through one reviewed Buck label.
- The reviewed deployment-owned boundary is explicit and test-enforced.
- Shared build-system paths are still clearly outside the deployment-only domain.
- The repo has enough explicit metadata to build a fail-closed deployment selector later.

### Risks

If the first deployment-domain boundary is too broad, later deployment-only scoping can silently
skip important non-deployment build-system coverage.

### Mitigation

Keep the allowlist intentionally small, test the negative cases, and require explicit reviewed
labels rather than implicit directory guesses alone.

### Consequence of Not Implementing

Any later deployment-only selector would be forced to guess which tests and paths belong to the
deployment system.

### Downsides for Implementing

Adds taxonomy and maintenance overhead before any verify-runtime savings are visible.

### Recommendation

Implement first so later selector logic rests on explicit reviewed ownership instead of inference.

---

## PR-4.5.2: Fail-closed deployment-impact classifier for `deployment-only` versus full build-system changes

### Description

I will introduce the conservative changed-path classifier that decides whether a change is truly
deployment-only or must still run the full build-system suite. This PR remains intentionally
fail-closed: any ambiguity, shared-path touch, or unknown build-tools path still broadens back to
the current full build-system behavior.

### Scope & Changes

- Add a reviewed deployment-impact classifier over changed repo paths.
- Introduce stable classifier modes for the new policy, for example:
  - `deployment-only`
  - `deployment-and-project-impact`
  - `mixed-build-system`
  - `no-deployment-impact`
- Classify a change as `deployment-only` only when every relevant build-system-owned path is inside
  the reviewed deployment-owned allowlist from PR-4.5.1.
- Treat any touch to reviewed shared paths as an immediate full build-system broadening condition.
- Treat any unknown or unowned `build-tools` path as an immediate full build-system broadening
  condition.
- Recognize deployment project declarations under `projects/deployments/**` as deployment-related
  inputs for selector diagnostics and later union behavior.
- Emit stable diagnostics describing:
  - changed paths
  - deployment-owned paths
  - shared/full-build-system trigger paths
  - project paths
  - classifier mode and reason
- Keep this PR non-executing:
  - the classifier is inspectable and testable
  - default `v` / CI behavior remains unchanged until the next PR

### Tests (in this PR)

- Add classifier tests for safe `deployment-only` changes confined to the reviewed deployment-owned
  allowlist.
- Add tests proving any touch to shared helpers, verify tooling, prelude, toolchains, providers, or
  root Buck/Nix files broadens to the full build-system mode.
- Add fail-closed tests for unknown `build-tools` paths and ambiguous ownership.
- Add diagnostics snapshot tests locking the classifier's stable JSON output.
- Add tests covering deployment package paths under `projects/deployments/**` and their interaction
  with deployment-owned build-system paths.

### Docs (in this PR)

- Document the deployment-impact classifier modes and decision order.
- Document the fail-closed rule that any ambiguity or shared-path touch broadens to full
  build-system verify.
- Document the meaning of deployment-related `projects/deployments/**` changes in the new policy.

### Verification Commands

- `buck2 test //...`
- deployment-impact inspection or explain commands introduced in this PR

### Expected Regression Scope

- `build-system only`
- This PR changes verify selection policy code and shared path-classification helpers. Under the
  current verify policy, default `v` / CI therefore runs the full build-system verify scope.

### Acceptance Criteria

- The repo can classify a change as safely `deployment-only` only when every relevant touched path is
  explicitly reviewed as deployment-owned.
- Any shared or ambiguous path broadens back to the existing full build-system behavior.
- The classifier emits stable diagnostics suitable for explain-selection, CI logs, and future policy
  debugging.

### Risks

The classifier can become unsafely permissive if it tries to "help" by inferring ownership for
paths that were never explicitly reviewed.

### Mitigation

Fail closed on any unknown path, keep the ownership table explicit, and test all broadening
conditions directly.

### Consequence of Not Implementing

There is no safe mechanism to distinguish true deployment-only changes from broader build-system
changes.

### Downsides for Implementing

Adds another reviewed policy table that must be kept in sync as deployment code evolves.

### Recommendation

Implement second so execution wiring can depend on one conservative classifier instead of bespoke
fallback logic.

---

## PR-4.5.3: Verify/CI deployment-only execution path + deployment/project union semantics

### Description

I will wire the new deployment-only policy into `v` and CI so truly deployment-only changes can run
the reviewed deployment suite instead of the full non-deployment build-system suite, while any
shared-path impact still broadens immediately to the current full build-system behavior.

### Scope & Changes

- Add a first-class deployment test scope control, for example:
  - `BNX_DEPLOYMENT_TEST_SCOPE=auto|always|never`
- In `auto`, use the deployment-impact classifier from PR-4.5.2.
- Add verify execution behavior:
  - `deployment-only`: run the deployment-domain Buck test targets plus a reviewed deployment safety
    floor
  - `deployment-and-project-impact`: run the union of the reviewed deployment suite and the existing
    project-impact selection
  - `mixed-build-system`: keep the current full build-system verify scope
  - `no-deployment-impact`: keep existing non-deployment selector behavior
- Add a reviewed deployment safety floor so deployment-only runs cannot silently become empty if the
  label set drifts.
- Add fail-fast guardrails for:
  - `always` requested when the change is not safely `deployment-only`
  - zero resolved deployment-domain test targets
  - zero deployment safety-floor targets
- Keep cheap policy and lint preflight behavior intact where appropriate; only the heavy Buck test
  scope is narrowed for safe deployment-only changes.
- Extend explain-selection output so operators and CI can see whether deployment-only or full
  build-system verify was chosen and why.

### Tests (in this PR)

- Add verify policy tests proving safe deployment-only changes select the reviewed deployment suite.
- Add tests proving deployment-plus-project changes select the reviewed union of deployment scope and
  project-impact scope.
- Add tests proving any shared-path or ambiguous-path change still falls back to the full
  build-system verify scope.
- Add tests for `always` and `never` control behavior, including actionable diagnostics on
  misclassification.
- Add integration-style selection tests proving the deployment-domain Buck query and deployment
  safety floor resolve to stable non-empty targets.

### Docs (in this PR)

- Document the new deployment test scope control and selection behavior.
- Document the distinction between:
  - safe deployment-only changes
  - deployment-plus-project changes
  - full build-system fallback
- Document the operator expectation that touching any non-deployment build-system path still triggers
  the full build-system verify suite.

### Verification Commands

- `buck2 test //...`
- deployment-aware `v --explain-selection` or equivalent verify commands introduced in this PR

### Expected Regression Scope

- `build-system only`
- This PR changes verify execution wiring and selector integration in shared tooling. Under the
  current verify policy, default `v` / CI therefore runs the full build-system verify scope while
  this behavior is being introduced.

### Acceptance Criteria

- Safe deployment-only changes can run the reviewed deployment suite instead of the heavy
  non-deployment build-system suite.
- Deployment-plus-project changes run the reviewed union of deployment coverage and project-impact
  coverage.
- Any shared build-system impact still broadens to the existing full build-system verify path.
- Explain-selection and CI logs make the policy decision auditable.

### Risks

Selector wiring is where a sound classifier can still become unsafe if execution broadens or
narrows the wrong scope.

### Mitigation

Keep the deployment-only path opt-in-able, fail fast on empty deployment selections, and preserve
the current full build-system fallback whenever the classifier is not unquestionably safe.

### Consequence of Not Implementing

The repo would have a documented deployment-only policy boundary but no actual verify/CI execution
path that uses it.

### Downsides for Implementing

Adds another selector path to verify/CI and more policy diagnostics to maintain.

### Recommendation

Implement third so the deployment-only policy becomes useful in practice only after labels,
ownership, and fail-closed classification are already in place.

---

## PR-4.6: Profile-aware remote target resolution + deploy-plan contract for direct `nixos-shared-host` flows

### Description

I will make the reviewed dev-machine install manifest actionable by deploy-side tooling instead of
leaving it as recorded metadata only. This PR introduces a narrow, explicit remote-target contract
for the current direct-mutation `nixos-shared-host` flow without claiming to satisfy the later
shared-control-plane design.

### Scope & Changes

- Teach the deploy-side tooling to read the reviewed `nixos-shared-host` client manifest produced by
  the installer from PR-4.5.
- Add explicit remote-target selection by named profile, for example `--profile mini`, or an
  equivalent reviewed selector surface.
- Define and enforce precedence rules between:
  - profile-derived remote host metadata
  - explicit CLI overrides
- Add a reviewed non-mutating dry-run / plan mode that prints:
  - selected deployment id and label
  - selected profile and destination
  - remote repo path
  - remote authoritative state path
  - remote runtime root
  - remote records root
  - selected artifact source contract
  - whether host apply is expected as a later step
- Fail closed on:
  - missing profile
  - malformed client manifest
  - unsupported reviewed transport mode
  - ambiguous or conflicting explicit overrides
- Keep this PR non-transporting and non-mutating:
  - no SSH execution yet
  - no remote artifact copy yet
  - no remote `nixos-rebuild switch` yet

### Tests (in this PR)

- Add profile-consumption tests proving deploy-side tooling reads the reviewed client manifest
  deterministically.
- Add tests for precedence and conflict behavior between profile-derived values and explicit CLI
  flags.
- Add dry-run / plan snapshot tests locking:
  - destination selection
  - remote path rendering
  - artifact selection summary
- Add fail-closed tests for:
  - missing profile
  - malformed manifest
  - unsupported transport mode

### Docs (in this PR)

- Document the reviewed remote-target profile contract for direct `nixos-shared-host` deploys.
- Document dry-run / plan output and how operators should use it before remote execution exists.
- Document that this remains an interim direct-mutation path and not the later shared-control-plane
  model.

### Verification Commands

- `buck2 test //...`
- the deploy dry-run / plan commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay within reviewed
  deployment-owned paths and deployment-domain tests. Under the deployment-only verify policy,
  default `v` / CI can run the reviewed deployment suite instead of the full non-deployment
  build-system verify scope.

### Acceptance Criteria

- Operators can select a reviewed remote `nixos-shared-host` target by profile without manually
  retyping the remote repo/state/runtime/records paths.
- The deploy-side tooling fails closed on profile drift or unsupported reviewed transport inputs.
- Dry-run / plan output is deterministic and suitable for both interactive operator use and CI
  preflight.

### Risks

If the profile contract is vague, later remote execution and CI work will inherit ambiguous path and
override behavior.

### Mitigation

Keep the profile surface narrow, deterministic, and explicit about precedence and unsupported modes.

### Consequence of Not Implementing

The reviewed dev-machine install manifest remains disconnected from actual deploy execution.

### Downsides for Implementing

Adds another reviewed contract surface before remote transport is actually available.

### Recommendation

Implement first in the interim remote-flow sequence so transport and CI layers can depend on one
stable profile contract.

---

## PR-4.7: Reviewed SSH transport + remote artifact staging for direct `mini` deploys

### Description

I will make the current `mini` shared-dev flow executable from outside the host by adding a reviewed
remote transport and exact-artifact staging path. This PR keeps the mutation model intentionally
narrow: it still runs the existing direct deploy on `mini`, but it no longer requires operators or
CI to shell into `mini` manually.

### Scope & Changes

- Add a reviewed remote execution path for the current direct `nixos-shared-host` deployment flow.
- Support at least one reviewed transport mode:
  - `ssh`
- Stage an explicit local artifact directory onto the remote host before remote deploy execution.
- Invoke the existing deploy implementation on the remote repo checkout using:
  - the staged remote artifact path
  - the remote authoritative state path
  - the remote runtime root
  - the remote records root
  - the selected deployment label
- Return a stable machine-readable deploy summary from the remote execution path.
- Keep remote repo checkout management out of scope:
  - the remote repo path must already exist
  - the tool must fail closed when the remote repo checkout is missing or unusable
- Keep host apply out of scope in this PR:
  - no automatic remote `nixos-rebuild switch` yet
- Add reviewed staged-artifact cleanup semantics for:
  - normal completion
  - explicit opt-in retention for debugging

### Tests (in this PR)

- Add transport command-assembly tests for the reviewed SSH path.
- Add fixture-based remote execution tests using an isolated fake remote root or reviewed local
  transport shim.
- Add integration tests proving:
  - local artifact is staged remotely
  - remote deploy runs against the staged artifact
  - remote records are written under the reviewed records root
- Add fail-closed tests for:
  - missing remote repo checkout
  - artifact staging failure
  - transport failure
  - remote deploy failure propagation

### Docs (in this PR)

- Document the reviewed direct remote deploy flow for `mini`.
- Document remote artifact staging and cleanup semantics.
- Document what this PR still does not do:
  - no host apply orchestration
  - no shared-control-plane authority

### Verification Commands

- `buck2 test //...`
- the remote deploy commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay in reviewed
  deployment-owned transport, staging, deploy-wrapper, and deployment-domain test code. Under the
  deployment-only verify policy, default `v` / CI can run the reviewed deployment suite instead of
  the full non-deployment build-system verify scope.

### Acceptance Criteria

- A developer machine can stage a Pleomino artifact to `mini` and run the reviewed direct deploy
  flow without an interactive manual SSH session.
- The remote execution path produces a stable machine-readable result and fails closed on transport,
  staging, or remote deploy errors.
- The implementation reuses the existing direct deploy on `mini` rather than introducing a second
  mutation path.

### Risks

Remote execution can accidentally become a hidden second deploy implementation instead of a transport
wrapper around the existing one.

### Mitigation

Keep the remote layer transport-only: stage the artifact, invoke the existing deploy, return the
result, and avoid duplicating deploy semantics.

### Consequence of Not Implementing

Operators and CI would still need ad hoc manual SSH sessions to use the current `mini` slice from
outside the host.

### Downsides for Implementing

Adds transport, staging, and remote-error-surface complexity before the shared control plane exists.

### Recommendation

Implement second so the direct `mini` slice becomes remotely usable before host apply and CI polish
are layered on top.

---

## PR-4.8: Reviewed remote host-apply orchestration for managed `nixos-shared-host`

### Description

I will close the largest remaining operator gap in the interim direct path by adding a reviewed host
apply step for managed `nixos-shared-host` instances. This PR makes the remote flow feel complete
for `mini` while still staying intentionally outside the later shared-control-plane model.

### Scope & Changes

- Add a reviewed remote host-apply step that can run after a successful remote deploy.
- Support an explicit operator-controlled apply mode, for example:
  - `--apply-host`
  - or a separate reviewed apply subcommand
- Execute the reviewed host apply against the managed `nixos-shared-host` configuration on the
  selected remote host.
- Require explicit opt-in for host apply:
  - remote deploy without apply remains allowed
  - host apply must not happen implicitly by ambient defaults
- Add reviewed preflight checks before host apply:
  - server is managed
  - expected managed wiring is present or inspectable
  - required remote config paths exist
- Add dry-run support for the host-apply step.
- Keep scope limited to the current managed `nixos-shared-host` path:
  - no generic multi-provider apply abstraction yet
  - no control-plane admission/approval semantics yet

### Tests (in this PR)

- Add host-apply command-assembly tests for the reviewed remote path.
- Add fixture-based tests proving host apply:
  - is opt-in
  - fails closed when the host is unmanaged
  - fails closed when managed wiring is missing
  - respects dry-run
- Add integration-style tests for remote deploy plus remote apply using isolated fixture hosts or
  reviewed command shims instead of mutating a live system.
- Add failure-propagation tests proving apply errors remain visible and do not silently report deploy
  success.

### Docs (in this PR)

- Document the reviewed remote host-apply step for managed `nixos-shared-host` instances.
- Document the required operator preconditions for remote apply.
- Document the distinction between:
  - remote deploy
  - remote host apply
  - the later shared-control-plane model

### Verification Commands

- `buck2 test //...`
- the remote host-apply commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay within reviewed
  deployment-owned host-apply orchestration, preflight logic, and deployment-domain fixture
  coverage. Under the deployment-only verify policy, default `v` / CI can run the reviewed
  deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- A developer machine can complete the current direct Pleomino-to-`mini` flow without a second
  manual SSH step to run `nixos-rebuild switch`.
- Host apply is explicit, dry-runnable, and fail-closed on unmanaged or drifted hosts.
- The implementation remains limited to the current managed `nixos-shared-host` slice and does not
  pretend to satisfy shared-control-plane requirements.

### Risks

Remote host apply is the riskiest direct-mutation convenience step because it touches real host
state.

### Mitigation

Require explicit opt-in, preflight checks, dry-run support, and fixture-based testing rather than
making host apply an implicit side effect of every remote deploy.

### Consequence of Not Implementing

The remote flow would still require a hand-run host-apply step, which keeps Jenkins and dev-machine
automation incomplete.

### Downsides for Implementing

Adds more host-operations logic to an interim path that the later shared-control-plane model will
partially supersede.

### Recommendation

Implement third so the interim direct remote flow is actually complete for real Pleomino-to-`mini`
use.

---

## PR-4.9: Jenkins-ready direct remote deploy flow for Pleomino `dev` on `mini`

### Description

I will package the reviewed direct remote flow into a CI-usable, non-interactive operator surface so
Pleomino can be deployed to `mini` from Jenkins before the later shared-control-plane path exists.
This PR is intentionally narrow and explicitly interim: it standardizes the current direct remote
flow for CI without redefining it as the final shared deployment model.

### Scope & Changes

- Add a reviewed CI-friendly entrypoint or wrapper around the remote direct deploy path introduced in
  PR-4.6 through PR-4.8.
- Make the CI entrypoint explicitly non-interactive and machine-readable.
- Define the minimum reviewed Jenkins contract:
  - remote destination/profile selection
  - artifact input path
  - whether host apply is required
  - required SSH credential and host-key expectations
  - required remote repo checkout expectations
- Add reviewed JSON output suitable for Jenkins parsing and post-step reporting.
- Add a concrete Pleomino `dev` example flow for `mini`.
- Keep scope limited to the current direct path:
  - no shared-control-plane submission
  - no admission or locking
  - no Cloudflare or multi-environment promotion

### Tests (in this PR)

- Add CI-entrypoint contract tests proving the flow is non-interactive.
- Add fail-closed tests for:
  - missing required artifact input
  - missing required credential or host metadata
  - incompatible flag combinations
- Add fixture-based integration tests proving the CI wrapper can:
  - stage the Pleomino artifact
  - run the remote direct deploy
  - optionally run host apply
  - emit stable JSON results

### Docs (in this PR)

- Document the reviewed Jenkins flow for deploying Pleomino `dev` to `mini`.
- Document the minimum CI prerequisites and non-goals.
- Document that this CI path is an interim direct-mutation route pending the later shared-control-plane
  implementation.

### Verification Commands

- `buck2 test //...`
- the Jenkins-oriented direct deploy commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should package the existing Pleomino
  `dev` target into a CI-facing deployment wrapper without touching shared build-system paths or new
  project-owned deployment metadata. Under the deployment-only verify policy, default `v` / CI can
  run the reviewed deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Jenkins can deploy Pleomino `dev` to `mini` through a reviewed non-interactive flow using the
  direct remote path.
- The CI-facing contract is explicit, machine-readable, and fail-closed on missing inputs.
- The documented operator expectations match the implemented CI entrypoint and tests.

### Risks

There is pressure to treat the first working Jenkins path as "good enough" and never return to the
shared-control-plane design.

### Mitigation

Keep the CI flow explicitly documented as an interim direct path and ensure the wrapper reuses the
same reviewed remote layers instead of creating provider-local CI-only semantics.

### Consequence of Not Implementing

The current `mini` slice could be used manually or semi-manually, but not through one reviewed CI
entrypoint for Pleomino.

### Downsides for Implementing

Adds CI-facing surface area that will later need to be realigned with the shared-control-plane
submission path.

### Recommendation

Implement fourth so teams can use a reviewed Pleomino-to-`mini` CI path while PR-5 and later
control-plane work are still pending.

---

## PR-5: Shared control-plane skeleton + admission, locking, and authority rules for `shared_nonprod`

### Description

I will establish the shared-control-plane authority boundary for `shared_nonprod` deployments and
move the `mini` shared-dev flow under that authority. This PR focuses on admission, locking, and
reviewed execution boundaries rather than advanced artifact replay.

### Scope & Changes

- Introduce the first shared control-plane API and worker skeleton for mutating shared deployments.
- Require `nixos-shared-host` `shared_nonprod` mutation to execute through the shared control plane.
- Implement lock acquisition on canonical provider-target identity for `nixos-shared-host`.
- Implement the first admission flow for shared-dev `deploy` and `explicit removal`.
- Freeze an execution snapshot with the deployment metadata and provider-target identity needed for
  the implemented flows.
- Ensure direct local mutation of `mini` shared-dev targets is out of policy for the normal path.
- Move the existing end-to-end `mini` static-webapp deploy flow to submit through this shared path.

### Tests (in this PR)

- Add admission tests for:
  - allowed `shared_nonprod` submission
  - rejected direct local mutation path
  - lock conflict on the same `mini` target
- Add execution-snapshot tests proving required metadata is frozen before mutation.
- Extend the `mini` end-to-end flow to assert control-plane submission, locking, and recorded
  execution-snapshot references.

### Docs (in this PR)

- Document the first shared-control-plane path for `mini` shared-dev deployments.
- Document locking behavior and conflict expectations.
- Document the shared-environment authority rule for `nixos-shared-host`.

### Verification Commands

- `buck2 test //...`
- the shared-control-plane submission command sequence introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should land in reviewed
  deployment-owned control-plane, locking, admission, and deployment-domain test infrastructure
  while reusing existing deployment packages. Under the deployment-only verify policy, default `v`
  / CI can run the reviewed deployment suite instead of the full non-deployment build-system verify
  scope.

### Acceptance Criteria

- `mini` shared-dev deploys run through a reviewed shared control-plane path.
- The system acquires canonical provider-target locks before mutation.
- Shared-environment authority rules are enforced and covered by tests.

### Risks

This is the first point where convenience pressure may push toward bypassing the shared execution
boundary.

### Mitigation

Keep the implemented `mini` path narrow and fully routed through the same reviewed API and worker
surface that later providers will use.

### Consequence of Not Implementing

The first production-like shared environment would remain inconsistent with the design's authority
model.

### Downsides for Implementing

Adds operational infrastructure and more moving parts to a flow that was already working locally.

### Recommendation

Implement now so the first working `mini` flow does not become entrenched as an exception.

---

## PR-6: Immutable artifact selection + provenance store + replay snapshot baseline

### Description

I will add the first immutable artifact and replay-snapshot baseline so the shared control plane can
re-run shared deployments from recorded artifact identity rather than ambient local build state.

### Scope & Changes

- Implement artifact identity capture for the existing static-webapp deployment path.
- Add the first artifact/provenance store integration for admitted artifact references.
- Implement replay-snapshot persistence for the existing `mini` path:
  - artifact refs
  - provider-target identity
  - deployment metadata fingerprint
  - provider-config or host-state snapshot references where relevant
- Add exact-artifact publish input support for the current provider family.
- Ensure publisher paths consume resolved artifacts rather than rebuilding implicitly.

### Tests (in this PR)

- Add tests proving replay snapshots preserve the required artifact and target identity fields.
- Add tests rejecting rebuild-on-replay behavior for the implemented shared path.
- Extend the `mini` end-to-end flow to assert replay input can resolve an already recorded artifact.

### Docs (in this PR)

- Document the first replay-snapshot contract slice.
- Document exact-artifact semantics for the implemented `mini` path.
- Document the separation between reusable artifact provenance and deployment-run records.

### Verification Commands

- `buck2 test //...`
- artifact-resolution or replay-inspection commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay in reviewed
  deployment-owned artifact selection, provenance, replay persistence, and deployment-domain tests.
  Under the deployment-only verify policy, default `v` / CI can run the reviewed deployment suite
  instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Shared deploys preserve exact artifact identity and a replay snapshot suitable for reuse.
- The implemented shared path no longer depends on ambient workstation build state for replay.
- Tests prove replay fails closed when exact artifact identity cannot be resolved.

### Risks

Artifact identity and host-state identity can drift if captured from different sources.

### Mitigation

Bind replay snapshots to canonical deployment metadata, provider-target identity, and resolved
artifact refs from the same admitted run.

### Consequence of Not Implementing

Retry and rollback behavior would have to guess from current repo state instead of replaying the
recorded run.

### Downsides for Implementing

Introduces more persistence and artifact-store plumbing before advanced reuse flows are exposed.

### Recommendation

Implement before retry and rollback so reuse behavior starts from exact recorded artifacts.

---

## PR-7: `retry`, `publish-only`, and same-deployment `rollback` for `mini` shared-dev static webapps

### Description

I will extend the now-recorded and replayable `mini` shared-dev path with the first immutable-reuse
operator flows: retry, exact-artifact publish-only, and same-deployment rollback.

### Scope & Changes

- Implement canonical run classification for:
  - `retry`
  - `rollback`
  - shared `--publish-only`
- Require exact artifact or source-run selection for shared replay paths.
- Implement same-deployment rollback candidate selection for the implemented `mini` path.
- Replay from the recorded snapshot rather than today's repo state.
- Preserve parent-run and artifact-lineage relationships in deployment records.

### Tests (in this PR)

- Add tests rejecting:
  - ambiguous shared `--publish-only`
  - rollback without explicit source-run selection
  - replay that would rebuild implicitly
- Add end-to-end tests for:
  - retry of a prior failed or interrupted `mini` deploy
  - exact-artifact publish-only to an existing `mini` target
  - rollback to a prior known-good `mini` run
- Add tests asserting lineage fields are recorded correctly.

### Docs (in this PR)

- Document operator semantics for retry, publish-only, and rollback on the implemented path.
- Document rollback selection and exact-artifact requirements.
- Document replay failure behavior when the recorded artifact is unavailable.

### Verification Commands

- `buck2 test //...`
- retry, rollback, and publish-only command flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should change replay/recovery logic and
  deployment-domain tests without adding new project-owned deployment packages or shared
  build-system path touches. Under the deployment-only verify policy, default `v` / CI can run the
  reviewed deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Shared retry, publish-only, and rollback work for `mini` static-webapp deployments.
- These flows consume recorded artifacts and replay snapshots rather than rebuilding.
- Tests cover success and fail-closed rejection paths.

### Risks

The first rollback implementation can quietly weaken identity or artifact requirements if it is too
operator-friendly.

### Mitigation

Require explicit source-run or exact-artifact selection and reject any replay path that cannot prove
artifact identity and target compatibility.

### Consequence of Not Implementing

The first shared deployment target would have no safe recovery or replay path.

### Downsides for Implementing

Adds operator-facing complexity and more negative validation cases.

### Recommendation

Implement while the `mini` path is still the narrowest shared provider family.

---

## PR-7.1: Rollback-candidate hardening + deployment-domain test modularization

### Description

I will close the first contract gap discovered after PR-7 lands: same-deployment rollback must
fail closed to prior successful normal runs instead of accepting any successful replay-shaped run.
This follow-up also removes deployment-domain methodology drift by modularizing oversized remote
execution coverage without reducing the reviewed behavior surface.

### Scope & Changes

- Tighten same-deployment rollback source selection for the implemented `mini` path so rollback
  candidates must be:
  - the same deployment id
  - target-compatible under the existing replay checks
  - prior successful normal publish runs for the same normal live target
- Reject rollback candidates sourced from runs classified as:
  - `retry`
  - `rollback`
  - `explicit removal`
- Keep shared `retry` behavior unchanged for the reviewed same-deployment immutable-reuse slice.
- Improve fail-closed rollback diagnostics so operators can see whether rejection came from:
  - non-success final outcome
  - wrong run classification
  - deployment or target incompatibility
- Keep rollback selection derived from durable records and replay snapshots rather than recency or
  "latest known good" heuristics.
- Split oversized deployment-owned remote-execution test coverage into smaller reviewed modules or
  helpers so the deployment test area stays within repo methodology file-size expectations without
  dropping coverage.

### Tests (in this PR)

- Add tests rejecting rollback sourced from:
  - a prior successful `retry`
  - a prior successful `rollback`
  - an `explicit removal` run
  - a non-successful run
- Add regression tests proving same-deployment source-run reuse stays distinct between:
  - `retry`
  - `rollback`
- Keep end-to-end rollback coverage for:
  - restoring a prior known-good exact artifact
  - failing closed when the chosen source run is not an eligible rollback candidate
- Preserve the existing reviewed remote deploy and host-apply coverage while modularizing the test
  files that currently exceed the methodology size target.

### Docs (in this PR)

- Document that same-deployment rollback candidates are limited to prior successful normal runs for
  the same deployment.
- Document explicitly that successful `retry` and `rollback` runs are not valid default rollback
  sources.
- Document that this PR is a contract-hardening follow-up to PR-7 rather than a new deploy feature
  slice.

### Verification Commands

- `buck2 test //...`
- retry, rollback, and replay command flows introduced in PR-7

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay within reviewed
  deployment-owned replay-selection logic, deployment-domain tests, and related docs. Under the
  deployment-only verify policy, default `v` / CI can run the reviewed deployment suite instead of
  the full non-deployment build-system verify scope.

### Acceptance Criteria

- Same-deployment rollback accepts only prior successful normal runs for the same deployment.
- Successful `retry`, `rollback`, and `explicit removal` runs are rejected as rollback sources with
  actionable diagnostics.
- The reviewed deployment-domain remote-execution coverage remains behaviorally intact while the
  file-size methodology drift in that test area is removed.

### Risks

Tightening rollback eligibility can break informal operator expectations if anyone was implicitly
treating any successful replay-shaped run as rollback-safe.

### Mitigation

Keep the correction narrow, fail closed with explicit diagnostics, and align tests plus docs to the
same rollback-candidate rule in the same PR.

### Consequence of Not Implementing

The repo would keep a rollback path that is looser than its reviewed contract, and deployment-owned
test coverage would continue to drift from the methodology file-size standard.

### Downsides for Implementing

This is primarily a hardening and modularization PR, so it adds review work without expanding the
operator feature surface.

### Recommendation

Implement immediately after PR-7 so later admission and promotion work builds on a strict rollback
contract instead of preserving an overly permissive replay precedent.

---

## PR-8: Branch-backed `lane_policy` + source admission + target-environment run admission

### Description

I will add the core branch-backed lane model and explicit two-stage admission flow that the main
deployment design requires for protected/shared deployments.

### Scope & Changes

- Implement `lane_policy` resolution for protected/shared deployments.
- Implement source admission:
  - admissible revision selection
  - trusted artifact input selection
- Implement target-environment run admission:
  - freeze target-environment execution snapshot before mutation
- Bind the current `mini` shared-dev path to this admission structure where applicable.
- Record lane-policy and admission-policy references or fingerprints in run records and replay
  snapshots.

### Tests (in this PR)

- Add lane-policy resolution tests.
- Add admission tests for:
  - source revision eligibility
  - target-environment snapshot freezing
  - out-of-policy source-run reuse rejected
- Extend the implemented shared provider tests to assert two-stage admission records and frozen
  snapshots.

### Docs (in this PR)

- Document the two-stage admission flow and how it fits shared environments.
- Document how source admission and target-environment run admission differ.
- Document the first implemented lane-policy contract slice.

### Verification Commands

- `buck2 test //...`
- admission and lane-policy inspection commands introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to touch shared
  build-system surfaces in addition to deployment work, because protected/shared deployments likely
  need new reviewed metadata fields and target-definition/extraction support as well as concrete
  deployment declarations. Under the deployment-only verify policy, default `v` / CI must still run
  the full build-system verify scope.

### Acceptance Criteria

- Protected/shared runs use explicit source and target-environment admission stages.
- Lane-policy resolution and admission references are persisted in records.
- Tests prove the system rejects reuse outside current lane policy.

### Risks

Admission semantics are easy to describe loosely and hard to retrofit precisely later.

### Mitigation

Land explicit frozen-snapshot and lane-policy references before promotion broadens provider support.

### Consequence of Not Implementing

The shared deployment flow would still lack the design's intended branch-backed admission guarantees.

### Downsides for Implementing

Adds substantial policy machinery before broader provider support is available.

### Recommendation

Implement before cross-environment promotion and more advanced provider support.

---

## PR-9: Cloudflare Pages provider slice + Pleomino staging/prod deployment packages

### Description

I will implement the first non-`mini` protected/shared provider slice using Cloudflare Pages and
land the concrete Pleomino deployment packages needed for a real shared `staging` and `prod` flow.
This PR is the first half of the secondary milestone: getting static-webapp deploys to Cloudflare
Pages in the same deployment system rather than only on `mini`.

### Scope & Changes

- Implement the first non-`mini` built-in provider capability entry for `static-webapp`:
  - `cloudflare-pages`
- Implement canonical provider-target identity normalization for Cloudflare Pages.
- Implement the first built-in Cloudflare Pages publisher and smoke runner.
- Add concrete deployment packages for Pleomino:
  - `pleomino-dev` on `nixos-shared-host` remains the shared-dev path
  - `pleomino-staging` on `cloudflare-pages`
  - `pleomino-prod` on `cloudflare-pages`
- Add provider-native config generation or validation rules so Cloudflare target identity stays
  derived from authoritative deployment metadata.
- Reuse the shared control-plane, artifact, record, and admission machinery from earlier PRs.
- Keep scope limited to single-component `static-webapp`, normal deploy, and blocking smoke.

### Tests (in this PR)

- Add Cloudflare Pages provider-capability contract tests.
- Add validation tests for Pleomino staging/prod deployment metadata and canonical target identity.
- Add end-to-end deploy tests for the Cloudflare Pages static-webapp path using admitted exact
  artifacts.
- Add smoke-blocking tests for the Cloudflare Pages public target behavior.
- Add tests rejecting provider-config drift where deployment metadata and provider-native config
  disagree on target identity.

### Docs (in this PR)

- Document the Cloudflare Pages provider capability and publisher contract.
- Document Pleomino's initial `dev -> staging -> prod` topology:
  - `dev` on `mini`
  - `staging` and `prod` on Cloudflare Pages
- Document provider-target identity rules and smoke expectations for Cloudflare Pages.

### Verification Commands

- `buck2 test //...`
- Cloudflare Pages deploy verification commands introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to combine new
  provider/control-plane code with concrete Pleomino `projects/deployments/...` packages and the
  reviewed shared build-system surface needed to declare and extract the new provider slice. Under
  the deployment-only verify policy, default `v` / CI must still run the full build-system verify
  scope.

### Acceptance Criteria

- One provider beyond `mini` works end to end for the supported shared/protected static-webapp path.
- Pleomino has concrete `dev`, `staging`, and `prod` deployment packages wired into the deployment
  system.
- The implementation reuses the general control-plane machinery instead of provider-local shortcuts.
- Provider-target identity, smoke, and artifact handling are covered by tests in the same PR.

### Risks

The first external provider can tempt us to add provider-local exceptions that later undermine the
general model.

### Mitigation

Keep the provider slice narrow and make capability rules explicit in tests and docs.

### Consequence of Not Implementing

The deployment system would remain unproven as a general multi-provider model and would not support
the first real Pleomino higher-environment path.

### Downsides for Implementing

This adds real provider complexity and provider-specific failure modes.

### Recommendation

Implement after the shared-control-plane and immutable-reuse foundations are in place so the second
milestone lands on the same rails as the first.

---

## PR-10: Pleomino `dev -> staging -> prod` promotion flow on exact static-webapp artifacts

### Description

I will implement promotion across the concrete Pleomino deployment ids so the secondary
intermediate goal is fully met: one exact static-webapp artifact can move from `dev` evidence
through `staging` and `prod` using the repository's default `same_artifact` model.

### Scope & Changes

- Implement promotion classification for Pleomino across distinct deployment ids in compatible lanes.
- Reuse the exact admitted artifact across Pleomino deployments where lane policy allows
  `same_artifact`.
- Add promotion eligibility checks against current branch-backed lane state.
- Record:
  - `parent_run_id`
  - `release_lineage_id`
  - `artifact_lineage_id`
- Ensure promotion uses the source run's artifact and source snapshot evidence while still freezing a
  new target-environment execution snapshot for the promoted deployment.
- Prove the complete Pleomino `dev -> staging -> prod` operator path through the shared deployment
  system.

### Tests (in this PR)

- Add tests rejecting:
  - promotion across incompatible lanes
  - promotion from retained but no-longer-eligible source runs
  - promotion that would retarget one deployment dynamically instead of using a distinct deployment id
- Add end-to-end promotion tests across Pleomino `dev`, `staging`, and `prod` using one exact
  artifact.
- Add lineage tests proving artifact and release lineage fields are recorded correctly.
- Add smoke-gated tests proving promotion halts when the staged environment does not satisfy its
  blocking checks.

### Docs (in this PR)

- Document same-artifact promotion semantics using the concrete Pleomino `dev -> staging -> prod`
  example.
- Document the distinction between source-run evidence and target-environment admission.
- Document lineage field meanings for promotion runs.

### Verification Commands

- `buck2 test //...`
- Pleomino promotion command flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should add promotion logic on top of the
  Pleomino deployment packages already introduced earlier without touching shared build-system
  paths. Under the deployment-only verify policy, default `v` / CI can run the reviewed deployment
  suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Pleomino can move through a real `dev -> staging -> prod` flow using exact static-webapp artifacts.
- Promotion respects current lane-policy eligibility and records lineage correctly.
- Tests cover both success and fail-closed promotion paths.

### Risks

Promotion semantics are easy to blur with retargeting or rebuild-per-stage behavior.

### Mitigation

Keep this PR limited to `same_artifact` only and reject any path that looks like dynamic retargeting.

### Consequence of Not Implementing

The secondary milestone would remain incomplete because Pleomino would still lack a real higher-
environment promotion path.

### Downsides for Implementing

Adds more record, policy, and operator-surface complexity.

### Recommendation

Implement immediately after Cloudflare Pages deploy support so the second milestone is reached as
early as safely possible.

---

## PR-11: Generalized cross-deployment promotion with `artifact_reuse_mode = "same_artifact"`

### Description

I will generalize the Pleomino-specific promotion path into provider-agnostic cross-deployment
promotion support for all compatible lanes using the repository's default `same_artifact` model.

### Scope & Changes

- Implement promotion classification for distinct deployment ids in compatible lanes.
- Reuse the exact admitted artifact across deployments where lane policy allows `same_artifact`.
- Add promotion eligibility checks against current branch-backed lane state.
- Record:
  - `parent_run_id`
  - `release_lineage_id`
  - `artifact_lineage_id`
- Ensure promotion uses the source run's artifact and source snapshot evidence while still freezing a
  new target-environment execution snapshot for the promoted deployment.

### Tests (in this PR)

- Add tests rejecting:
  - promotion across incompatible lanes
  - promotion from retained but no-longer-eligible source runs
  - promotion that would retarget one deployment dynamically instead of using a distinct deployment id
- Add end-to-end promotion tests across two deployment ids using one exact artifact.
- Add lineage tests proving artifact and release lineage fields are recorded correctly.

### Docs (in this PR)

- Document same-artifact promotion semantics and lane eligibility rules.
- Document the distinction between source-run evidence and target-environment admission.
- Document lineage field meanings for promotion runs.

### Verification Commands

- `buck2 test //...`
- promotion command flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should generalize promotion behavior in
  reviewed deployment-owned control-plane code and deployment-domain tests without touching shared
  build-system surfaces. Under the deployment-only verify policy, default `v` / CI can run the
  reviewed deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Promotion across distinct deployments works with exact artifact reuse.
- Promotion respects current lane-policy eligibility and records lineage correctly.
- Tests cover both success and fail-closed promotion paths.

### Risks

Promotion semantics are easy to blur with retargeting or rebuild-per-stage behavior.

### Mitigation

Keep this PR limited to `same_artifact` only and reject any path that looks like dynamic retargeting.

### Consequence of Not Implementing

The shared deployment model would still lack one of its core cross-environment workflows.

### Downsides for Implementing

Adds more record, policy, and operator-surface complexity.

### Recommendation

Implement before rebuild-per-stage and multi-component rollout so the default promotion model is
solid first.

---

## PR-12: Isolated preview publish + audited preview cleanup

### Description

I will implement preview as a publish mode with explicit isolated target identity and first-class
cleanup semantics, consistent with the main design.

### Scope & Changes

- Implement preview publish mode with explicit isolated preview target identity.
- Reject preview paths that try to reuse the normal mutable live target.
- Implement audited preview cleanup as a first-class control-plane operation.
- Preserve both normal declared provider-target identity and effective preview target identity in
  deployment records.
- Keep preview support limited to providers whose capability entries explicitly allow it.

### Tests (in this PR)

- Add tests rejecting:
  - preview that reuses the normal live target
  - preview cleanup without explicit preview identity
  - shared/protected preview replay paths that omit required source-run identity
- Add end-to-end preview publish and cleanup tests for one supported provider family.
- Add record tests for effective preview target identity preservation.

### Docs (in this PR)

- Document preview as a publish mode, not a deployment identity.
- Document preview cleanup semantics and required identity selection.
- Document provider support boundaries for preview behavior.

### Verification Commands

- `buck2 test //...`
- preview publish and cleanup commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay in reviewed
  deployment-owned provider-capability, preview lifecycle, cleanup, and record logic plus
  deployment-domain tests. Under the deployment-only verify policy, default `v` / CI can run the
  reviewed deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Preview uses explicit isolated target identity.
- Cleanup is audited, explicit, and covered by tests.
- Preview behavior remains provider-capability-gated and fail-closed.

### Risks

Preview is a common source of implicit side effects and target confusion.

### Mitigation

Model preview target identity explicitly and reject any provider path that cannot isolate it cleanly.

### Consequence of Not Implementing

Preview behavior would remain either unavailable or dangerously ad hoc.

### Downsides for Implementing

Adds more surface area for target identity, lifecycle, and cleanup handling.

### Recommendation

Implement after normal deploy, replay, and promotion semantics are stable.

---

## PR-12.1: Deployment-domain taxonomy ownership split + verify-scope hardening

### Description

I will remove the first recurring false broadening in the deployment-only verify path by moving the
mutable deployment-domain taxonomy data out of the shared test-definition surface and into the
reviewed deployment-owned boundary. The goal is to keep routine deployment test additions or renames
from kicking default `v` / CI back to the full build-system suite while preserving fail-closed
classification behavior.

### Scope & Changes

- Move the mutable reviewed deployment-domain ownership table into the reviewed deployment-owned test
  area under `build-tools/tools/tests/deployments/**`.
- Keep the shared zx-test loader stable:
  - `build-tools/tools/tests/defs.bzl` remains shared test infrastructure
  - root `TARGETS` remains shared test infrastructure
- Update deployment verify-scope classification so the new deployment-domain taxonomy file is
  treated as reviewed deployment-owned rather than an unclassified `build-tools/**` path.
- Keep fail-closed taxonomy behavior unchanged:
  - unclassified reviewed deployment tests still fail
  - reviewed non-deployment tests still must not acquire the deployment-domain label
- Avoid widening deployment ownership to the whole shared test-definition layer just to solve this
  one mutable taxonomy hotspot.

### Tests (in this PR)

- Add or extend boundary tests proving:
  - the moved deployment-domain taxonomy file is classified as reviewed deployment-owned
  - `build-tools/tools/tests/defs.bzl` remains classified as shared
- Add selector-policy tests proving a taxonomy-only change now resolves to `deployment-only`
  instead of `mixed-build-system`.
- Preserve taxonomy-drift tests proving unclassified reviewed deployment tests still fail closed.
- Preserve cquery label tests proving only reviewed deployment-domain tests acquire
  `domain:deployment`.

### Docs (in this PR)

- Document the split between:
  - shared zx-test loader infrastructure
  - deployment-owned taxonomy data for reviewed deployment-domain tests
- Document why routine deployment test additions no longer need to broaden default `v` / CI to the
  full build-system verify scope.
- Document the fail-closed ownership rule for the moved taxonomy data.

### Verification Commands

- `buck2 test //...`
- deployment verify-scope inspection and selection-explain commands touched in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to touch both the reviewed
  deployment-owned deployment-domain taxonomy data and the shared verify-scope classification logic
  that decides whether default `v` / CI can narrow safely. This PR should therefore run the full
  build-system verify scope once, so later deployment-only PRs can keep routine deployment test
  taxonomy edits inside the reviewed deployment-owned boundary.

### Acceptance Criteria

- Touching only the deployment-domain taxonomy data no longer classifies as `mixed-build-system`.
- Shared zx-test loader infrastructure remains outside the deployment-owned boundary.
- Reviewed deployment test classification still fails closed on drift or missing ownership entries.
- Verify-scope diagnostics clearly explain the new ownership boundary.

### Risks

Misclassifying shared test-definition infrastructure as deployment-owned could let a genuinely
cross-cutting build-system change bypass the full verify scope.

### Mitigation

Keep the shared loader and root test-definition entrypoints classified as shared, move only the
mutable deployment-domain taxonomy data, and cover the boundary with explicit classifier and
selection tests.

### Consequence of Not Implementing

Future deployment PRs that add, rename, or reclassify reviewed deployment tests will keep
unexpectedly triggering full build-system verify runs, which weakens the practical value of the
deployment-only verify policy.

### Downsides for Implementing

Adds one more ownership split between shared test-definition infrastructure and deployment-owned
taxonomy data.

### Recommendation

Implement immediately after PR-12 so later deployment-only PRs can rely on predictable verify-scope
behavior when they extend reviewed deployment-domain coverage.

---

## PR-13: `--from-changes` grouped submission + prerequisite graph orchestration

### Description

I will add grouped changed-based submission and prerequisite-aware orchestration so the system can
turn repo changes into auditable per-deployment runs without inventing a second source of truth.

### Scope & Changes

- Implement per-deployment run selection from repo changes.
- Add optional batch grouping while preserving per-deployment run identity.
- Implement explicit prerequisite graph evaluation from authoritative deployment metadata.
- Ensure orchestration still emits independent deployment records even when one CLI invocation
  triggers several runs.

### Tests (in this PR)

- Add tests for changed-based deployment selection.
- Add tests for prerequisite ordering and rejection of invalid graphs.
- Add grouped submission tests proving:
  - each deployment still gets its own run
  - grouping metadata is preserved for audit
  - failures remain attributable to individual runs

### Docs (in this PR)

- Document `--from-changes` semantics and limits.
- Document grouping versus per-deployment run identity.
- Document prerequisite graph expectations and operator-visible behavior.

### Verification Commands

- `buck2 test //...`
- changed-based submission commands introduced in this PR

### Expected Regression Scope

- `deployment-only`
- Assuming PR-4.5.1 through PR-4.5.3 and PR-12.1 are complete, this PR should live in reviewed
  deployment-owned change-selection/orchestration code and deployment-domain tests rather than
  shared build-system selector paths or shared deployment-taxonomy ownership files. Under the
  deployment-only verify policy, default `v` / CI can run the reviewed deployment suite instead of
  the full non-deployment build-system verify scope.

### Acceptance Criteria

- One changed-based invocation can produce auditable per-deployment runs.
- Prerequisite graphs are explicit, validated, and covered by tests.
- Grouping does not blur run identity or ownership.

### Risks

Change-based batching can easily turn into opaque automation if run identity is not preserved.

### Mitigation

Keep grouping additive and auditable while making per-deployment records the source of truth.

### Consequence of Not Implementing

The system would lack a scalable repo-wide submission path.

### Downsides for Implementing

Adds orchestration and audit complexity across multiple deployment ids.

### Recommendation

Implement once single-deployment flows and promotion semantics are stable.

---

## PR-14: Multi-component deployment baseline + rollout-policy enforcement

### Description

I will add the first multi-component deployment slice and enforce explicit rollout policy support so
the system can model larger deployments without drifting into ad hoc component ordering.

### Scope & Changes

- Implement canonical multi-component deployment metadata handling.
- Add component-kind resolution into canonical provider-neutral payload shapes.
- Implement rollout-policy resolution for supported provider/component combinations.
- Keep initial support narrow:
  - reviewed provider capabilities only
  - explicit rollout policy where required
- Preserve provider-target identity and record structure across multi-component runs.

### Tests (in this PR)

- Add validation tests rejecting unsupported multi-component shapes.
- Add rollout-policy tests proving ordering and failure semantics are explicit.
- Add end-to-end tests for one supported multi-component provider family slice.

### Docs (in this PR)

- Document the first supported multi-component slice and its rollout-policy constraints.
- Document the canonical component payload contract and provider limitations.
- Document failure and record semantics for ordered component publish behavior.

### Verification Commands

- `buck2 test //...`
- multi-component deploy verification commands introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to combine multi-component
  deployment machinery with at least one concrete reviewed deployment shape and the shared
  build-system surface needed to express that richer metadata shape. Under the deployment-only
  verify policy, default `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- At least one reviewed multi-component deployment shape is supported end to end.
- Unsupported shapes fail closed.
- Rollout semantics are explicit, tested, and documented in the same PR.

### Risks

Multi-component support can quickly become a loophole for provider-specific scripting.

### Mitigation

Require explicit provider capability and explicit rollout policy from the first supported slice.

### Consequence of Not Implementing

The deployment system would remain incomplete for larger systems described by the main design.

### Downsides for Implementing

Adds orchestration, failure handling, and record complexity.

### Recommendation

Implement after single-component promotion and preview semantics are stable.

---

## PR-15: `artifact_reuse_mode = "rebuild_per_stage"` + stage-specific admission path

### Description

I will implement the explicit `rebuild_per_stage` lane mode so the system can support environments
that require distinct admitted artifacts per stage without weakening the shared-protected contract.

### Scope & Changes

- Implement lane-policy support for `artifact_reuse_mode = "rebuild_per_stage"`.
- Preserve the one promoted source revision while producing stage-specific admitted artifacts.
- Require target-stage artifact build and admission before publish.
- Keep replay and record semantics explicit so this mode is not mistaken for same-artifact reuse.

### Tests (in this PR)

- Add lane-policy tests for `rebuild_per_stage`.
- Add tests rejecting attempts to treat rebuild-per-stage promotion as publish-only replay.
- Add end-to-end tests for one reviewed rebuild-per-stage promotion path.

### Docs (in this PR)

- Document rebuild-per-stage semantics and how they differ from same-artifact promotion.
- Document target-stage admission and artifact identity expectations.
- Document replay limitations and operator-facing differences.

### Verification Commands

- `buck2 test //...`
- rebuild-per-stage promotion commands introduced in this PR

### Expected Regression Scope

- `deployment-and-project-impact`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay within reviewed
  deployment-owned lane-policy/admission/promotion code while also adding at least one concrete
  deployment declaration to exercise the new lane mode, without touching shared build-system
  surfaces. Under the deployment-only verify policy, default `v` / CI can run the reviewed union of
  deployment coverage and project-impact coverage instead of the full build-system verify scope.

### Acceptance Criteria

- Rebuild-per-stage lanes work without weakening exact artifact identity or target-environment
  admission.
- The system rejects attempts to blur this mode into publish-only artifact reuse.
- Tests and docs cover the differences explicitly.

### Risks

This mode can silently weaken artifact provenance if it is treated as a minor variant of same-artifact
promotion.

### Mitigation

Make lane mode explicit in validation, records, and operator-facing commands from the start.

### Consequence of Not Implementing

The design would remain incomplete for environments that genuinely require stage-specific artifacts.

### Downsides for Implementing

Adds another branch of promotion and admission behavior that must stay coherent.

### Recommendation

Implement only after the default same-artifact path is stable and well tested.

---

## PR-16: Secrets, runtime config, release actions, and migration/alias exceptions closeout

### Description

I will complete the remaining cross-cutting operator and execution contracts that the design calls
out explicitly: secret and runtime-config declaration, reviewed built-in release actions, and
migration or alias exception support for controlled target ownership transitions. This closeout
work should preserve sliceability: reviewed built-in behavior may live in shared implementation
code, but project-specific declarations, policies, and exceptions should remain slice-owned and
referenced by label rather than being pulled into new centralized registries.

### Scope & Changes

- Implement secret-requirement and runtime-config-requirement validation and replay preservation.
- Implement reviewed built-in release-action support for protected/shared flows without requiring a
  centralized per-project registry.
- Implement migration or alias exception objects for controlled live-target ownership transitions.
- Enforce fail-closed handling when replay invariants no longer match current ownership or policy.
- Ensure deployment records preserve the required secret-free config and exception references.
- Keep release-action, migration, and alias-exception declarations slice-owned and label-addressable
  so unrelated deployments do not couple through shared instance registries.

### Tests (in this PR)

- Add validation tests rejecting undeclared runtime config and undeclared secret use.
- Add release-action tests for:
  - allowed built-in actions
  - replay behavior declarations
  - rollback compatibility checks where applicable
- Add migration/alias-exception tests proving:
  - controlled target transition is possible
  - replay fails when ownership has changed without an allowed exception

### Docs (in this PR)

- Document secret and runtime-config contract requirements.
- Document the first built-in release-action support and replay constraints.
- Document migration and alias exception semantics and operator expectations.

### Verification Commands

- `buck2 test //...`
- any release-action or migration verification commands introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this closeout PR is expected to touch both
  cross-cutting deployment/control-plane code and the shared build-system surface needed to declare
  new secret/config/release-action/migration metadata, along with concrete deployment declarations
  or exceptions. Under the deployment-only verify policy, default `v` / CI must still run the full
  build-system verify scope.

### Acceptance Criteria

- The remaining major cross-cutting design requirements are implemented and tested.
- Secret, config, release-action, and migration semantics are explicit and fail closed.
- Project-specific declarations and exceptions remain slice-owned; the solution does not introduce
  centralized registries that hurt sliceability.
- The system no longer relies on undocumented assumptions for protected/shared execution.

### Risks

These are cross-cutting features with broad reach, so late-stage drift is easy.

### Mitigation

Anchor each feature to explicit validation, replay, and record contracts in the same PR, and prefer
slice-owned label references over shared instance registries whenever project-specific control data
is introduced.

### Consequence of Not Implementing

The implementation would still fall short of the final deployment design's protected/shared
guarantees.

### Downsides for Implementing

This is broad closeout work touching many layers of the system.

### Recommendation

Implement last as the completeness pass that closes the remaining design gaps after the core flows
are stable.

---

## Recommended Work Order Summary

1. PR-1 through PR-3: get `mini` shared-dev static webapps working end to end on the final-model
   rails.
2. PR-4 through PR-4.5: add durable records and bring real `nixos-shared-host` instances under a
   reviewed install / uninstall model.
3. PR-4.5.1 through PR-4.5.3: add the fail-closed deployment-only verify policy so deployment
   system changes can avoid the heavy non-deployment build-system suite without weakening safety.
4. PR-4.6 through PR-4.9: add the interim direct remote-execution path so Pleomino can deploy to
   `mini` from a dev machine and Jenkins before the shared control plane exists.
5. PR-5 through PR-8: turn that first provider slice into a real shared deployment system with
   control-plane authority, immutable artifacts, replay, and admission.
6. PR-9 through PR-10: reach the secondary milestone by adding Cloudflare Pages static-webapp deploys
   and a full Pleomino `dev -> staging -> prod` flow.
7. PR-11 through PR-13, with PR-12.1 verify-scope hardening immediately after preview: generalize
   that second milestone across providers, preview, deployment-test ownership cleanup, and
   changed-based orchestration.
8. PR-14 through PR-16: close the remaining model gaps for multi-component rollout, rebuild-per-stage,
   and cross-cutting protected/shared semantics.

## Companion Docs

- [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md)
