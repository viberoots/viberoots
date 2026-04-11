# Deployment Implementation Plan - PR Breakdown

This plan covers implementation of the deployment model described in
[Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md), with the first
working end-to-end milestone prioritized around the `mini` shared-dev flow described in
[Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md).

Each PR includes code, tests, and documentation updates together.

Documentation updates are not limited to design/contract/schema docs. When a PR changes real
operator, technician, setup, usage, troubleshooting, or day-to-day workflow behavior, that same PR
must update the corresponding usage/instructions docs too. For `nixos-shared-host` and other
operator-facing deployment flows, this explicitly includes docs such as
[nixos-shared-host-setup.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
and
[nixos-shared-host-technician-checklist.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
whenever the reviewed workflow, required commands, operator responsibilities, or troubleshooting
expectations change.

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
- reviewed deployment-owned files in the deployment domain stay within the repository methodology
  file-size boundary, enforced by the deployment-domain guardrail introduced in PR-44

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
reviewed execution boundaries rather than advanced artifact replay or later lock-resilience
refinements.

### Scope & Changes

- Introduce the first shared control-plane API and worker skeleton for mutating shared deployments.
- Require `nixos-shared-host` `shared_nonprod` mutation to execute through the shared control plane.
- Implement the first shared lock primitive for `nixos-shared-host` on canonical provider-target
  identity so concurrent mutation on the same target is rejected.
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
- Add locking tests proving shared runs acquire the canonical provider-target lock before mutation
  and reject concurrent mutation on the same target.
- Add execution-snapshot tests proving required metadata is frozen before mutation.
- Extend the `mini` end-to-end flow to assert control-plane submission, locking, and recorded
  execution-snapshot references.

### Docs (in this PR)

- Document the first shared-control-plane path for `mini` shared-dev deployments.
- Document the initial canonical provider-target locking behavior for shared mutation.
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
- The system acquires canonical provider-target locks before mutation and rejects concurrent
  mutation on the same target.
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
audited cleanup semantics, consistent with the main design.

### Scope & Changes

- Implement preview publish mode with explicit isolated preview target identity.
- Reject preview paths that try to reuse the normal mutable live target.
- Reject preview paths that rely on operator-invented ad hoc target identity instead of policy-
  defined derivation.
- Implement audited preview cleanup as a first-class control-plane operation.
- Preserve both normal declared provider-target identity and effective preview target identity in
  deployment records.
- Keep preview support limited to providers whose capability entries explicitly allow it.

### Tests (in this PR)

- Add tests rejecting:
  - preview that reuses the normal live target
- Add tests rejecting preview cleanup that targets an unknown or non-preview target identity.
- Add end-to-end preview publish and cleanup tests for one supported provider family.
- Add record tests for effective preview target identity preservation.

### Docs (in this PR)

- Document preview as a publish mode, not a deployment identity.
- Document preview cleanup semantics for the initial audited cleanup path.
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

- Preview uses explicit isolated target identity and never reuses the live target.
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
- Keep prerequisite evaluation direct-edge-only rather than silently introducing transitive
  prerequisite semantics.
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

## PR-17: Required-check enforcement + approval-evidence binding for protected/shared admission

### Description

I will close the gap between extracted admission metadata and the actual protected/shared mutating
gate. This PR makes required checks, human approvals, approval reuse rules, prerequisite-mode
evaluation, promotion-compatibility validation, protected/shared execution-boundary enforcement,
and immutable approval-evidence binding first-class admission behavior instead of parsed-but-
advisory metadata.

### Scope & Changes

- Enforce `required_checks` for protected/shared `deploy`, `promotion`, `rollback`, and preview
  flows against the admitted revision or admitted reusable artifact lineage, as appropriate to the
  operation kind.
- Enforce `required_approvals` as blocking protected/shared admission inputs rather than
  documentation-only metadata.
- Enforce the protected/shared extension boundary at admission time:
  - normal protected/shared mutation may execute only vetted built-in adapter, provisioner,
    smoke-runner, and reviewed built-in `release_action` code in the shared control plane
  - deployment-local `deploy.ts`, deployment-local provisioner entrypoints, deployment-local smoke
    entrypoints, and other package-local executable hooks are rejected for the normal
    protected/shared path
  - deployment-local executable hooks remain available only for `local_only` and explicitly
    isolated preview/local targets unless a later reviewed sandboxed exception path is introduced
- Implement the reviewed prerequisite-mode contract for direct prerequisite edges at admission,
  including:
  - `ordering_only`
  - `health_gated`
  - unknown or ad hoc prerequisite modes rejected fail closed
  - `ordering_only` preserving dependency ordering without inventing implicit health or rollout
    coupling
  - `health_gated` requiring a fresh admission-time health verdict unless explicitly documented
    provider-specific evidence is accepted as equivalent
- Implement the explicit promotion-compatibility validation gate before protected/shared promotion
  mutates the target environment:
  - for `artifact_reuse_mode = "same_artifact"`, validate the reviewed default lane-compatibility
    inputs:
    - component ids
    - component kinds
    - publisher type
    - rollout semantics
    - resolved-kind contract and artifact-identity semantics
  - require same-artifact lanes to prove the reused artifact remains environment-neutral across the
    lane
  - treat the following differences as reviewed allowed defaults that do not break promotion
    compatibility on their own:
    - `environment_stage`
    - `admission_policy`
    - normal provider-target identity
    - secrets and secret references
    - smoke endpoints, preview URLs, or equivalent health targets
    - provider-native non-identity settings intentionally derived from environment-specific target
      identity
  - require provisioner behavior to be accounted for explicitly in the lane's reviewed default
    compatibility set or an explicit reviewed compatibility contract before promotion is allowed
  - fail closed on any other compatibility-affecting difference unless it is modeled as an explicit
    reviewed compatibility exception
  - for `artifact_reuse_mode = "rebuild_per_stage"`, reject exact-artifact promotion semantics and
    verify:
    - the selected source run identifies an admitted source revision that is still promotable under
      the current lane policy
    - target-stage build inputs and build-time substitutions remain within the reviewed lane
      compatibility contract before the target-stage artifact is built
  - keep the compatibility gate extensible so later provider-family PRs can add explicit
    provider-specific compatibility inputs such as SSR runtime contract or mobile signing/track
    semantics without bypassing the same reviewed gate
- Introduce approval-evidence capture and binding to the immutable admission payload, including:
  - admitted `deploy_run_id`
  - frozen execution snapshot
  - canonical target identity
  - selected artifact identity or source-run selector
  - reviewed provisioner plan/diff artifact when infra-affecting mutation is in scope
- Implement operation-kind-aware approval rules:
  - `deploy` uses fresh target-environment approval under the current admission policy
  - `promotion` always requires target-environment approval
  - `rollback` requires fresh `production_facing` approval by default unless policy explicitly says
    otherwise
  - `retry` may reuse approval only when the admission policy explicitly allows same-lineage reuse
    and the bound approval remains valid
  - preview inherits the reviewed branch/check posture for the target deployment unless the
    admission policy explicitly defines a stricter preview posture
- Fail closed when approval evidence is stale, revoked, self-approved out of policy, or no longer
  matches the current immutable admission payload.
- Persist approval and required-check evaluation facts in deployment records and replay snapshots
  without storing secret-bearing payloads.
- Keep the admission and approval engine transport-agnostic so later submit/status/run-action
  surfaces can reuse the same reviewed semantics.

### Tests (in this PR)

- Add admission tests proving required checks block mutation when:
  - the admitted revision has not satisfied the target deployment's reviewed check set
  - a reusable artifact or source-run selector lacks the required earlier-environment evidence
- Add admission tests rejecting:
  - protected/shared deployment shapes that require deployment-local executable hooks
  - unknown prerequisite modes
  - `health_gated` prerequisites without a fresh admission-time health verdict or reviewed
    equivalent provider evidence
  - promotion where component ids, component kinds, publisher type, rollout semantics, or
    resolved-kind compatibility inputs do not match the lane contract
  - same-artifact promotion when the artifact is not environment-neutral across the lane
  - promotion where provisioner behavior is outside the lane's reviewed compatibility contract
  - rebuild-per-stage promotion when exact-artifact semantics are requested
  - rebuild-per-stage promotion when target-stage build inputs or build-time substitutions fall
    outside the reviewed lane compatibility contract
- Add admission tests proving:
  - `ordering_only` prerequisites enforce dependency ordering without requiring health evidence
  - reviewed allowed environment-specific differences do not fail promotion compatibility by
    default
- Add approval tests covering:
  - missing approval
  - stale or revoked approval
  - self-approval rejected when out of policy
  - retry approval reuse allowed only when explicitly declared
  - promotion and `production_facing` rollback requiring fresh target-environment approval
- Add tests proving approval evidence fails closed when the frozen execution snapshot, target
  identity, or selected artifact/source-run input changes after approval.
- Extend record and replay tests to assert approval/check evidence references are preserved in a
  secret-safe form.

### Docs (in this PR)

- Document that `admission_policy` required checks and approvals are authoritative blocking inputs,
  not advisory metadata.
- Document the protected/shared execution boundary and the explicit rejection of package-local
  executable hooks in the normal shared-control-plane path.
- Document the reviewed `ordering_only` / `health_gated` prerequisite-mode contract for direct
  prerequisite edges.
- Document the explicit promotion-compatibility validation gate, reviewed default compatibility
  inputs, allowed environment-specific differences, and provisioner-compatibility requirements.
- Document approval-evidence binding, approval reuse, and preview approval posture by operation
  kind.
- Document the protected/shared record and replay requirements for approval/check facts.
- Update any provider-capability wording that still describes these fields as lighter-weight than
  the implemented protected/shared contract.

### Verification Commands

- `buck2 test //...`
- approval/admission inspection and verification commands introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to touch shared
  deployment/control-plane code, record/replay contracts, and the reviewed build-system metadata
  surface that defines admission-policy behavior. Under the deployment-only verify policy, default
  `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- Required checks and required approvals actually block protected/shared mutation.
- Protected/shared normal-path admission rejects package-local executable hooks and evaluates the
  reviewed prerequisite-mode contract explicitly.
- Promotion mutates only when the reviewed compatibility gate passes for the lane's declared
  `artifact_reuse_mode`.
- Approval evidence binds to one immutable admission payload and fails closed on drift.
- Records and replay snapshots preserve enough secret-safe evidence to explain why a run was
  admissible.
- Tests and docs in this PR describe the same admission and approval behavior.

### Risks

Approval and check enforcement cut across multiple run kinds, so it is easy to accidentally make
one path stricter or looser than the others.

### Mitigation

Centralize policy evaluation, bind approvals to the frozen admission payload, and test every
reviewed operation kind in the same PR.

### Consequence of Not Implementing

Protected/shared deployments would continue to treat required checks and approvals as parsed
metadata rather than authoritative mutating-policy gates.

### Downsides for Implementing

Adds policy-state and evidence-management complexity to the control plane before any new provider
feature is visible to operators.

### Recommendation

Implement immediately after the current cross-cutting closeout work so later control-plane and
provider slices build on real protected/shared admission semantics rather than placeholders.

---

## PR-18: Versioned deploy/control-plane payload contracts + exact RBAC + idempotency

### Description

I will replace the current in-process control-plane skeleton with reviewed contract surfaces that
match the final deployment design: versioned Buck-extraction and control-plane payloads,
machine-readable rejection codes, idempotent submission, first-class lifecycle states beyond
`finished`, and one explicit protected/shared RBAC model shared by CLI and future UI/API clients.

### Scope & Changes

- Introduce one reviewed versioned payload boundary across:
  - Buck metadata extraction
  - the repo-level `deploy` CLI
  - the shared control-plane API
- Introduce versioned reviewed payloads for:
  - extracted deployment metadata
  - submit request/response contracts
  - status/read-model contracts
  - run-action request/response contracts
  - admitted execution-snapshot payloads
  - replay-selector payloads
- Require explicit schema versions and fail-closed reader behavior for those reviewed payloads so
  extraction, CLI submission, and control-plane execution cannot silently reinterpret older data.
- Preserve enough normalized operator intent in the reviewed payloads that separate clients do not
  need undocumented adapter-local conventions to recover preview identity, source-run selection, or
  replay intent.
- Add submit-layer idempotency keys or stable submission ids plus dedupe and
  idempotency-conflict handling for protected/shared mutation requests.
- Expand the control-plane lifecycle model to include:
  - `pending_approval`
  - `queued`
  - `waiting_for_lock`
  - `running`
  - `cancelling`
  - `finished`
  - `cancelled`
- Add machine-readable closed rejection/action-result codes for the reviewed control-plane
  contracts, including cases such as:
  - `lock_conflict`
  - `approval_required`
  - `approval_no_longer_valid`
  - `idempotency_conflict`
  - `unauthorized`
  - `not_resumable`
  - `no_longer_admitted`
- Implement the first-class status/read path used by the repo-level CLI and tests instead of making
  clients infer state from ad hoc files or string parsing.
- Implement first-class run actions for:
  - `cancel` with deterministic reconciliation semantics
  - `resume` with reviewed fail-closed rejection when the targeted run/provider is not actually
    resumable under current rollout and approval policy
- Implement the minimum protected/shared RBAC model and stable action vocabulary using the design's
  explicit distinct roles:
  - `submitter`
  - `approver`
  - `operator`
  - `break_glass`
- Implement the minimum default protected/shared RBAC scopes:
  - `submitter` granted per deployment id by default
  - `approver` granted per deployment id by default
  - `operator` granted per canonical provider-target identity or reviewed lane scope by default
  - `break_glass` granted per canonical provider-target identity or reviewed lane scope by default
- Keep any separately documented broader administrative powers outside this minimum role model so
  the reviewed contract does not collapse `submitter`, `approver`, `operator`, and `break_glass`
  into one ambient privileged actor.
- Preserve secret-safe audit surfaces and stable principal ids in records and operator-visible
  status outputs.

### Tests (in this PR)

- Add contract tests for extracted-metadata, submit, status, run-action, execution-snapshot, and
  replay-selector payload shapes plus machine-readable closed result codes.
- Add versioning tests proving each reviewed payload:
  - carries an explicit schema version
  - fails closed on unknown or unsupported versions
  - does not silently reinterpret older payloads under newer code assumptions
- Add idempotency tests proving:
  - repeated submit with the same normalized payload resolves to the same accepted or rejected
    result
  - repeated submit with the same idempotency key but different payload fails closed
  - repeated run-action submission follows the same rules
- Add lifecycle tests covering:
  - `pending_approval -> queued -> waiting_for_lock -> running -> finished`
  - clean pre-mutation cancellation to `cancelled`
  - in-flight cancellation to `cancelling` plus reconciled terminal state
- Add authz tests rejecting unauthorized submit, status, cancel, preview-cleanup, approval, and
  resume requests.
- Add RBAC tests proving:
  - `submitter`, `approver`, `operator`, and `break_glass` remain distinct reviewed roles
  - `submitter` and `approver` default to deployment-id scope
  - `operator` and `break_glass` default to canonical provider-target identity or reviewed lane
    scope, not repo-wide scope
  - destructive operations such as preview cleanup and target-transition actions require `operator`
    or stronger authority
- Add tests proving non-resumable current provider slices reject `resume` through the reviewed
  run-action contract rather than through ad hoc CLI errors.

### Docs (in this PR)

- Document the reviewed extracted-metadata, submit, status, run-action, execution-snapshot, and
  replay-selector payload contracts plus their stable rejection codes.
- Document lifecycle-state and termination-reason vocabulary for operator-facing tools.
- Document the exact minimum protected/shared RBAC role and scope model and shared action
  vocabulary.
- Document cancellation and resume semantics, including the current fail-closed behavior for
  non-resumable runs.

### Verification Commands

- `buck2 test //...`
- submit/status/run-action command flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to span reviewed Buck
  extraction payloads, repo-level CLI/control-plane contracts, lifecycle handling, authz, and
  deployment-domain test infrastructure. Under the deployment-only verify policy, default `v` / CI
  must still run the full build-system verify scope.

### Acceptance Criteria

- Protected/shared clients use stable reviewed versioned payloads from Buck extraction through the
  control-plane request and status surfaces.
- Submit and run-action paths are idempotent at the control-plane request layer.
- Lifecycle states beyond `finished` are real, observable, and test-covered.
- Cancel works through the reviewed run-action path, and resume has an explicit fail-closed
  contract even when the current provider/run is not resumable.
- CLI and later control-plane clients can rely on one exact reviewed RBAC role/scope model and one
  machine-readable response model.

### Risks

Contract and lifecycle work can sprawl if every convenience request turns into a new special-case
response shape.

### Mitigation

Keep the contract vocabulary closed, version the payloads explicitly, and reject unsupported actions
through the same reviewed response surface rather than inventing side channels.

### Consequence of Not Implementing

The deployment system would still lack the final model's reviewed control-plane API, lifecycle,
idempotency, and authorization guarantees even if individual provider flows continue to work.

### Downsides for Implementing

Adds operator-surface and state-model complexity that is highly visible and must remain stable.

### Recommendation

Implement after PR-17 so the stable control-plane contracts sit on top of real admission and
approval semantics.

---

## PR-19: Deployment-atomic multi-component replay + `nixos-shared-host` immutable-reuse closeout

### Description

I will close the current reviewed-slice limitation that leaves multi-component
`nixos-shared-host` deploys effectively write-only. This PR records the per-component publish state
needed for deterministic replay and adds deployment-atomic multi-component publish-only, retry,
rollback, and promotion for the reviewed ordered-best-effort static-webapp slice.

### Scope & Changes

- Persist structured per-component artifact, publish, smoke, and live-identity state in deployment
  records and replay snapshots.
- Support multi-component `nixos-shared-host`:
  - `--publish-only`
  - `retry`
  - `rollback`
  - compatible same-artifact `promotion`
    using recorded per-component state rather than single-component assumptions.
- Keep retry and rollback deployment-atomic by default after partial publish failure.
- Allow already-proven-live component no-op reuse only when the adapter can prove:
  - the currently live published identity exactly matches the intended recorded artifact identity
  - no rollout or `release_action` rule requires re-publish
- Fail closed on:
  - missing per-component replay state
  - ambiguous live identity
  - partial-state mismatch
  - component-level drift that breaks deployment-atomic replay safety
- Update the `nixos-shared-host` provider capability and related docs so multi-component immutable
  reuse support and the reviewed built-in `release_actions` posture are documented accurately rather
  than left in the earlier initial-slice wording.

### Tests (in this PR)

- Add end-to-end tests for multi-component:
  - publish-only replay
  - retry
  - rollback
  - cross-deployment promotion
- Add tests proving deployment-atomic behavior after partial publish failure.
- Add tests allowing no-op component reuse only when the live identity matches the intended exact
  artifact and rejecting reuse on any ambiguity.
- Add tests rejecting replay when per-component record or replay state is missing or drifted.
- Add tests covering multi-component replay interaction with the reviewed built-in `release_actions`
  contract.

### Docs (in this PR)

- Document deployment-atomic multi-component replay, retry, rollback, and promotion semantics for
  the reviewed `nixos-shared-host` slice.
- Document the per-component record and replay data model.
- Update provider-capability docs so the reviewed multi-component immutable-reuse and built-in
  `release_actions` support are aligned with the implementation.

### Verification Commands

- `buck2 test //...`
- multi-component replay and promotion command flows introduced in this PR

### Expected Regression Scope

- `deployment-and-project-impact`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR should stay in reviewed deployment-owned
  replay/runtime logic while also adding or updating concrete multi-component deployment fixtures or
  declarations used to exercise the new behavior. Under the deployment-only verify policy, default
  `v` / CI can run the reviewed union of deployment coverage and project-impact coverage instead of
  the full build-system verify scope.

### Acceptance Criteria

- Reviewed multi-component `nixos-shared-host` deployments can be replayed and recovered without
  guessing from current host state.
- Deployment records preserve enough per-component state to make replay, rollback, and promotion
  deterministic.
- The reviewed provider-capability and operator docs match the runtime behavior for multi-component
  immutable reuse and built-in `release_actions`.

### Risks

Partial multi-component success can tempt the implementation into ad hoc component-by-component
recovery rules that silently weaken deployment-atomic semantics.

### Mitigation

Record explicit per-component state, keep the deployment atomic by default, and require exact proof
before any component-level no-op reuse is permitted.

### Consequence of Not Implementing

The repo would keep a multi-component deployment slice that can publish but cannot fully satisfy
the final design's replay, rollback, and promotion expectations.

### Downsides for Implementing

Adds structured replay state and more complex negative-path testing for one provider family.

### Recommendation

Implement after the control-plane contract work is stable so multi-component immutable-reuse can
build on the final protected/shared lifecycle and authz surfaces.

---

## PR-20: Cloudflare Pages rollback + explicit retire/migrate-target workflow closeout

### Description

I will close the remaining operator-surface gap for the reviewed Cloudflare Pages path and add the
first explicit target-retirement / target-migration workflow required by the design. This PR adds
same-deployment Cloudflare rollback on exact admitted artifacts and a separate audited workflow for
retiring or transitioning live target ownership instead of overloading normal deploy/remove
semantics.

### Scope & Changes

- Implement same-deployment Cloudflare Pages rollback using exact artifact reuse plus current
  target-environment admission.
- Apply operation-kind-aware approval rules to Cloudflare rollback, especially fresh
  `production_facing` approval by default unless policy explicitly relaxes it.
- Preserve parent-run, release-lineage, artifact-lineage, provider release identity, and
  normal-versus-preview target distinctions in Cloudflare rollback records.
- Introduce the first reviewed retire/migrate-target workflow for controlled live-target ownership
  transitions:
  - retire one deployment's normal live target
  - migrate target ownership under a reviewed alias/migration exception window
  - require the migration or alias exception object to preserve at least:
    - affected deployment id or deployment ids
    - old normal target identity and new normal target identity when applicable
    - enforced shared lock scope for the exception window
    - approval authority and review ticket or equivalent justification
    - effective start time and expiry or explicit completion condition
    - reconciliation owner
  - require admission and replay validation to consult that exception object when target binding
    has changed
  - fail closed when the exception has expired or been superseded
  - record requesting identity, executing identity, approvals, old target identity, new target
    identity when applicable, and resulting ownership state
- Keep retire/migrate-target separate from normal `deploy`; do not treat generic `--remove` as the
  public abstraction for providers that are not authoritative platform-state hosts.
- Update CLI guidance and provider-capability docs so the reviewed rollback and target-transition
  surfaces are explicit and do not rely on earlier placeholder wording.

### Tests (in this PR)

- Add end-to-end Cloudflare Pages rollback tests for:
  - restoring a prior known-good exact artifact
  - rejecting rollback when the source run is ineligible
  - requiring fresh `production_facing` approval where policy says so
- Add tests rejecting Cloudflare rollback when:
  - the exact artifact is unavailable
  - the selected source run refers to preview rather than the normal live target
  - current lane/admission state no longer authorizes rollback
- Add retire/migrate-target tests covering:
  - successful reviewed target retirement
  - controlled ownership transition under an active exception window
  - the exception's declared shared lock scope preserved and enforced for the transition window
  - expired or missing exception rejected
  - superseded exception rejected
  - authorization and approval failures
  - resulting records and audit payloads preserving old/new target identity correctly

### Docs (in this PR)

- Document Cloudflare Pages rollback semantics and approval requirements.
- Document the reviewed retire/migrate-target workflow and how it differs from normal deploy or
  provider-local cleanup.
- Document the migration or alias exception object's required fields and enforced shared lock-scope
  expectations.
- Update provider-capability and operator docs so reviewed provider-specific rollback and
  target-transition behavior is explicit.

### Verification Commands

- `buck2 test //...`
- Cloudflare rollback and retire/migrate-target command flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- Assuming PR-4.5.1 through PR-4.5.3 are complete, this PR is expected to combine provider/control-
  plane runtime changes with the shared metadata and exception surfaces needed to model reviewed
  target transitions. Under the deployment-only verify policy, default `v` / CI must still run the
  full build-system verify scope.

### Acceptance Criteria

- The reviewed Cloudflare Pages path supports same-deployment rollback using exact admitted
  artifacts and current target-environment admission.
- Retire/migrate-target is a first-class audited workflow rather than an implicit side effect of
  `deploy`.
- Reviewed target transitions depend on an explicit migration or alias exception object whose lock
  scope and lifetime are enforced.
- Operators no longer need ad hoc or overloaded `--remove` semantics to retire or transition live
  targets.
- Tests and docs in this PR describe the same provider/operator surface.

### Risks

Rollback and target-transition work both touch high-risk destructive paths, so hidden ambiguity is
dangerous.

### Mitigation

Keep artifact identity, approval, target-identity transition, and audit recording explicit and
fail closed on any mismatch.

### Consequence of Not Implementing

The repo would still lack the final-model reviewed rollback surface for one of its main higher-
environment providers and would not have the explicit retire/migrate-target workflow the design
calls for.

### Downsides for Implementing

Adds another provider-specific recovery path plus a new high-risk operator workflow that must be
documented very carefully.

### Recommendation

Implement last as the final protected/shared operator-surface closeout after admission, control-
plane, and multi-component replay behavior are stable.

---

## PR-21: Reviewed provisioner plan/diff gate + higher-bar exception contract for infra-affecting mutation

### Description

I will close the remaining gap for protected/shared infra-affecting mutation by making the reviewed
provisioner plan/diff artifact a first-class pre-mutation requirement rather than an implied future
hook. This PR ensures the control plane generates, fingerprints, validates, and records the exact
reviewed plan/diff from the frozen execution snapshot before routine mutation begins, makes normal
deploy/provision-only flows fail closed on destructive replace/delete intent, and defines the
explicit higher-bar exception posture for providers that cannot produce one. This PR also closes
the destructive-intent boundary for built-in release-time actions so destructive data or
infrastructure mutation cannot hide inside an ordinary routine deploy.

### Scope & Changes

- Generate the reviewed provisioner plan/diff artifact for protected/shared infra-affecting runs
  from the frozen execution snapshot before any mutating step begins.
- Fingerprint and bind that plan/diff artifact to the immutable admitted run snapshot so later
  approval, lock-time revalidation, and replay checks all refer to the same reviewed artifact.
- Classify reviewed plan/diff output into non-destructive routine mutation versus destructive
  replace/delete behavior that can remove owned live resources.
- Fail closed when:
  - a required plan/diff artifact is missing
  - regenerated plan/diff output no longer matches the reviewed artifact materially
  - mutation is attempted after plan/diff drift without fresh approval
  - a normal `deploy` or `--provision-only` flow detects destructive replace/delete intent
- Add one explicit provider/provisioner capability contract for infra-affecting mutation:
  - reviewed plan/diff required and supported
  - reviewed higher-bar exception path allowed when no meaningful plan/diff can be produced
  - routine mutation disallowed when neither contract is reviewed
- Add one explicit destructive infra-mutation posture for providers that can remove or replace
  owned live resources:
  - normal deploy/provision-only remains non-destructive by default
  - destructive replace/delete behavior requires a separate reviewed operator path or explicit
    break-glass intent surface rather than piggybacking on routine deploy
  - the destructive path must bind to the same reviewed plan/diff artifact, stronger approval, and
    explicit operator intent/audit recording
- Apply the same non-destructive-by-default contract to built-in `release_actions` that can perform
  destructive data or infrastructure mutation:
  - ordinary protected/shared deploy/retry/promotion/rollback paths fail closed when a declared
    action type is classified as destructive and no separately reviewed workflow/intent surface is
    in use
  - destructive built-in action execution must bind to explicit operator intent, stronger approval,
    and the same reviewed audit boundary rather than silently inheriting routine deploy authority
- Expose operator-facing plan/diff review references through the reviewed control-plane submit or
  status surfaces instead of leaving review to provider-local conventions.
- Persist secret-safe plan/diff references, fingerprints, and approval-binding facts in
  authoritative records and replay snapshots.
- Align provider-capability metadata, admission behavior, and worker execution order around one
  reviewed pre-mutation plan/diff gate.

### Tests (in this PR)

- Add worker-flow tests proving infra-affecting runs generate the reviewed plan/diff before the
  first mutating provider step.
- Add admission and revalidation tests rejecting mutation when:
  - required plan/diff output is unavailable
  - the artifact fingerprint drifts after approval
  - the provider/provisioner has no reviewed plan/diff or higher-bar exception contract
- Add destructive-plan tests proving:
  - normal `deploy` and `--provision-only` fail closed on reviewed delete/replace intent
  - destructive infra mutation is accepted only through the separate reviewed destructive path or
    explicit break-glass intent surface
  - destructive-path approval and audit evidence bind to the same reviewed plan/diff artifact
- Add destructive-action tests proving:
  - destructive built-in `release_actions` are rejected on routine protected/shared paths
  - destructive built-in actions are accepted only through the reviewed destructive-intent
    workflow/intent surface
  - destructive-action execution preserves the stronger approval and audit facts required for later
    review
- Add approval-binding tests proving infra-affecting approval evidence fails closed when the
  reviewed plan/diff artifact changes materially.
- Add provider-capability tests covering:
  - providers that require a reviewed plan/diff
  - providers that use an explicitly reviewed higher-bar exception posture
  - providers rejected because neither posture is declared
- Extend record and replay tests to assert plan/diff references remain retrievable in a secret-safe
  form.

### Docs (in this PR)

- Document the protected/shared worker responsibility to generate and bind reviewed provisioner
  plan/diff output before mutation.
- Document the reviewed non-destructive-by-default provisioner contract and the separate
  destructive-intent workflow for replace/delete behavior.
- Document that destructive built-in `release_actions` follow the same non-destructive defaulting
  philosophy and require the same reviewed destructive-intent workflow rather than routine deploy
  authority.
- Document the higher-bar exception posture for infra-affecting providers that cannot produce a
  meaningful plan/diff artifact.
- Update provider-capability docs so reviewed plan/diff expectations are explicit per provider or
  provisioner family.
- Document the operator-visible plan/diff review surface and the fail-closed behavior on drift.

### Verification Commands

- `buck2 test //...`
- infra-affecting provisioner plan/diff command flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch shared deployment/control-plane behavior, provider-capability
  metadata, and the reviewed metadata or contract surface used to describe infra-affecting
  provisioners. Under the deployment-only verify policy, default `v` / CI must still run the full
  build-system verify scope.

### Acceptance Criteria

- Protected/shared infra-affecting mutation cannot proceed routinely without the reviewed plan/diff
  or an explicitly reviewed higher-bar exception posture.
- Normal `deploy` and `--provision-only` remain non-destructive by default; destructive
  replace/delete behavior requires a distinct reviewed operator path or explicit break-glass
  posture.
- Destructive built-in `release_actions` also require the reviewed destructive-intent workflow and
  cannot be smuggled through the routine deploy path.
- Approval evidence and lock-time revalidation bind to the same reviewed plan/diff artifact.
- Provider-capability docs, tests, and runtime behavior agree on which provisioners require a
  plan/diff and which are exception-only.
- The control plane records enough secret-safe plan/diff evidence to justify later audit and
  replay decisions.

### Risks

Plan/diff handling is easy to weaken accidentally by recomputing from newer inputs or by letting
provider-specific edge cases bypass the same gate.

### Mitigation

Generate the artifact only from the frozen execution snapshot, fingerprint it explicitly, and make
unsupported provider behavior fail closed unless a reviewed higher-bar exception path exists.

### Consequence of Not Implementing

Protected/shared infra-affecting mutation would still lack the design's required reviewed
pre-mutation plan/diff gate.

### Downsides for Implementing

Adds more pre-mutation coordination and provider-capability detail for infra-affecting runs.

### Recommendation

Implement first among the remaining closeout PRs so retention, recovery, and observability all
instrument the final reviewed plan/diff contract rather than a placeholder.

---

## PR-22: Artifact/replay retention + authoritative backend resilience and restore posture

### Description

I will make the operator-facing durability promises in the deployment design real instead of
implicit. This PR covers minimum artifact and replay-bundle retention for supported immutable-reuse
flows, authoritative record and evidence retention, and the reviewed backup, restore-test, failover,
and recovery-objective posture for the protected/shared control plane itself.

### Scope & Changes

- Implement minimum retention enforcement for protected/shared:
  - admitted immutable artifacts
  - immutable dependency closures when required for exact reuse
  - replay bundles and frozen execution snapshots
  - authoritative deployment records
  - approval evidence
  - migration or alias exception records
  - break-glass emergency evidence
- Add retention-aware garbage-collection and deletion safeguards so supported retry, promotion, and
  rollback paths remain usable for the reviewed minimum window.
- Surface explicit operator-facing failure results when:
  - a required artifact has expired or been removed
  - a replay bundle is incomplete
  - a supported reuse path can no longer be satisfied because retention guarantees were violated
- Implement the first reviewed backup and restore-test posture for the authoritative backend and any
  required artifact or evidence stores, including:
  - scheduled durable backups
  - restore-test automation or equivalent reviewed restore validation
  - explicit restore-test cadence by protection class
  - failover or recovery-readiness checks for the production control-plane topology
- Publish one reviewed resilience-objective matrix for the deployment authority itself and align the
  companion docs and runtime policy constants to that same matrix, eliminating current drift between
  design and contract documents.
- Persist backup and restore-test results in reviewed operator-visible state so later observability
  and alerts can consume them directly.

### Tests (in this PR)

- Add retention tests proving supported protected/shared reuse flows retain the exact artifact and
  replay bundle for the reviewed minimum window.
- Add garbage-collection tests rejecting deletion or early expiry of artifacts, replay bundles, or
  evidence still required for an in-policy retry, rollback, or promotion path.
- Add tests proving replay and rollback fail explicitly with operator-meaningful errors when a
  required retained artifact or replay bundle is unavailable.
- Add backup and restore tests that recover a scratch authoritative backend from backup and verify
  records, evidence references, and required replay metadata are restored correctly.
- Add policy tests for protection-class-specific retention, RPO or RTO, and restore-test cadence
  configuration.

### Docs (in this PR)

- Document the operator-facing retention contract for artifacts, replay bundles, and authoritative
  records.
- Document the authoritative control-plane backup, restore-test, and resilience posture, including
  the reviewed objective matrix implemented in this PR.
- Align [deployments-design.md](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md),
  [deployments-contract.md](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md), and
  related capability or operator docs to the same reviewed retention and resilience commitments.
- Document the explicit failure behavior when an artifact or replay bundle is missing despite a
  supported reuse request.

### Verification Commands

- `buck2 test //...`
- backup, restore-test, and retention inspection flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch deployment/control-plane storage behavior, artifact and evidence
  retention policy, and the reviewed deployment definitions or configuration that back the
  authoritative control-plane topology. Under the deployment-only verify policy, default `v` / CI
  must still run the full build-system verify scope.

### Acceptance Criteria

- Supported protected/shared immutable-reuse paths remain practically usable for at least the
  reviewed minimum retention windows.
- The system fails explicitly rather than guessing when a required retained artifact or replay
  bundle is unavailable.
- The authoritative control plane has reviewed backup, restore-test, and resilience objectives with
  tested restore behavior.
- Companion docs and implemented policy constants agree on one reviewed resilience and retention
  matrix.

### Risks

Retention and resilience work can drift into vague policy prose if the implementation does not
make the operator-facing guarantees testable.

### Mitigation

Turn the guarantees into explicit policy constants, retention guards, restore tests, and operator-
visible status so the promises are mechanically checkable.

### Consequence of Not Implementing

The repo would still lack the design's required durability guarantees for artifact reuse and would
still rely on undocumented or unverified recovery posture for the deployment authority itself.

### Downsides for Implementing

Adds storage-lifecycle complexity, backup or restore automation, and more cross-document alignment
work.

### Recommendation

Implement next so later recovery and observability work can rely on real retention guarantees and a
reviewed resilience baseline.

---

## PR-23: In-doubt-run recovery + control-plane-outage break-glass reconciliation

### Description

I will close the two remaining recovery-path gaps in the design: the normal protected/shared
in-doubt run after provider-side mutation may have started, and the incident-bounded break-glass
path when the normal control plane itself is unavailable. This PR makes both paths explicit,
fail-closed, auditable, and reconciled back into authoritative records.

### Scope & Changes

- Implement reviewed in-doubt-run detection for protected/shared mutation, including cases such as:
  - worker restart after provider-side mutation begins
  - provider request timeout with uncertain remote acceptance
  - lock lease loss or fencing loss during mutation
  - process death before final record persistence
- Add an authoritative recovery state machine that:
  - reloads the frozen execution snapshot
  - reacquires current lock or fencing authority before continuing
  - reconciles provider state before any duplicate side effects
  - resumes only when duplicate-execution safety is proven
  - otherwise terminates fail closed with explicit operator follow-up requirements
- Reuse the same reconciliation path for post-mutation cancellation so `cancelling` runs do not
  guess about provider state.
- Persist material recovery facts in authoritative records, including:
  - whether recovery occurred
  - which step was in doubt
  - whether provider-state reconciliation succeeded
  - whether execution resumed or terminated after reconciliation
- Implement the explicit control-plane-outage break-glass workflow, including:
  - incident-bounded authorization scope and separate credentials or execution path
  - explicit concurrency protection such as target freeze, fencing, or equivalent reviewed
    protection when the normal online lock service is unavailable
  - exact admitted-artifact reuse preference when a retained admitted artifact is available
  - local or deferred emergency evidence capture
  - mandatory post-incident ingestion or reconciliation of that evidence into authoritative records
- Keep break-glass separate from normal operator convenience paths and require explicit incident
  justification.

### Tests (in this PR)

- Add recovery tests covering:
  - provider mutation timeout with ambiguous remote acceptance
  - worker restart during publish, smoke, or side-effecting `release_actions`
  - lock or fencing loss after mutation start
  - recovery success after provider-state reconciliation proves remote mutation completed
  - fail-closed termination when reconciliation cannot prove whether mutation happened
- Add cancellation tests proving post-mutation cancel flows use reconciliation before choosing a
  terminal record.
- Add break-glass tests covering:
  - required incident reference and emergency authorization
  - concurrency protection against simultaneous normal-path mutation
  - emergency evidence capture and later authoritative ingestion
  - rejection of convenience-path or under-specified break-glass attempts
- Add record tests proving recovery and break-glass facts are preserved in the final authoritative
  record shape.

### Docs (in this PR)

- Document the reviewed in-doubt-run recovery contract and its fail-closed continuation rules.
- Document the protected/shared record fields and operator expectations for recovered runs.
- Document the control-plane-outage break-glass procedure, required evidence, and mandatory
  post-incident reconciliation.
- Document how cancellation after mutation start reuses the same provider-state reconciliation
  contract.

### Verification Commands

- `buck2 test //...`
- recovery, cancellation-reconciliation, and break-glass flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned control-plane runtime, records, authz, and
  deployment-domain test infrastructure. Under the deployment-only verify policy, default `v` / CI
  can run the reviewed deployment suite instead of the full non-deployment build-system verify
  scope.

### Acceptance Criteria

- Protected/shared in-doubt runs no longer rely on blind retry or operator memory.
- Recovery always re-establishes authoritative ownership and reconciles provider state before
  continuing mutation.
- Break-glass is an explicit incident-only path with required evidence and mandatory authoritative
  reconciliation afterward.
- Records and tests preserve enough structured facts to explain recovered and emergency execution
  clearly.

### Risks

Recovery logic touches the hardest failure paths in the system, where silent duplication or silent
data loss would be especially dangerous.

### Mitigation

Keep the recovery state machine explicit, require current authority before continuing, and fail
closed whenever reconciliation cannot prove safety.

### Consequence of Not Implementing

Protected/shared execution would still lack the design's reviewed recovery path for ambiguous
provider mutation and the required emergency reconciliation path for control-plane outages.

### Downsides for Implementing

Adds complex negative-path behavior, more state transitions, and an emergency workflow that must be
carefully fenced.

### Recommendation

Implement after resilience and retention are in place so recovery and break-glass can rely on the
reviewed storage, evidence, and retention posture introduced there.

---

## PR-24: Control-plane observability + secret-safe logging and redaction closeout

### Description

I will make the final protected/shared operational contract visible and safe to operate. This PR
adds the required audit events, metrics, alerts, dashboards, and operator-facing views for the
reviewed control-plane lifecycle, while also enforcing the design's fail-closed redaction boundary
for logs, provider output, plan/diff artifacts, replay snapshots, and other operator-visible
payloads.

### Scope & Changes

- Emit structured audit or lifecycle events for the required protected/shared categories,
  including:
  - submission and admission decisions
  - approval grant, reuse, expiry, and revocation
  - lock acquisition, timeout, and release
  - mutation-step start and finish
  - progressive-rollout phase changes when supported
  - cancellation, supersedence, and no-longer-admitted exits
  - preview cleanup
  - in-doubt detection and recovery outcomes
  - break-glass invocation and reconciliation
- Expose the required operational metrics and operator-visible views for:
  - queue depth and queue wait time
  - lock contention and stale-lock or fencing anomalies
  - lifecycle-step durations and retry counts
  - failures by `final_outcome` and `failed_step`
  - age of oldest queued and running runs
  - backup, restore-test, and failover posture
  - in-doubt and recovered-run outcomes
- Add the reviewed alert set for saturation, repeated target failure, stale-lock anomalies,
  failed or overdue backup or restore-test posture, excessive break-glass use, and control-plane
  degradation that threatens the published resilience objectives.
- Introduce one reviewed redaction-classification and enforcement boundary for operator-visible
  payloads:
  - safe to display directly
  - redact before persistence or display
  - reference-only with stable pointer or fingerprint
- Ensure provider stdout or stderr, plan/diff output, smoke failure context, replay snapshots,
  approval evidence, and exception payloads all pass through the same reviewed redaction boundary
  before durable persistence or operator display.
- Store only redacted summaries, structured codes, bounded safe excerpts, or fingerprints when raw
  payload secret safety cannot be proven.
- Make redaction explicit in operator-facing status or debug surfaces so omitted fields are
  understood as intentional safety behavior.

### Tests (in this PR)

- Add event-emission tests for the required lifecycle, approval, recovery, preview-cleanup, and
  break-glass categories.
- Add metrics and alert tests proving the required counters, timers, gauges, and thresholded alert
  conditions are populated for representative success and failure paths.
- Add operator-view tests proving queue, lock, failure, backup or restore, and recovery posture can
  be inspected through the reviewed dashboards or equivalent views introduced in this PR.
- Add redaction tests proving secret-bearing provider output, config content, credentials, and
  uncertain payloads are never persisted or displayed raw in protected/shared observability or
  record surfaces.
- Add tests proving plan/diff artifacts, approval evidence, and replay snapshots follow the same
  fail-closed redaction contract.

### Docs (in this PR)

- Document the minimum required control-plane audit events, metrics, alerts, and dashboards for
  protected/shared mutation.
- Document the secret-safe logging and redaction contract for logs, events, plan/diff artifacts,
  provider output, replay snapshots, and operator-visible summaries.
- Document how redaction is surfaced to operators so omitted values are understood correctly.
- Update companion operator docs to describe the reviewed observability and troubleshooting posture
  after the earlier resilience and recovery PRs land.

### Verification Commands

- `buck2 test //...`
- observability, audit-event, and redaction verification flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned control-plane runtime, observability integration,
  record shaping, and deployment-domain test infrastructure. Under the deployment-only verify
  policy, default `v` / CI can run the reviewed deployment suite instead of the full non-deployment
  build-system verify scope.

### Acceptance Criteria

- The protected/shared control plane exposes the required audit events, metrics, alerts, and
  operator-facing views to operate the published resilience and rollout posture.
- Observability surfaces cover recovery and break-glass behavior, not only steady-state deploy
  success.
- Protected/shared logs, audit streams, dashboards, and record-adjacent payloads are secret-safe by
  construction.
- Documentation, dashboards or views, and tests describe the same reviewed observability contract.

### Risks

Observability work can accidentally become a grab bag of ad hoc logs and unsafe payload capture.

### Mitigation

Use one reviewed event and metric vocabulary, centralize redaction enforcement, and fail closed
when payload secret safety cannot be established.

### Consequence of Not Implementing

The repo would still fall short of the design's required operational visibility and secret-safe
observability posture for protected/shared mutation.

### Downsides for Implementing

Adds telemetry, dashboards, alerts, and redaction plumbing across most protected/shared execution
paths.

### Recommendation

Implement after PR-23 so observability instruments the stabilized protected/shared control-plane
core before the final progressive-rollout and bootstrap closeout work lands.

---

## PR-25: Progressive-rollout state model + resume/abort/supersedence + record persistence

### Description

I will close the remaining execution-model gap for deployments whose reviewed rollout behavior is
more complex than a single publish plus smoke pass. This PR adds the explicit progressive-rollout
state machine, gate evaluation contract, first-class `resume` and `abort` behavior, supersedence
rules, and authoritative record persistence required by the design, while keeping unsupported
progressive modes fail-closed unless a reviewed provider capability entry explicitly allows them.

### Scope & Changes

- Implement the progressive-rollout metadata and execution contract for reviewed provider slices,
  including:
  - explicit rollout phases or steps in execution order
  - per-phase advance gates
  - explicit abort rules
  - explicit smoke mode placement
- Add the reviewed progressive phase-state vocabulary:
  - `pending`
  - `running`
  - `paused`
  - `succeeded`
  - `failed`
  - `aborted`
- Implement first-class progressive-run actions on the existing `deploy_run_id`:
  - `resume`
  - `abort`
    with lock reacquisition, paused-state validation, and fail-closed rejection when deterministic
    continuation is not provable.
- Implement explicit supersedence rules for progressive runs so newer runs cannot silently replace
  a running rollout mid-phase unless a reviewed stronger provider rule says so.
- Add the minimum reviewed gate-type vocabulary and evaluation contract needed for the first slice,
  while failing closed on gate types or rollout modes that lack a reviewed provider capability
  contract.
- Preserve per-phase gate evidence, decisions, publish state, and resumability facts in
  authoritative deployment records and replay snapshots.
- Keep rollback from partial progressive state fail-closed by default unless the reviewed provider
  capability and rollout policy explicitly define safe reversal semantics.
- Update provider-capability docs and runtime gating so progressive rollout support is explicit per
  provider family and rollout mode rather than inferred from operator habit.

### Tests (in this PR)

- Add validation tests for progressive-rollout metadata, including rejection of:
  - unsupported rollout modes for the provider family
  - unsupported gate types
  - missing phase order, gate, or abort declarations
- Add execution tests covering:
  - `pending -> running -> succeeded` phase progression
  - `paused` on a non-passing gate whose terminal effect is pause
  - `failed` and `aborted` outcomes according to the declared gate or abort rule
- Add run-action tests proving:
  - `resume` keeps the same `deploy_run_id`, rollout history, and frozen execution snapshot
  - `resume` fails closed when lock ownership, paused state, or deterministic continuation cannot
    be proven
  - `abort` follows the declared rollout-mode policy rather than improvising provider behavior
- Add supersedence tests proving running progressive rollouts are not silently replaced by newer
  runs mid-phase.
- Add record and replay tests asserting per-phase state, gate evidence references, resumability,
  and partial publish facts are preserved deterministically.

### Docs (in this PR)

- Document the progressive-rollout state machine, gate vocabulary, resume or abort semantics, and
  supersedence rules.
- Document the first reviewed provider or rollout-mode slice and the fail-closed behavior for
  unsupported progressive modes.
- Document the required record fields for paused, resumed, failed, and aborted rollouts.
- Update operator docs so progressive rollout becomes an explicit first-class workflow rather than
  an implied future extension of simple publish.

### Verification Commands

- `buck2 test //...`
- progressive-rollout submit, resume, abort, and status flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned control-plane runtime, provider-capability handling,
  records, and deployment-domain tests. Under the deployment-only verify policy, default `v` / CI
  can run the reviewed deployment suite instead of the full non-deployment build-system verify
  scope.

### Acceptance Criteria

- Progressive rollout is a real reviewed execution model with explicit phase states, gates,
  resumability, and abort behavior.
- `resume` and `abort` operate on an existing run rather than inventing ad hoc replacement flows.
- Unsupported progressive modes fail closed unless a reviewed provider capability entry says
  otherwise.
- Records and tests preserve enough structured phase history to make later audit, replay, and
  operator decisions deterministic.

### Risks

Progressive rollout can easily devolve into provider-specific improvisation if the phase model,
gate vocabulary, and supersedence rules are not kept explicit.

### Mitigation

Keep the state machine closed, require reviewed provider capability declarations, and fail closed on
any rollout mode or gate type whose deterministic continuation semantics are not proven.

### Consequence of Not Implementing

The design would still lack its required progressive-rollout state handling, resume or abort
policy, and authoritative record persistence.

### Downsides for Implementing

Adds a more complex execution model with more lifecycle states, operator actions, and negative-path
testing.

### Recommendation

Implement after the core observability work so the progressive-run state model can plug into the
stabilized event, metric, and record vocabulary instead of forcing another cross-cutting redesign.

---

## PR-26: Reviewed bootstrap/self-hosting bring-up + deployment-authority recovery path

### Description

I will add the final design-level execution path that is still missing: the reviewed limited
bootstrap mode for bringing up or recovering the deployment authority itself. This PR makes
self-hosting and disaster-recovery bootstrap explicit, bounded, auditable, and separate from the
normal protected/shared deployment path so the system does not gain a second long-lived mutating
authority by accident.

### Scope & Changes

- Introduce one reviewed bootstrap executor path or deployment family dedicated to
  deployment-system-owned infrastructure only.
- Limit bootstrap scope to creating or recovering the minimum dependencies needed for normal
  control-plane operation, such as:
  - control-plane service runtime
  - authoritative backend and lock service
  - artifact or provenance storage
  - secrets or runtime-config integration wiring for the deployment authority itself
  - control-plane ingress, DNS, certificates, or endpoint wiring
  - initial credentials needed for the normal control plane to take ownership
- Implement one explicit bootstrap identity and authorization path distinct from ordinary submit,
  approve, operate, and break-glass roles.
- Require explicit proof of target identity, artifact identity, and ownership of the
  deployment-system resources being mutated, failing closed when that proof is absent.
- Prefer exact immutable admitted artifacts for bootstrap or recovery when available rather than
  silently rebuilding.
- Reconcile or ingest authoritative bootstrap records as soon as the normal control plane is
  available again.
- Keep bootstrap clearly separate from normal protected/shared deploy:
  - no silent fallback from normal deploy into bootstrap
  - no arbitrary application deployment through bootstrap
  - no package-local hooks or other unreviewed mutation paths with bootstrap authority
- Update the reviewed self-hosting repository shape and operator guidance so steady-state control-
  plane updates return to the normal deployment path after bootstrap succeeds.

### Tests (in this PR)

- Add tests for reviewed bootstrap authorization and scope rejection, including failure when:
  - the target is not deployment-system-owned infrastructure
  - the caller uses ordinary deploy authority instead of bootstrap authority
  - artifact identity, target identity, or ownership proof cannot be established
- Add first-install bootstrap tests for bringing up the minimum deployment-authority dependencies
  from a reviewed bootstrap target.
- Add offline recovery bootstrap tests proving the path can restore or recreate the minimum control-
  plane dependencies and then hand authority back to the normal control plane.
- Add reconciliation tests proving deferred bootstrap evidence is ingested into authoritative
  records once the normal control plane is available again.
- Add tests rejecting continued routine updates through bootstrap after the normal control plane is
  healthy.

### Docs (in this PR)

- Document the reviewed bootstrap model, allowed scope, and explicit separation from normal deploy
  and from break-glass.
- Document the operator workflow for first install, trusted CI bootstrap, and offline recovery
  bootstrap.
- Document the minimum bootstrap constraints and the requirement to reconcile authoritative records
  after bootstrap.
- Update self-hosting or control-plane topology docs so bootstrap becomes an explicit, bounded part
  of the implemented deployment system rather than an implied future procedure.

### Verification Commands

- `buck2 test //...`
- bootstrap and deployment-authority recovery flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch deployment/control-plane runtime, deployment-system topology or
  infrastructure declarations, and the reviewed metadata or command surface used for bootstrap
  execution. Under the deployment-only verify policy, default `v` / CI must still run the full
  build-system verify scope.

### Acceptance Criteria

- The repo has one explicit reviewed bootstrap path for creating or recovering the deployment
  authority itself.
- Bootstrap is bounded to deployment-system-owned infrastructure and cannot become a second routine
  deployment system for ordinary applications.
- Bootstrap prefers exact immutable artifacts, fails closed on identity or ownership ambiguity, and
  reconciles authoritative records once the normal control plane resumes.
- Tests and docs in this PR describe the same self-hosting and recovery posture.

### Risks

Bootstrap is inherently high-risk because it exists exactly when the normal authority is missing or
being created.

### Mitigation

Keep the bootstrap scope intentionally tiny, require separate authority and explicit identity proof,
and force routine updates back through the normal control plane immediately after bootstrap.

### Consequence of Not Implementing

The design would still lack its reviewed path for self-hosting bring-up and for recovering the
deployment authority itself without pretending the half-available control plane is already the
normal mutating authority.

### Downsides for Implementing

Adds a special-case executor path and recovery workflow that must remain carefully bounded forever.

### Recommendation

Implement late, after the normal control-plane contracts are stable, so bootstrap can build on the
fully stabilized resilience posture, records, and observability introduced by the earlier PRs.

---

## PR-27: Repo-level `deploy` front-door and preview-policy closeout for `--validate-only`, `--provision-only`, and `--list`

### Description

I will close the remaining public CLI contract gaps so the repo has one reviewed deploy front door
that actually matches the design's documented operator surface. This PR adds the missing
non-mutating and provision-only entry points, their mutual-exclusion rules, and the reviewed
provisioner-input contract for runs that mutate infrastructure without publishing a new artifact,
while also closing the remaining repo-level preview-policy and preview-identity contract gaps.

### Scope & Changes

- Implement `deploy <id> --validate-only` as a reviewed validation-only path that:
  - validates deployment metadata, provider capability rules, referenced Buck targets, and required
    provider-native config presence
  - does not build, resolve, provision, publish, run `release_actions`, or mutate any external
    state
- Implement `deploy --list` as the canonical non-mutating deployment discovery entry point with one
  stable reviewed output contract suitable for scripting and operator discovery.
- Implement `deploy <id> --provision-only` for both `local_only` and protected/shared flows,
  preserving the reviewed rule that provision-only:
  - still validates
  - does not publish
  - does not run publish-phase `release_actions`
  - binds to one admitted source revision and one frozen execution snapshot for protected/shared
    mutation
- Implement the explicit local-only mutating fallback posture on the repo-level `deploy` path:
  - `local_only` mutation may use a local filesystem lock plus a local structured deployment record
  - that local fallback is non-authoritative and must never be used as the locking or record system
    for shared environments
- Require exact immutable selectors for local-only immutable-reuse flows:
  - `local_only --provision-only` with `immutable_resolved_inputs` requires an explicit immutable
    selector such as `--artifact-ref` or an equivalent exact local record reference
  - `local_only --publish-only` requires one explicit immutable artifact selector or equivalent
    exact local record reference
  - local-only immutable-reuse flows must not implicitly reuse "whatever was built most recently"
    or other ambient local state
- Preserve and normalize the canonical preview-selector contract on the repo-level `deploy` entry
  point:
  - preview-safe local or isolated-preview flows accept exactly one explicit selector such as
    `--preview-branch` or `--preview-commit`
  - protected/shared preview publish and preview cleanup use `--source-run-id` as the canonical
    admitted selector
  - all preview identity inputs normalize to one structured reviewed preview-identity field before
    downstream submission
  - ambient git state, current branch, or provider-default inference is rejected as a mutating
    preview selector
- Require preview support to come only from:
  - an explicit deployment preview-policy block
  - or a documented reviewed provider-capability default preview policy that the deployment has
    opted into
- Implement authoritative effective preview-policy resolution, including provider-wide built-in
  defaults for cleanup TTL or equivalent cleanup trigger, smoke behavior, and preview lock-scope
  separation, with validation treating the resolved preview policy as required once preview is in
  use.
- Implement deterministic preview identity derivation rules so one reviewed preview derivation key
  maps to one active preview slot and drives:
  - isolated preview target identity
  - preview URL derivation
  - cleanup ownership
- Require preview cleanup selectors to identify the preview by the same derivation key or admitted
  source-run identity that created it.
- Make preview cleanup safe to repeat idempotently when the targeted preview is already gone.
- Preserve preview cleanup reason, requesting identity, and effective preview target identity in the
  cleanup record shape.
- Preserve preview-cleanup provenance in the cleanup record shape by recording either:
  - the preview's originating source revision
  - or a stable lineage/reference to the preview-producing run when that is the more meaningful
    audit key
- Add the reviewed provisioner input-class contract:
  - `metadata_only`
  - `immutable_resolved_inputs`
- Require an explicit admitted source selector such as `--source-run-id <deploy-run-id>` whenever a
  protected/shared provisioner uses `immutable_resolved_inputs`.
- Preserve explicit operator-visible run classification, lifecycle, and record semantics for
  provision-only runs rather than treating them as malformed publish runs.
- Enforce the documented mutual-exclusion and flag-compatibility rules for:
  - `--validate-only`
  - `--provision-only`
  - `--publish-only`
  - `--preview`
  - `--preview-cleanup`
- Keep the canonical public operator surface on the repo-level `deploy` entry point rather than
  inventing package-local alternatives for these remaining modes.

### Tests (in this PR)

- Add CLI contract tests for `--validate-only`, `--provision-only`, and `--list`.
- Add tests proving `--validate-only` does not build or mutate.
- Add local-only fallback tests proving:
  - local-only mutating runs use the reviewed local lock and structured local record path
  - shared environments reject any attempt to use the local-only fallback path
- Add local-only exact-selector tests proving:
  - `local_only --provision-only` with `immutable_resolved_inputs` rejects ambient or "latest"
    local state and requires an exact immutable selector
  - `local_only --publish-only` rejects implicit latest-local-build reuse and requires an exact
    immutable artifact selector
- Add preview-selector CLI tests proving:
  - preview-safe local or isolated-preview flows require exactly one of `--preview-branch` or
    `--preview-commit`
  - protected/shared preview and preview cleanup require the reviewed admitted selector surface
  - ambiguous or ambient preview identity is rejected before submission
- Add preview-policy tests rejecting:
  - preview without an explicit or provider-default resolved preview policy
  - provider-default preview policy values that are required but not resolved or validated
  - shared/protected preview replay paths that omit required source-run identity
- Add cleanup-identity tests proving preview cleanup:
  - rejects a different derivation key or admitted selector than the preview used at creation time
  - is safe to repeat idempotently when the preview is already absent
- Add cleanup-record tests proving preview cleanup preserves cleanup reason, requesting identity,
  and effective preview target identity.
- Add preview-cleanup provenance tests proving cleanup records preserve the originating source
  revision or the stable preview-producing-run reference used for audit.
- Add tests proving `--provision-only`:
  - skips publish and publish-phase `release_actions`
  - binds one admitted source revision and frozen execution snapshot for protected/shared runs
  - loads no artifact by default for `metadata_only`
  - requires an explicit admitted source selector for `immutable_resolved_inputs`
- Add mutual-exclusion tests rejecting incompatible flag combinations.
- Add record and status tests proving provision-only runs preserve the reviewed lifecycle and
  operator-visible classification.

### Docs (in this PR)

- Document `--validate-only`, `--provision-only`, and `--list` as part of the stable repo-level
  deploy contract.
- Document the explicit non-authoritative local-only fallback posture and its boundary against
  shared-environment mutation.
- Document the exact-selector contract for local-only immutable-reuse flows.
- Document the canonical preview-selector surface and normalization rules on the repo-level `deploy`
  CLI.
- Document authoritative preview-policy resolution, including provider-capability defaults, and the
  reviewed preview-identity derivation contract.
- Document preview cleanup identity selection and idempotent repeat behavior on the repo-level CLI.
- Document the cleanup-record shape for preview cleanup, including the required originating-source
  or preview-producing-run provenance field.
- Document the reviewed provisioner input-class model and selector requirements.
- Document mutual-exclusion rules and operator-facing behavior for the remaining front-door modes.
- Update operator docs so these entry points are explicit and no longer implied future surface.

### Verification Commands

- `buck2 test //...`
- `deploy --list`
- `deploy <deployment-id> --validate-only`
- `deploy <deployment-id> --provision-only`

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned CLI/front-door code, control-plane request shaping,
  records, and deployment-domain tests. Under the deployment-only verify policy, default `v` / CI
  can run the reviewed deployment suite instead of the full non-deployment build-system verify
  scope.

### Acceptance Criteria

- The repo-level `deploy` CLI now exposes the full reviewed front-door command surface required by
  the design for `--validate-only`, `--provision-only`, and `--list`.
- Local-only mutating flows have one explicit reviewed non-authoritative lock/record posture, and
  shared environments cannot silently fall back to it.
- Local-only immutable-reuse flows require exact immutable selectors and cannot silently reuse
  ambient or most-recent local build state.
- Preview support, selector inputs, and preview identity derivation are normalized and fail closed
  according to one explicit reviewed public CLI contract.
- Preview cleanup remains identity-safe, repeat-safe, and preserves the reviewed cleanup record
  fields.
- Preview-cleanup records preserve the originating source revision or stable preview-producing-run
  reference required for later audit.
- Provision-only runs have explicit reviewed semantics instead of being a missing or partial
  special case.
- Flag interactions fail closed and match the documented operator contract.
- Tests and docs in this PR describe the same front-door behavior.

### Risks

CLI closeout work can accidentally couple operator intent parsing, provisioning semantics, and
control-plane internals into one hard-to-evolve blob.

### Mitigation

Keep the front-door contract explicit, versioned where shared payloads cross boundaries, and
separate operator-intent normalization from the downstream execution logic.

### Consequence of Not Implementing

The design would still overstate the reviewed repo-level `deploy` surface compared with what the
implementation actually exposes.

### Downsides for Implementing

Adds more operator-facing contract surface that must stay stable and well-tested.

### Recommendation

Implement before the remaining provider-breadth PRs so all later provider slices can rely on the
fully reviewed public command surface.

---

## PR-28: Shared lock authority, queue timeout + default supersedence + stale-run revalidation closeout

### Description

I will close the remaining shared-environment execution-policy gap around lock authority, waiting,
supersedence, and staleness. This PR makes the reviewed shared lock authority model, default queue
timeout, narrow auto-supersedence rules, post-lock revalidation behavior, and terminal-state
recording for stale runs explicit and test-covered rather than left as implied control-plane
behavior.

### Scope & Changes

- Elevate the initial shared lock into the reviewed lease/fencing-aware lock contract for shared
  mutation:
  - explicit lease expiry
  - stale-holder protection such as fencing tokens or equivalent reviewed authority proof
  - fail-closed behavior when the current mutating worker no longer holds valid lock authority
- Implement the reviewed default shared-environment queue behavior:
  - bounded wait by default when the effective lock scope is already held
  - default queue timeout of `30 minutes` unless a stricter reviewed policy is documented for the
    target class
- Implement reviewed effective lock-scope derivation rules for shared environments:
  - default lock scope derived from provider plus normalized canonical provider-target identity
  - explicit lock-scope override allowed only as a reviewed escape hatch
  - overrides must validate as at least as strict as the provider-target-derived default and fail
    closed when they would permit unsafe parallel mutation
- Require preview cleanup to acquire the same effective lock scope that governed the preview being
  destroyed:
  - the isolated preview lock when the preview has one
  - the shared normal deployment lock when policy says the preview shares that scope
- Implement narrow default supersedence rules for queued runs:
  - a later admitted normal `deploy` for the same `deployment_id`, same `publish_mode`, and same
    effective `lock_scope` supersedes older queued normal deploy runs by default
  - supersedence is not inferred across different deployment ids, publish modes, or lock scopes
  - preview supersedence is allowed only for the same isolated preview identity or reviewed preview
    slot policy
  - `retry`, `rollback`, `preview_cleanup`, and `--provision-only` are not auto-superseded by
    default
- Revalidate current invariants after lock acquisition before any mutating step begins, including:
  - current admission state
  - target ownership
  - lock or fencing currency
  - any `health_gated` prerequisite still satisfying its declared health requirement using a fresh
    revalidation-time health verdict unless the reviewed prerequisite contract explicitly allows
    equivalent provider evidence
  - supersedence or stale-run status
- Record explicit terminal behavior for queued or stale runs, including:
  - `termination_reason = lock_timeout`
  - superseded exits
  - no-longer-admitted exits after revalidation
- Keep any optional fail-fast or incident-response queue behavior behind an explicit reviewed policy
  surface rather than an implicit default.

### Tests (in this PR)

- Add locking tests proving:
  - the shared lock uses lease-based authority rather than indefinite ownership
  - stale holders cannot continue mutating after lease or fencing authority is lost
  - a replacement holder cannot be raced by an older stale worker still trying to mutate
- Add queue-behavior tests proving shared runs wait with the reviewed bounded timeout by default.
- Add lock-scope tests covering:
  - default lock-scope derivation from canonical provider-target identity
  - reviewed explicit overrides accepted only when they are at least as strict as the default
  - invalid or unsafe overrides rejected fail closed
  - preview cleanup reuses the same effective lock scope as the preview being destroyed
- Add supersedence tests covering:
  - later normal deploy superseding older queued normal deploys for the same deployment and lock
    scope
  - no inferred supersedence across different deployment ids, publish modes, or lock scopes
  - preview supersedence allowed only for the same isolated preview identity or slot policy
  - `retry`, `rollback`, `preview_cleanup`, and `--provision-only` not auto-superseded by default
- Add post-lock revalidation tests proving stale or no-longer-admitted runs exit without mutation.
- Add revalidation tests proving `health_gated` prerequisites require a fresh revalidation-time
  health verdict by default and reject stale or undocumented substitute evidence.
- Add record and status tests proving timeout, supersedence, and stale-run exits preserve the
  reviewed lifecycle and termination reasons.

### Docs (in this PR)

- Document locking behavior, lease-expiry semantics, and stale-holder/fencing expectations for the
  final shared lock contract.
- Document the default shared queue timeout and waiting semantics.
- Document default effective lock-scope derivation and the reviewed lock-scope override escape
  hatch.
- Document preview cleanup effective-lock-scope reuse.
- Document the narrow default supersedence policy and the run kinds excluded from auto-supersedence.
- Document post-lock revalidation, including health-gated prerequisite rechecks, and operator-
  visible stale-run outcomes.
- Update control-plane operator docs so queue and stale-run behavior is explicit rather than
  adapter-local convention.

### Verification Commands

- `buck2 test //...`
- shared queue and status inspection flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned control-plane runtime, lifecycle handling, and
  deployment-domain tests. Under the deployment-only verify policy, default `v` / CI can run the
  reviewed deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- Shared lock authority, waiting behavior, queue timeout, supersedence, and stale-run exits match
  the reviewed design contract.
- Effective lock-scope derivation and explicit override validation are reviewed, explicit, and
  test-covered.
- Stale holders cannot continue mutating after lease or fencing authority is lost, and preview
  cleanup reuses the correct effective lock scope.
- Health-gated prerequisites are revalidated explicitly before mutation rather than trusted from
  earlier queue-entry time.
- Normal deploy supersedence is explicit and narrow by default.
- Non-normal run kinds such as `retry`, `rollback`, `preview_cleanup`, and `--provision-only`
  retain explicit non-superseded behavior unless a reviewed policy says otherwise.
- Tests and docs in this PR describe the same queue and stale-run semantics.

### Risks

Queue and supersedence policy is easy to get subtly wrong in ways that only show up under
concurrency and partial failure.

### Mitigation

Keep the default rules closed and explicit, preserve operator-visible termination reasons, and
cover the negative paths with concurrency-focused tests.

### Consequence of Not Implementing

The shared control plane would still be missing the design's explicit queue timeout, supersedence,
and stale-run policy guarantees.

### Downsides for Implementing

Adds more lifecycle branches and concurrency-heavy test cases.

### Recommendation

Implement immediately after the front-door CLI closeout so the remaining provider slices build on
the final shared waiting and revalidation policy.

---

## PR-29: Canonical non-static component-kind and resolve-contract foundation

### Description

I will expand the deployment foundation beyond the initial static-webapp-only slice so the remaining
provider families can land on one reviewed canonical resolved-component contract instead of
reintroducing provider-specific ad hoc shapes. This PR adds the missing component kinds and
provider-neutral resolved-artifact shapes required for SSR, mobile, service, and third-party
service deployments, while also closing the provider-capability schema gap around default rollout
behavior and protected/shared built-in `release_actions` support declarations.

### Scope & Changes

- Extend authoritative deployment metadata, extraction, and validation for:
  - `ssr-webapp`
  - `mobile-app`
  - `service`
  - `third-party-service`
- Implement the canonical provider-neutral resolved-component contract for those kinds, including:
  - required resolved fields
  - strong immutable artifact identity expectations
  - any required runtime-contract references for the kind
- Extend record and provenance schemas so the new kinds preserve the reviewed resolved-artifact,
  provider-config, and runtime-contract provenance needed for replay and audit.
- Add provider-capability validation hooks so built-in providers must declare support for the new
  kinds before they are considered valid for publication.
- Extend the authoritative provider-capability schema so each reviewed provider can declare:
  - one explicit default rollout mode
  - whether omission of `rollout_policy` is in policy for each reviewed deployment shape
  - whether protected/shared built-in `release_actions` are supported
  - which reviewed built-in action types are allowed or required to be rejected for that provider
    family
- Implement rollout-policy omission validation so:
  - when `rollout_policy` is absent, the provider capability entry's explicit default rollout mode
    applies only for shapes where omission is reviewed and in policy
  - protected/shared multi-component or advanced-rollout shapes fail closed when explicit
    `rollout_policy` is required
  - provider capability entries cannot rely on undocumented implicit rollout defaults
- Backfill the reviewed provider-capability entries for already-implemented providers so their
  default rollout behavior and protected/shared built-in `release_actions` posture are explicit
  instead of implied by runtime convention.
- Extend default smoke-class and release-health classification so the new kinds inherit one reviewed
  baseline instead of provider-local convention.
- Add representative deployment fixtures or sample packages for the new kinds so later provider
  slices exercise reviewed concrete shapes rather than only abstract tests.

### Tests (in this PR)

- Add schema and extraction tests for the new component kinds.
- Add resolve-contract tests proving each new kind emits the reviewed provider-neutral fields and
  immutable artifact identity shape.
- Add validation tests rejecting provider/component combinations that lack reviewed capability
  support.
- Add provider-capability tests proving:
  - explicit default rollout mode is required
  - `rollout_policy` omission is accepted only for shapes where the provider capability says it is
    in policy
  - protected/shared shapes that require explicit rollout metadata fail closed when it is omitted
  - protected/shared built-in `release_actions` support and allowed/rejected action-type
    declarations are explicit
- Add record and provenance tests asserting the new kinds preserve the required artifact,
  provider-config, and runtime-contract references.
- Add smoke-class defaulting tests for `ssr-webapp`, `mobile-app`, `service`, and
  `third-party-service`.

### Docs (in this PR)

- Document the canonical resolved-component registry for the new kinds.
- Update schema, provider-capability, and scenarios docs so the new kinds are part of the reviewed
  implementation contract rather than design-only vocabulary.
- Document the reviewed provider-capability default-rollout contract and the omission-is-in-policy
  rule for `rollout_policy`.
- Document the provider-capability declaration surface for protected/shared built-in
  `release_actions`, including allowed/rejected built-in action types.
- Document artifact identity expectations and record/provenance requirements for the new kinds.
- Document the default smoke or release-health classification for each new kind.

### Verification Commands

- `buck2 test //...`
- resolve and metadata inspection flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch shared build-system metadata extraction, canonical resolve/record
  contracts, provider-capability validation, and concrete deployment fixtures for the new kinds.
  Under the deployment-only verify policy, default `v` / CI must still run the full build-system
  verify scope.

### Acceptance Criteria

- The repo has reviewed authoritative metadata and resolved-artifact contracts for `ssr-webapp`,
  `mobile-app`, `service`, and `third-party-service`.
- Provider capability entries now expose explicit default rollout behavior and protected/shared
  built-in `release_actions` posture instead of relying on undocumented defaults.
- Providers must declare support explicitly before accepting those kinds.
- Records and provenance preserve the information needed to replay and audit the new kinds.
- Tests and docs in this PR describe the same kind-level contract.

### Risks

If kind semantics drift between extraction, resolve, providers, and records, later provider slices
will recreate the same ambiguity this plan has been trying to remove.

### Mitigation

Land the kind registry, resolve shapes, and provenance contract together before widening provider
support.

### Consequence of Not Implementing

The later provider-family PRs would either stall or reintroduce provider-specific artifact contracts
that contradict the design.

### Downsides for Implementing

Adds foundational schema and contract breadth before the corresponding provider adapters are all
visible end to end.

### Recommendation

Implement before the remaining provider-family PRs so they all build on one reviewed non-static
kind foundation.

---

## PR-30: `s3-static` provider family + `aws-s3-sync` static-webapp slice

### Description

I will add the reviewed `s3-static` provider family so the design's static-site model is not
limited to Cloudflare Pages and shared-host publishing. This PR covers repo-owned bucket or CDN
setup, exact-artifact publish, authoritative target identity, and static smoke behavior for S3-like
static hosting.

### Scope & Changes

- Add the authoritative provider-capability entry for `s3-static`.
- Implement the first reviewed `s3-static` provider slice for exactly one `static-webapp`
  component.
- Add canonical `provider_target` identity and lock-scope rules for S3-style static hosting, such
  as bucket plus account or distribution identity.
- Implement the built-in static publisher contract for `aws-s3-sync` or equivalent reviewed
  immutable-artifact upload behavior.
- Implement reviewed provisioner support for `terraform-stack` and `cdktf-stack` where the repo
  owns bucket, CDN, DNS, or related environment setup.
- Add provider-config validation so deployment metadata remains authoritative for target identity
  and repo-owned setup rather than letting provider-local config silently retarget publish.
- Define the reviewed preview, rollout, smoke, and retry posture for the initial `s3-static`
  capability entry, failing closed on unsupported shapes.

### Tests (in this PR)

- Add provider-capability tests for `s3-static`.
- Add validation tests rejecting unsupported component kinds, rollout modes, or preview shapes for
  the reviewed initial slice.
- Add end-to-end tests for:
  - exact-artifact static publish
  - repo-owned provision plus publish flow
  - canonical target-identity and lock-key derivation
  - static HTTP smoke against the reviewed canonical URL
- Add tests rejecting provider-config drift and ambiguous target identity.
- Add retry/idempotency tests for clearly safe retry versus fail-closed ambiguous publish outcomes.

### Docs (in this PR)

- Document the `s3-static` provider capability entry and operator-facing limitations.
- Document the repo-owned provision plus publish workflow for static sites on S3-style hosting.
- Document target-identity, smoke, and retry behavior for the reviewed initial slice.
- Update scenarios docs so S3 static hosting is no longer an abstract example only.

### Verification Commands

- `buck2 test //...`
- `deploy <deployment-id>` flows introduced for the `s3-static` slice

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to combine provider runtime work, provider-capability metadata, and concrete
  deployment fixtures or provider-config inputs for the new static-hosting slice. Under the
  deployment-only verify policy, default `v` / CI must still run the full build-system verify
  scope.

### Acceptance Criteria

- The repo has one reviewed built-in `s3-static` provider family for `static-webapp` deployments.
- Exact-artifact publish, target identity, provisioner support, and smoke behavior are explicit and
  test-covered.
- Provider-config drift and unsupported shapes fail closed.
- Docs and tests in this PR describe the same provider slice.

### Risks

Static hosting on S3-style infrastructure is easy to trivialize into "just sync files," which hides
target identity, CDN, and setup drift problems.

### Mitigation

Keep target identity authoritative in deployment metadata, validate provider-config drift, and make
repo-owned provisioning and smoke behavior part of the same reviewed slice.

### Consequence of Not Implementing

The design would still claim broader static-hosting fit than the implementation actually provides.

### Downsides for Implementing

Adds another provider family with its own target-identity, retry, and provisioning nuances.

### Recommendation

Implement after the non-static kind foundation so the remaining provider-family breadth begins with
the simplest additional provider slice.

---

## PR-31: `kubernetes` provider family + `helm-release` service and shared-platform slices

### Description

I will add the reviewed `kubernetes` provider family so the deployment model covers service-style
workloads, sidecars, and shared platform deployments rather than only static-webapp hosting. This
PR lands the built-in `helm-release` path, reviewed service and third-party-service component
support, and the first real shared-platform deployment slice such as a shared observability stack.

### Scope & Changes

- Add the authoritative provider-capability entry for `kubernetes`.
- Implement the first reviewed `kubernetes` provider slice with:
  - `service`
  - `third-party-service`
    component kinds
- Add the built-in publisher contract for `helm-release` or the equivalent reviewed Kubernetes
  release path.
- Add reviewed provisioner support for `terraform-stack` and `cdktf-stack` for namespace, ingress,
  storage, service-account, or related cluster-side setup.
- Support the first reviewed deployment shapes for this provider family:
  - single service release
  - service plus sidecar or companion component in one deployment
  - shared platform deployment such as a shared observability stack
- Define the reviewed rollout, smoke, retry, release-action, and partial-publish posture for the
  initial Kubernetes slice, including any explicitly supported progressive mode that the provider
  can read back safely.
- Preserve provider-target identity, namespace or release identity, and per-component publish state
  in authoritative records and replay snapshots.

### Tests (in this PR)

- Add provider-capability tests for `kubernetes`.
- Add validation tests rejecting unsupported mixes, rollout modes, or target shapes for the
  reviewed slice.
- Add end-to-end tests for:
  - single service publish
  - service plus sidecar rollout
  - shared platform deployment publish
  - repo-owned provision plus publish flow
- Add tests covering release-action execution and replay behavior for the reviewed Kubernetes slice.
- Add tests proving canonical target identity, smoke, and partial publish state are preserved in
  records and replay snapshots.

### Docs (in this PR)

- Document the `kubernetes` provider capability entry and supported component shapes.
- Document the built-in `helm-release` contract and the reviewed provisioner options.
- Document how service deployments, sidecars, and shared platform deployments fit the deployment
  model in implementation rather than only in examples.
- Update third-party infrastructure and shared-platform docs so the Kubernetes-backed path is
  explicit and operator-ready.

### Verification Commands

- `buck2 test //...`
- Kubernetes service and shared-platform deploy flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch provider runtime, provider-capability metadata, non-static component
  support, release-action integration, and concrete deployment fixtures for Kubernetes-backed
  systems. Under the deployment-only verify policy, default `v` / CI must still run the full
  build-system verify scope.

### Acceptance Criteria

- The repo has one reviewed built-in `kubernetes` provider family for service-style and
  shared-platform deployments.
- `service` and `third-party-service` deployments are no longer abstract-only kinds.
- Shared platform deployments such as observability stacks are explicitly supported and
  test-covered.
- Docs and tests in this PR describe the same Kubernetes-backed provider slice.

### Risks

Service and platform deployments can blur provisioning, publishing, side effects, and ownership in
ways that tempt adapter-specific shortcuts.

### Mitigation

Keep provider-target identity, publisher contract, provisioner contract, and release-action posture
explicit in the capability entry and record model from the first slice.

### Consequence of Not Implementing

The design would still lack its reviewed service-style and shared-platform provider-family support.

### Downsides for Implementing

Adds a complex provider family with non-trivial setup, release, and observability expectations.

### Recommendation

Implement after `s3-static` so the plan widens from simpler static hosting into the larger service
and shared-platform provider family.

---

## PR-32: `nixos-shared-host` `ssr-webapp` slice + reviewed SSR runtime contract

### Description

I will close the SSR fit gap by extending the existing reviewed host-based provider family to
support `ssr-webapp` as a first-class kind with an explicit runtime contract. This PR makes SSR a
real deployment shape instead of an abstract kind name, while keeping the same immutable-artifact,
target-identity, and replay guarantees used elsewhere in the design.

### Scope & Changes

- Extend the authoritative `nixos-shared-host` capability entry to support reviewed `ssr-webapp`
  deployments.
- Define the reviewed SSR runtime contract for the initial host-based slice, including:
  - immutable SSR application artifact identity
  - runtime expectations needed by the built-in publisher
  - environment-neutral build expectations for promotion-safe lanes
  - runtime-config and secret injection boundaries
- Extend the lane-compatibility contract for promotion-safe SSR lanes so runtime contract,
  publisher type, and required serving-topology assumptions are explicit compatibility inputs.
- Implement host realization and publish support for the SSR slice on managed `nixos-shared-host`
  targets.
- Add built-in smoke or release-health behavior appropriate for the SSR serving contract instead of
  inferring behavior from app structure ad hoc.
- Extend records and replay snapshots so SSR runs preserve the runtime-contract and provider-config
  provenance needed for exact replay and audit.
- Define the reviewed rollout, preview, retry, rollback, and promotion posture for the initial SSR
  slice, failing closed where the host-based path does not yet safely support a behavior.

### Tests (in this PR)

- Add provider-capability tests for `nixos-shared-host` `ssr-webapp` support.
- Add validation tests rejecting unsupported SSR shapes or rollout modes for the reviewed slice.
- Add validation tests rejecting SSR lane promotion when runtime contract, publisher type, or
  serving-topology assumptions fall outside the reviewed compatibility contract.
- Add end-to-end host realization and publish tests for an SSR deployment on a managed host.
- Add HTTP or release-health smoke tests for the SSR runtime contract.
- Add record and replay tests proving SSR runtime-contract and provider-config provenance are
  preserved for later immutable-reuse flows.

### Docs (in this PR)

- Document the reviewed `ssr-webapp` runtime contract for the host-based provider slice.
- Document the SSR-specific lane-compatibility inputs required for promotion-safe lanes.
- Update provider-capability and schema docs so SSR support is explicit and no longer only design
  fit guidance.
- Document smoke, replay, and rollout behavior for the initial SSR slice.
- Update operator docs and scenarios so non-static SSR web apps become an implemented path.

### Verification Commands

- `buck2 test //...`
- host-based SSR deploy flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to combine new component-kind support, provider runtime changes, host
  realization changes, and concrete SSR deployment fixtures. Under the deployment-only verify
  policy, default `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- `ssr-webapp` is a reviewed implemented deployment shape, not just an abstract schema term.
- The reviewed host-based provider slice documents and enforces one explicit SSR runtime contract.
- Promotion-safe SSR lanes have explicit reviewed compatibility inputs instead of relying on
  implicit similarity.
- SSR runs preserve the provenance and replay information required by the design.
- Docs and tests in this PR describe the same SSR deployment slice.

### Risks

SSR support can easily collapse into a vague "service-like" bucket that loses the web-app-specific
runtime and smoke contract the design is trying to preserve.

### Mitigation

Keep `ssr-webapp` explicit, document the runtime contract tightly, and fail closed where the host
path cannot yet prove a behavior safely.

### Consequence of Not Implementing

The design would still overstate SSR support relative to the actual reviewed implementation.

### Downsides for Implementing

Adds a new runtime-bearing deployment shape on top of an existing provider family.

### Recommendation

Implement after the Kubernetes service slice so SSR lands on the broader non-static kind foundation
without being collapsed into the generic service path.

---

## PR-33: `app-store-connect` `mobile-app` slice + staged release-health contract

### Description

I will add the first reviewed mobile-store provider family so the design's `mobile-app` model is no
longer theoretical. This PR covers App Store Connect style release publishing, exact-artifact
promotion through branch-backed lanes, staged rollout or release-health evaluation, and the
reviewed record shape for store-distributed releases.

### Scope & Changes

- Add the authoritative provider-capability entry for `app-store-connect`.
- Implement the first reviewed `mobile-app` publisher slice for signed immutable iOS release
  artifacts.
- Add canonical `provider_target` identity and lane/promotion semantics for App Store Connect style
  tracks or channels.
- Extend the lane-compatibility contract for promotion-safe mobile lanes so store track or channel
  progression, staged-rollout policy, signing model, and publisher type are explicit compatibility
  inputs.
- Implement the built-in publisher contract for upload, processing validation, staged rollout, and
  release-track advancement using admitted immutable artifacts rather than ad hoc local release
  scripts.
- Define the reviewed smoke or release-health contract for mobile-store releases, such as upload
  validation, processing status, installability, staged rollout health, or equivalent provider
  evidence.
- Preserve store submission ids, track state, rollout state, and release-health evidence in
  authoritative records and replay snapshots.
- Define the reviewed preview, retry, rollback, promotion, and progressive rollout posture for the
  initial App Store Connect slice, failing closed where a store behavior cannot be made
  deterministic.

### Tests (in this PR)

- Add provider-capability tests for `app-store-connect`.
- Add validation tests rejecting unsupported mobile shapes or rollout modes for the reviewed slice.
- Add validation tests rejecting mobile-lane promotion when track/channel, staged-rollout policy,
  signing model, or publisher type fall outside the reviewed compatibility contract.
- Add end-to-end tests for:
  - signed artifact upload and submission
  - exact-artifact promotion across reviewed mobile lanes
  - staged rollout or release-health validation
- Add tests proving store-specific release-health evidence is preserved in records and status views.
- Add replay and rollback tests for the reviewed mobile-store reuse flows that are in policy.

### Docs (in this PR)

- Document the `app-store-connect` provider capability entry and built-in publisher contract.
- Document branch-backed mobile lane behavior, track identity, staged release-health semantics, and
  the mobile-specific promotion-compatibility inputs.
- Document the reviewed mobile record, replay, and operator workflow for this provider family.
- Update the mobile-store fit section so App Store Connect is an implemented provider slice.

### Verification Commands

- `buck2 test //...`
- App Store Connect mobile release flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch non-static component-kind support, provider runtime, provider-
  capability metadata, mobile deployment fixtures, and record or replay behavior. Under the
  deployment-only verify policy, default `v` / CI must still run the full build-system verify
  scope.

### Acceptance Criteria

- The repo has one reviewed built-in mobile-store provider family for signed iOS releases.
- Mobile branch-backed promotion, store processing, and staged release-health are explicit and
  test-covered.
- Promotion-safe mobile lanes have explicit reviewed compatibility inputs rather than implied store
  similarity.
- Records preserve enough provider-specific release state to support audit and reuse decisions.
- Docs and tests in this PR describe the same mobile-store slice.

### Risks

Mobile-store release systems have asynchronous provider behavior that can tempt the implementation
into polling and state handling that is hard to reason about.

### Mitigation

Keep provider-target identity, release-health evidence, staged state, and reuse rules explicit in
the capability entry and authoritative records from the first slice.

### Consequence of Not Implementing

The design would still overstate mobile-store support relative to the actual implementation.

### Downsides for Implementing

Adds another high-latency provider family with asynchronous release state and store-specific
semantics.

### Recommendation

Implement after the SSR slice so the non-static kind foundation is exercised across both web and
mobile release models before the final mobile-store family lands.

---

## PR-34: `google-play` `mobile-app` slice + staged rollout and release-track progression

### Description

I will complete the mobile-store provider-family coverage by adding the reviewed Google Play slice.
This PR covers Android signed-artifact upload, staged rollout or track progression, exact-artifact
promotion through branch-backed lanes, and the authoritative record model for Google Play style
release state.

### Scope & Changes

- Add the authoritative provider-capability entry for `google-play`.
- Implement the reviewed `mobile-app` publisher slice for signed immutable Android release
  artifacts.
- Add canonical `provider_target` identity and track or channel semantics for Google Play releases.
- Extend the lane-compatibility contract for reviewed Google Play promotion-safe lanes so track or
  channel progression, staged-rollout policy, signing model, and publisher type are explicit
  compatibility inputs.
- Implement the built-in publisher contract for upload, processing, staged rollout, and track
  progression using admitted immutable artifacts.
- Define the reviewed smoke or release-health contract for Google Play style releases, such as
  processing success, staged rollout health, installability, and reviewed track-state evidence.
- Preserve Google Play submission ids, track state, rollout state, and release-health evidence in
  authoritative records and replay snapshots.
- Define the reviewed retry, rollback, promotion, and progressive rollout posture for this mobile
  provider family, failing closed where deterministic continuation cannot be proven.

### Tests (in this PR)

- Add provider-capability tests for `google-play`.
- Add validation tests rejecting unsupported Android/mobile shapes or rollout modes for the reviewed
  slice.
- Add validation tests rejecting Android/mobile lane promotion when track/channel, staged-rollout
  policy, signing model, or publisher type fall outside the reviewed compatibility contract.
- Add end-to-end tests for:
  - signed Android artifact upload and release creation
  - exact-artifact promotion across reviewed mobile lanes
  - staged rollout or track progression with release-health validation
- Add tests proving provider-specific release state is preserved in authoritative records and status
  outputs.
- Add replay and rollback tests for the reviewed Google Play reuse flows that are in policy.

### Docs (in this PR)

- Document the `google-play` provider capability entry and built-in publisher contract.
- Document Android branch-backed lane behavior, track identity, staged rollout, and release-health
  semantics, and the Android-specific promotion-compatibility inputs.
- Document the reviewed operator workflow and record expectations for this provider family.
- Update the mobile-store fit section so Google Play is an implemented provider slice alongside App
  Store Connect.

### Verification Commands

- `buck2 test //...`
- Google Play mobile release flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch mobile provider runtime, provider-capability metadata, mobile
  deployment fixtures, and record or replay behavior. Under the deployment-only verify policy,
  default `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- The repo has reviewed built-in mobile-store support for signed Android releases.
- Track progression, staged rollout, and release-health behavior are explicit and test-covered.
- Promotion-safe Android/mobile lanes have explicit reviewed compatibility inputs rather than
  implied store similarity.
- Records preserve enough Google Play release state to support audit and reuse decisions.
- Docs and tests in this PR describe the same Android/mobile-store slice.

### Risks

Google Play release behavior adds another asynchronous provider family with store-specific rollout
state and error surfaces.

### Mitigation

Keep the provider-target, rollout state, health evidence, and authoritative record contract explicit
and fail closed when provider behavior cannot be interpreted deterministically.

### Consequence of Not Implementing

The design would still lack full reviewed mobile-store provider-family coverage even if iOS support
exists.

### Downsides for Implementing

Adds a second store-specific provider family with its own release semantics and test surface.

### Recommendation

Implement late so the final mobile-store provider can reuse the same non-static, progressive, and
recording foundations already exercised by the earlier provider-family PRs.

---

## PR-35: Admission attestation, SBOM, and supply-chain policy enforcement closeout

### Description

I will close the remaining admission-policy trust gap by making artifact attestation and
supply-chain policy first-class protected/shared admission behavior instead of leaving those fields
as schema-only design intent. This PR adds the reviewed attestation-verification contract, trusted
builder and signer identity policy, SBOM requirements, and supply-chain admission gates that must
pass before protected/shared mutation is admitted.

### Scope & Changes

- Extend authoritative `admission_policy` support so protected/shared policy objects can define:
  - trusted builder identity or identity set
  - accepted provenance or predicate format
  - artifact-identity binding back to source revision plus build inputs
  - verifier behavior for expired, revoked, or no-longer-trusted attestation material
  - artifact-signature requirements where policy demands them
  - SBOM or equivalent dependency-inventory requirements where policy demands them
  - vulnerability, license, or other supply-chain gates and whether they apply at build admission,
    publish admission, or both
- Implement reviewed attestation and signature verification for protected/shared publishing runs.
- Implement reviewed SBOM-presence and minimum-format validation where the admission policy
  requires it.
- Implement supply-chain gate evaluation as part of mutating admission, failing closed when:
  - attestation material is missing
  - builder or signer identity is untrusted
  - provenance does not bind to the admitted source revision and artifact identity
  - required SBOM material is missing or invalid
  - required vulnerability, license, or equivalent policy gates do not pass
- Preserve attestation, SBOM, and supply-chain evaluation facts in secret-safe records and replay
  snapshots so later audit and replay decisions remain explainable.
- Keep these checks transport-agnostic and reusable across deploy, promotion, rollback, preview,
  and any other protected/shared publish path that consumes an admitted artifact.

### Tests (in this PR)

- Add admission-policy schema and validation tests for the attestation and supply-chain fields.
- Add admission tests rejecting protected/shared mutation when:
  - attestation material is missing
  - builder or signer identity is untrusted
  - provenance does not bind the artifact to the admitted source revision and build inputs
  - attestation is expired, revoked, or otherwise no longer trusted
  - required SBOM material is missing or invalid
  - required vulnerability or license gates fail
- Add tests covering policy timing semantics where supply-chain gates apply at build admission,
  publish admission, or both.
- Extend record and replay tests to assert attestation and supply-chain evaluation facts are
  preserved in a secret-safe form.

### Docs (in this PR)

- Document the protected/shared `admission_policy` attestation, signature, SBOM, and supply-chain
  contract.
- Document how trusted builder or signer identity, provenance format, and artifact/source binding
  are evaluated.
- Document the fail-closed behavior for missing or untrusted attestation material and failed
  supply-chain gates.
- Update contract and operator docs so these protected/shared admission requirements are explicit in
  implementation rather than design-only policy text.

### Verification Commands

- `buck2 test //...`
- admission, attestation, and supply-chain verification flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch admission-policy metadata, shared control-plane admission behavior,
  record or replay contracts, and deployment-domain tests. Under the deployment-only verify policy,
  default `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- Protected/shared mutation enforces the reviewed attestation, signature, SBOM, and supply-chain
  gates defined by `admission_policy`.
- Missing, drifted, expired, revoked, or untrusted attestation material fails closed.
- Records and replay snapshots preserve enough secret-safe evidence to explain attestation and
  supply-chain admission decisions.
- Tests and docs in this PR describe the same protected/shared admission trust contract.

### Risks

Supply-chain policy can become a half-implemented checkbox feature if verification, policy timing,
and evidence persistence do not stay aligned.

### Mitigation

Bind the checks to the same admitted artifact identity and source snapshot used for mutation, and
test both positive and fail-closed paths in the same PR.

### Consequence of Not Implementing

The design would still overstate the protected/shared admission contract by naming attestation,
SBOM, and supply-chain gates that the implementation does not actually enforce.

### Downsides for Implementing

Adds more admission-policy breadth, verification logic, and evidence handling to protected/shared
publishing.

### Recommendation

Implement after the provider-family breadth is in place so the final admission trust contract can
be enforced consistently across every reviewed protected/shared publish path.

---

## PR-36: Protected/shared `smoke.exception` policy + explicit smoke-outcome closeout

### Description

I will close the final smoke-policy gap by making protected/shared smoke exceptions explicit,
validated, and enforced through authoritative deployment metadata instead of leaving them as design
guidance. This PR adds the `smoke.exception` object contract, validates its required review fields,
and preserves the reviewed distinction between "publish succeeded" and "smoke failed" in
operator-visible results and records.

### Scope & Changes

- Implement authoritative deployment-metadata support for protected/shared `smoke.exception`.
- Enforce the minimum `smoke.exception` contract, including:
  - `owner`
  - `reason`
  - `scope`
  - one review-boundary field: `review_by` or `expires_at`
  - optional explicit downgrade mode when smoke is reduced rather than omitted
- Fail closed when protected/shared smoke is omitted or downgraded without a valid
  `smoke.exception`.
- Ensure validators and admission logic read `smoke.exception` only from authoritative deployment
  metadata, not provider config files or deployment-local executable hooks.
- Preserve the canonical outcome distinction where:
  - publish may succeed
  - smoke may fail
  - the overall deployment result records that as a distinct operator-visible outcome rather than a
    generic undifferentiated failure
- Support reviewed preview smoke relaxation only when the deployment or provider slice explicitly
  documents that lighter preview smoke posture.
- Keep local-only behavior intentionally looser where the design allows it, without weakening the
  protected/shared contract.

### Tests (in this PR)

- Add metadata-validation tests for `smoke.exception`, including rejection of:
  - missing required fields
  - missing review boundary
  - protected/shared smoke omission without an exception object
  - exception definitions that appear only in provider config or executable hooks
- Add admission and execution tests proving protected/shared smoke remains blocking by default
  unless a valid reviewed `smoke.exception` is present.
- Add tests proving preview may use a lighter smoke policy only when that difference is explicitly
  documented by deployment metadata or provider capability policy.
- Add record and status tests proving "publish succeeded, smoke failed" is preserved as a distinct
  operator-visible result shape.
- Add tests for exception expiry or review-boundary failure where the exception is no longer valid.

### Docs (in this PR)

- Document the protected/shared `smoke.exception` contract and required fields.
- Document when smoke may be downgraded or omitted, and when it must remain blocking.
- Document the operator-visible distinction between publish success and overall smoke failure.
- Update smoke-policy and operator docs so the exception path is explicit and reviewed rather than
  implied by omission.

### Verification Commands

- `buck2 test //...`
- smoke-policy and result-inspection flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch deployment metadata validation, smoke-policy handling, records or
  status surfaces, and deployment-domain tests. Under the deployment-only verify policy, default
  `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- Protected/shared smoke remains blocking by default unless a valid reviewed `smoke.exception` is
  present in authoritative deployment metadata.
- Invalid, expired, or missing exceptions fail closed.
- Publish-success and smoke-failure outcomes remain distinguishable in records and operator-facing
  status.
- Tests and docs in this PR describe the same smoke-exception and smoke-outcome contract.

### Risks

Smoke-policy exceptions are easy to weaken through silent omission or by letting provider-local
config bypass authoritative deployment metadata.

### Mitigation

Make the exception object explicit, validate it at the deployment-metadata layer, and preserve the
outcome distinction in canonical records so operators can see exactly what happened.

### Consequence of Not Implementing

The design would still overstate the protected/shared smoke contract by requiring explicit reviewed
exceptions that the implementation does not actually validate or enforce.

### Downsides for Implementing

Adds another protected/shared policy object and more result-shape cases to records and status
surfaces.

### Recommendation

Implement late so the repo-level deployment model, admission trust contract, and protected/shared
smoke posture are explicit before the remaining execution, governance, and compatibility closeout
work lands.

---

## PR-37: `secretspec`/Vault backend + protected/shared credential-lifecycle closeout

### Description

I will close the remaining secret-runtime gap by making `secretspec` and the initial Vault-backed
protected/shared credential model real instead of leaving them as design-level intent. This PR
adds the reviewed secret-contract resolution path, backend boundary, least-privilege credential
posture, renewal/reacquire rules, and fail-closed execution behavior for expiring or revoked
credentials during protected/shared mutation.

### Scope & Changes

- Implement `secretspec` as the authoritative repo-level secret-contract interface for deployment
  runtime inputs.
- Implement Vault as the initial production backend behind that interface for protected/shared
  flows, while keeping the contract backend-switchable so deployment metadata semantics do not
  depend on Vault-specific details.
- Resolve admitted secret-contract references and non-secret secret-version or selector identities
  through the shared control plane without leaking secret material into Buck metadata, checked-in
  files, records, or replay snapshots.
- Define and enforce the protected/shared runtime-credential posture, including:
  - least-privilege provider credentials per lifecycle step and target scope
  - preference for short-lived or renewable credentials where the provider supports them
  - explicit renewal or reacquire behavior when a run may outlive one credential lease
  - fail-closed behavior when a required credential expires, is revoked, or cannot be renewed
- Keep break-glass credentials segregated from routine mutation credentials and usable only through
  the explicitly audited emergency path.
- Preserve the admitted non-secret secret-contract references needed for deterministic retry,
  rollback, and replay without turning secret backends into a second source of truth for deployment
  metadata.

### Tests (in this PR)

- Add secret-contract tests covering:
  - `secretspec` resolution through the reviewed backend boundary
  - missing required secret contracts
  - backend-agnostic contract semantics despite Vault as the initial backend
- Add protected/shared execution tests proving:
  - least-privilege credentials are selected per lifecycle step
  - renewable credentials are renewed or reacquired without widening scope
  - expired, revoked, or non-renewable required credentials fail closed with the affected step
    recorded
- Add tests rejecting secret leakage into Buck metadata, provider-config snapshots, records, replay
  snapshots, logs, or operator-visible status surfaces.
- Add break-glass tests proving emergency credentials remain segregated from the normal execution
  path.

### Docs (in this PR)

- Document `secretspec` as the authoritative secret-contract layer and Vault as the initial
  production backend behind it.
- Document protected/shared credential posture, renewal or reacquire rules, and fail-closed
  behavior on expiry or revocation.
- Document secret-contract replay semantics and the boundary between secret references versus secret
  values.
- Update operator docs so the normal path and break-glass credential models are explicit and
  distinct.

### Verification Commands

- `buck2 test //...`
- secret-contract and credential-lifecycle inspection flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch deployment metadata contracts, shared control-plane runtime input
  resolution, secret backend integration, records or replay handling, and deployment-domain tests.
  Under the deployment-only verify policy, default `v` / CI must still run the full build-system
  verify scope.

### Acceptance Criteria

- Protected/shared mutation uses `secretspec` as the reviewed secret-contract interface and Vault
  as the initial production backend behind it.
- Secret values never cross into Buck metadata, checked-in files, durable records, replay
  snapshots, or unredacted operator-visible surfaces.
- Credential renewal or reacquire behavior is explicit, least-privilege, and fail-closed.
- Tests and docs in this PR describe the same secret-contract and credential-lifecycle model.

### Risks

Secret-contract and credential-lifecycle work can sprawl across many execution paths and become
hard to reason about if the backend boundary and runtime authority are not kept explicit.

### Mitigation

Keep `secretspec` as the stable repo contract, keep Vault behind that boundary, and test
credential-selection, renewal, expiry, and redaction behavior in the same PR.

### Consequence of Not Implementing

The design would still overstate the protected/shared secret and credential model by naming a
repo-level contract, initial backend, and renewal posture that the implementation does not actually
provide.

### Downsides for Implementing

Adds secret-backend integration and more execution-path complexity to the shared control plane.

### Recommendation

Implement first in this final tail so later retry, smoke, and provenance closeout work can rely on
one explicit secret and credential model.

---

## PR-38: Cross-cutting publish-safety, retry, and smoke timeout-budget closeout

### Description

I will close the remaining lifecycle-execution policy gap by implementing the design's explicit
publish-safety, automatic-retry, and timeout-budget contract instead of leaving those behaviors to
provider-local convention. This PR adds the reviewed cross-cutting rules for when a publish may
no-op, when unchanged components may be skipped, when publish or smoke may retry, which steps must
not auto-retry, how backoff and timeout budgets are applied, and how operators see those decisions
in records and status.

### Scope & Changes

- Implement the reviewed step-specific automatic-retry policy:
  - `validate`, `build`, and `resolve` do not auto-retry
  - `provision` does not auto-retry by default
  - `publish` may auto-retry only for clearly transient failures when the adapter can prove the
    earlier attempt did not take effect or prove the retry is idempotent for that provider
  - `smoke` may auto-retry only for transient readiness or network failures
- Implement the reviewed cross-cutting publish-safety contract:
  - publishers consume explicit resolved artifact inputs and never rediscover artifacts from mutable
    local working state
  - when a provider exposes enough identity to compare the current live release with the resolved
    artifact identity, an exact identity match is treated as a no-op by default rather than forcing
    a redundant re-publish
  - when one component in a multi-component deployment is unchanged, it may be skipped only when
    the adapter can prove live identity match and rollout, provider, and `release_action` policy do
    not require republish
  - when the adapter cannot prove live identity match safely, it may republish conservatively but
    must not claim the component was proven unchanged
- Implement the reviewed publish retry ceiling of up to `2` retries with backoff and fail closed
  behavior when duplicate-execution safety cannot be proven.
- Implement the reviewed smoke timeout-budget model and standardized default smoke classes:
  - `static-webapp`: `5 minutes` total budget including retries
  - `ssr-webapp`: `10 minutes` total budget including retries
  - `mobile-app`: adapter-defined release-health validation rather than URL smoke by default
  - `service` and `third-party-service`: `10 minutes` total budget including retries
- Implement explicit timeout or budget override support only through deployment metadata or explicit
  built-in adapter policy, never through undocumented per-environment convention.
- Preserve retry attempt counts, budget exhaustion, and retry-decision facts in records and
  operator-visible status so automatic retry reduces false negatives without hiding the final
  outcome.
- Keep provider adapters responsible for the provider-specific proof of safe retry while enforcing
  one shared control-plane policy vocabulary and one reviewed operator contract.

### Tests (in this PR)

- Add lifecycle-policy tests proving:
  - `validate`, `build`, and `resolve` never auto-retry
  - `provision` does not auto-retry by default
  - `publish` retries only on reviewed safe transient cases
  - ambiguous or non-idempotent publish results fail closed without blind retry
- Add publish-safety tests proving:
  - exact live-identity match results in a no-op only when the provider can prove it
  - unchanged components may be skipped only when rollout and `release_action` posture permit it
  - ambiguous live identity does not get reported as proven unchanged
- Add smoke-policy tests proving:
  - default smoke timeout budgets derive from component kind or explicit smoke runner class
  - smoke retries stay within the total timeout budget
  - retries do not hide final smoke failure
  - undeclared timeout overrides are rejected
- Add record and status tests proving retry counts, retry reasons, and timeout-budget exhaustion are
  preserved in operator-visible outputs.
- Extend provider-slice tests where needed so built-in adapters prove their reviewed retry posture
  through the shared policy contract.

### Docs (in this PR)

- Document the cross-cutting automatic-retry policy by lifecycle step.
- Document the cross-cutting publish-safety and no-op/unchanged-component rules.
- Document the standardized smoke timeout-budget defaults and override rules.
- Document the operator-visible meaning of no-op publish decisions, automatic retry, backoff,
  budget exhaustion, and final smoke failure after retries.
- Update provider-capability and operator docs so retry posture is explicit rather than inferred.

### Verification Commands

- `buck2 test //...`
- lifecycle retry and smoke-budget inspection flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch shared control-plane lifecycle logic, smoke-policy handling,
  provider-adapter retry hooks, record or status surfaces, and deployment-domain tests. Under the
  deployment-only verify policy, default `v` / CI must still run the full build-system verify
  scope.

### Acceptance Criteria

- Publishers follow one reviewed no-op/unchanged-component publish-safety contract instead of
  provider-local convention.
- Automatic retry behavior matches the reviewed step-by-step contract instead of adapter-local
  convention.
- Smoke timeout budgets are explicit, standardized, and test-covered across the implemented
  component kinds.
- Operators can see when no-op/skip decisions or retries occurred, why they were permitted, and why
  a run still failed.
- Tests and docs in this PR describe the same retry and timeout-budget behavior.

### Risks

Retry logic is dangerous when the shared policy says one thing and an adapter quietly does another.

### Mitigation

Centralize the shared retry policy, require provider slices to prove safe retry explicitly, and
persist retry decisions in records so they remain auditable.

### Consequence of Not Implementing

The design would still overstate the reviewed execution policy by describing explicit retry ceilings
and timeout budgets that the implementation does not actually enforce.

### Downsides for Implementing

Adds more lifecycle-policy machinery and more negative-path testing across multiple provider slices.

### Recommendation

Implement after the secret and credential closeout so retry and timeout handling land on one stable
execution-input model.

---

## PR-39: Environment-branch governance + lane-protection validation closeout

### Description

I will close the remaining branch-governance gap by turning the design's protected environment
branch assumptions into one reviewed, testable contract instead of leaving them as prose-only repo
policy. This PR adds the lane-governance model, branch-protection expectations, and verification
surface that prove protected/shared lane branches are actually safe sources of promotion authority.

### Scope & Changes

- Define the reviewed lane-governance contract for protected/shared lanes, including:
  - environment branch naming and stage mapping
  - fast-forward-only advancement rules
  - disallowed direct pushes to later environment branches except reviewed emergency procedures
  - required checks that must pass before branch advancement
  - reviewed automation identities or equivalent normal-path branch-advance authority
- Require protected/shared lane policies to reference or resolve one authoritative governance object
  rather than relying on undocumented SCM defaults.
- Implement validation or verification commands that compare the declared governance contract with
  actual server-side branch protection or equivalent SCM policy for supported repo backends, failing
  closed on drift or missing required protection.
- Preserve governance verification facts in operator-visible inspection output so deployment
  admission is not silently trusting unverified lane governance assumptions.
- Keep emergency branch-mutation exceptions explicit and tied to the same reviewed break-glass
  posture used elsewhere in the deployment design.

### Tests (in this PR)

- Add lane-governance schema and validation tests for the new branch-protection contract.
- Add verification tests rejecting:
  - missing required protected branches
  - missing fast-forward-only enforcement
  - missing required checks
  - direct-push-permitted later-environment branches outside the emergency path
  - drift between declared governance policy and the actual SCM protection state
- Add admission-path tests proving protected/shared lane validation fails closed when the reviewed
  governance contract cannot be satisfied or verified.
- Add operator-surface tests proving governance verification results are visible through the reviewed
  inspection path.

### Docs (in this PR)

- Document the reviewed lane-governance and environment-branch protection contract.
- Document how direct pushes, fast-forward promotion, required checks, and automation-driven branch
  advancement are enforced or verified.
- Document emergency exceptions for branch mutation and how they relate to the break-glass path.
- Update operator docs so branch-governance verification is part of the normal protected/shared
  deployment posture.

### Verification Commands

- `buck2 test //...`
- lane-governance and branch-protection verification flows introduced in this PR

### Expected Regression Scope

- `mixed-build-system`
- This PR is expected to touch protected/shared lane-policy metadata, admission validation,
  external-policy verification code, and deployment-domain tests. Under the deployment-only verify
  policy, default `v` / CI must still run the full build-system verify scope.

### Acceptance Criteria

- Protected/shared lane branches have one explicit reviewed governance contract instead of prose-only
  assumptions.
- Missing or drifted branch protection fails closed for the protected/shared path.
- Operators can inspect whether branch-governance requirements are actually satisfied.
- Tests and docs in this PR describe the same lane-governance contract.

### Risks

SCM governance is partly external to the repo, so it is easy to accidentally document guarantees
that the runtime never checks.

### Mitigation

Turn the policy into explicit governance metadata plus verification commands and fail closed when
required protection cannot be proven.

### Consequence of Not Implementing

The design would still rely on unverified branch-governance assumptions for promotion authority and
required-check enforcement.

### Downsides for Implementing

Adds cross-system verification work at the boundary between repo policy and external SCM controls.

### Recommendation

Implement after the execution-policy closeout so the final promotion-authority contract is
mechanically checkable instead of remaining prose-only.

---

## PR-40: Record/replay schema-version + runner-identity provenance closeout

### Description

I will close the final compatibility and provenance gap in the deployment record model. This PR
makes versioned records and replay snapshots explicit, preserves the implementation identities of
the built-in runners that materially influenced execution, makes recorded `release_actions`
replay-plan semantics authoritative during replay, completes the remaining explicit
`release_actions` metadata contract, and completes the remaining minimum record and replay
compatibility guarantees that the design expects operators and future tooling to rely on.

### Scope & Changes

- Require explicit `schema_version` fields on durable deployment records and replay snapshots.
- Implement reviewed reader behavior for record or replay compatibility:
  - handle supported versions explicitly
  - migrate when a reviewed migration path exists
  - otherwise fail closed with a clear incompatibility error
- Preserve stable implementation identities for the built-in:
  - publisher runner
  - provisioner runner
  - smoke runner
  - `release_actions` runner when it materially influenced execution
- Preserve the recorded `release_actions` plan snapshot needed for replay-safe immutable reuse,
  including where applicable:
  - stable built-in action type
  - phase placement
  - `run_condition`
  - abort behavior
  - whether later lifecycle steps may proceed on failure
  - declared artifact or runtime inputs consumed by the action
  - replay-context dispositions such as `rerun`, `skip`, or `fail`
  - duplicate-execution-safety posture
  - rollback data-compatibility posture
- Implement the remaining explicit validated action-contract vocabulary for protected/shared
  built-in `release_actions`, including:
  - closed `run_condition` values such as `success_only`, `failure_only`, and `always`
  - explicit phase-placement validation
  - explicit abort/failure-propagation semantics
  - fail-closed rejection of incomplete or ad hoc action metadata
- Complete the remaining minimum record or replay provenance fields that earlier PRs introduced only
  slice-by-slice, including where applicable:
  - canonical principal-shape audit fields
  - preview-cleanup context
  - `failed_step`
  - rollout resumability state
  - latest accepted run-action summary
  - stable policy-content fingerprints or snapshot references
- Require replay paths such as retry, rollback, promotion, and same-deployment `--publish-only` to
  obey the recorded `release_actions` plan snapshot rather than reinterpreting current metadata:
  - recorded `rerun` actions may run again only for the replay context they declared
  - recorded `skip` actions must not be re-run
  - recorded `fail` actions must terminate the replay clearly rather than improvising
  - missing or incompatible recorded action-plan snapshots fail closed
- Fail closed when replay compatibility cannot be proven for the stored schema version or stored
  runner identities.
- Align deployment-record, replay-snapshot, and operator-status surfaces around one reviewed
  compatibility and provenance vocabulary rather than ad hoc per-slice persistence details.

### Tests (in this PR)

- Add schema-version tests proving records and replay snapshots:
  - store explicit versions
  - reject unknown unsupported versions
  - migrate only through reviewed explicit compatibility paths
- Add provenance tests proving runner implementation identities are preserved and compared during
  replay compatibility checks.
- Add action-contract validation tests proving built-in `release_actions` must declare:
  - stable built-in type
  - phase placement
  - `run_condition`
  - abort behavior
  - later-lifecycle failure-propagation posture
  - declared artifact/runtime inputs when required by the action type
- Add tests rejecting unknown `run_condition` values, incomplete action metadata, or ad hoc
  non-reviewed action-contract fields.
- Add record-contract tests covering the remaining minimum required and conditionally required
  fields introduced in this PR.
- Add replay-plan tests proving recorded `release_actions` dispositions are preserved and enforced
  for `rerun`, `skip`, and `fail` during supported replay contexts.
- Add replay tests proving runs fail closed when runner compatibility or snapshot compatibility
  cannot be established.

### Docs (in this PR)

- Document the reviewed record and replay versioning contract.
- Document the operator-visible meaning of runner implementation identity and replay compatibility
  failure.
- Document the complete built-in `release_actions` contract, including per-action metadata fields,
  closed `run_condition` vocabulary, abort behavior, and failure-propagation semantics.
- Document the recorded `release_actions` replay-plan snapshot contract and the fail-closed replay
  behavior when the stored action plan does not authorize rerun.
- Document the remaining minimum record and provenance fields now required by the full deployment
  model.
- Align schema, contract, and operator docs so record/replay compatibility is explicit and stable.

### Verification Commands

- `buck2 test //...`
- record-schema and replay-compatibility inspection flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned persistence, replay, compatibility handling, and
  deployment-domain test infrastructure. Under the deployment-only verify policy, default `v` / CI
  can run the reviewed deployment suite instead of the full non-deployment build-system verify
  scope.

### Acceptance Criteria

- Records and replay snapshots carry explicit schema versions and fail closed when compatibility
  cannot be proven.
- Built-in runner implementation identities are preserved wherever they materially influence replay
  safety.
- Built-in `release_actions` use one explicit reviewed metadata contract rather than ad hoc action
  fields or implicit runtime behavior.
- Replay obeys the recorded `release_actions` plan snapshot rather than silently re-running or
  skipping actions from current metadata.
- The remaining minimum record and provenance requirements from the design are explicit and
  test-covered.
- Tests and docs in this PR describe the same compatibility and provenance contract.

### Risks

Late record-model closeout can accidentally create backwards-compatibility promises that are vague
or impossible to verify in replay.

### Mitigation

Keep the compatibility contract explicit, version every persisted boundary, and fail closed whenever
execution provenance is no longer trustworthy.

### Consequence of Not Implementing

The design would still overstate the durability and replay-safety contract by requiring explicit
schema and runner-identity compatibility that the implementation does not actually preserve.

### Downsides for Implementing

Adds more persistence-contract strictness and compatibility testing to the record model.

### Recommendation

Implement last so every earlier slice can converge on one final versioned record and replay
contract.

---

## PR-41: `failure_only` release-action execution closeout

### Description

I will close the remaining `release_actions` execution gap by making the reviewed
`run_condition = "failure_only"` contract real at runtime rather than validation-only metadata.
This PR ensures failure-scoped actions run in the documented lifecycle phases when publish or smoke
fails, records their execution and failure semantics canonically, and keeps replay behavior
fail-closed and explicit instead of silently skipping declared failure-path actions.

### Scope & Changes

- Implement runtime execution semantics for built-in `release_actions` with
  `run_condition = "failure_only"` across the reviewed `nixos-shared-host` flow.
- Add explicit phase handling so failure-scoped actions may run only in the documented contexts:
  - `pre_publish` actions after a pre-publish failure boundary when that phase can fail
  - `post_publish_pre_smoke` actions after publish succeeds but before or when smoke is skipped due
    to an earlier failure boundary
  - `post_smoke` actions after smoke completes with a failed outcome
- Ensure the deploy runtime distinguishes:
  - actions that should run on the success path
  - actions that should run on the failure path
  - actions that should run in both paths via `run_condition = "always"`
- Record failure-path release-action execution using the same canonical failed-step and
  outcome-model vocabulary already used for success-path actions.
- Make failure-path release-action execution participate in the reviewed abort and later-lifecycle
  failure-propagation semantics rather than bypassing them through ad hoc error handling.
- Ensure replay gating for retry, rollback, promotion, and same-deployment `--publish-only` uses
  the recorded action-plan snapshot for failure-path actions as well as success-path actions.
- Fail closed when the runtime cannot determine whether a declared failure-path action should run in
  the current replay context.
- Update any helper abstractions that currently conflate "not on the success path" with "never
  execute".

### Tests (in this PR)

- Add execution tests proving `failure_only` actions run when:
  - publish fails after the action's declared phase becomes relevant
  - smoke fails for `post_smoke`
  - a deployment declares `always` and the failure-path action still runs
- Add negative tests proving `failure_only` actions do not run on successful deploys.
- Add replay tests proving failure-path actions:
  - obey recorded `rerun`, `skip`, and `fail` dispositions
  - respect duplicate-safety requirements in replay contexts where rerun is allowed
  - fail closed when the stored replay plan does not authorize rerun
- Add failure-record tests proving the recorded failed step and final outcome remain canonical when
  a failure-path release action runs or fails.
- Add regression tests proving the existing success-path release-action behavior remains unchanged
  for `success_only` and `always`.

### Docs (in this PR)

- Document the runtime semantics for `run_condition = "failure_only"` across the reviewed deploy
  lifecycle.
- Document which failure boundaries may trigger each release-action phase.
- Document operator-visible behavior when a failure-path release action itself fails.
- Align the release-action contract docs with the actual replay and failure-path execution model.

### Verification Commands

- `buck2 test //...`
- release-action replay and failure-path inspection flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned release-action execution, replay handling, record
  persistence, and deployment-domain tests. Under the deployment-only verify policy, default `v` /
  CI can run the reviewed deployment suite instead of the full non-deployment build-system verify
  scope.

### Acceptance Criteria

- Declared built-in `failure_only` release actions execute in the reviewed failure-path contexts
  instead of being silently skipped.
- `always` actions execute in both success and failure paths where their declared phase applies.
- Failure-path release-action replay obeys the recorded action-plan snapshot and duplicate-safety
  contract.
- Records, tests, and docs all describe the same failure-path release-action behavior.

### Risks

Failure-path lifecycle work can accidentally blur which phase is responsible for which outcome and
create ambiguous operator expectations.

### Mitigation

Keep the triggering rules phase-specific, preserve canonical failed-step vocabulary, and fail closed
whenever the runtime cannot prove the intended failure-path behavior.

### Consequence of Not Implementing

The deployment design would continue to advertise `failure_only` as a reviewed built-in contract
value even though the runtime never executes it.

### Downsides for Implementing

Adds more branching and test surface to the release-action runtime and replay model.

### Recommendation

Implement immediately after the current record/replay closeout so the reviewed release-action
contract is behaviorally complete before any later provider or workflow expansion depends on it.

---

## PR-42: Cross-provider runner-identity provenance parity for replayable deployment families

### Description

I will close the remaining replay-provenance gap by extending the PR-40 runner-identity contract
from `nixos-shared-host` to every replayable deployment family. This PR makes record and replay
compatibility checks use stable runner implementation identities across Cloudflare Pages, S3
static, Kubernetes, App Store Connect, and Google Play rather than relying only on provider-local
type strings or partial per-provider fields.

### Scope & Changes

- Add reviewed runner-identity persistence for every replayable provider family, including where
  applicable:
  - publisher runner identity
  - provisioner runner identity
  - smoke runner identity
  - any other built-in runner identity that materially affects replay safety for that provider
- Extend durable deployment records and replay snapshots for replayable providers so runner
  identities are stored explicitly rather than inferred indirectly from current code.
- Add shared compatibility helpers so replay paths compare stored runner identities against the
  current built-in implementation identities and fail closed on mismatch.
- Apply that compatibility gate to replay-capable flows including:
  - same-deployment `--publish-only`
  - retry
  - rollback
  - promotion
  - preview-source reuse where replay provenance is authoritative
- Add reviewed migration or compatibility behavior for already-persisted provider records that lack
  the new runner-identity fields:
  - migrate explicitly where the identity can be derived safely
  - otherwise reject with a clear incompatibility error
- Align provider-specific record schemas and replay snapshot schemas so the cross-provider runner
  provenance contract uses one reviewed vocabulary instead of ad hoc per-provider persistence.
- Backfill any provider-specific provenance tests that currently cover schema versioning but not
  runner-identity replay safety.

### Tests (in this PR)

- Add record and replay-snapshot tests proving every replayable provider stores explicit runner
  identities.
- Add replay-compatibility tests for Cloudflare Pages, S3 static, Kubernetes, App Store Connect,
  and Google Play proving:
  - replay succeeds when stored runner identities match current built-in identities
  - replay fails closed when a stored runner identity no longer matches
  - migrated older records only replay when reviewed compatibility can be proven
- Add promotion and rollback tests for non-`nixos-shared-host` providers proving the runner
  compatibility gate applies to cross-run artifact reuse.
- Add regression tests proving current replay flows still work for matching identities and reviewed
  migrated schemas.

### Docs (in this PR)

- Document the cross-provider runner-identity provenance contract for replayable providers.
- Document the operator-visible failure mode when replay compatibility fails because a stored runner
  identity no longer matches the current implementation.
- Document any reviewed migration behavior for older provider records and snapshots that predate the
  explicit runner-identity fields.
- Align the record/replay compatibility docs so `nixos-shared-host` is no longer a special-case
  provenance contract.

### Verification Commands

- `buck2 test //...`
- provider replay-compatibility inspection flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned record schemas, replay resolution, compatibility
  helpers, provider-specific deploy/replay code, and deployment-domain tests. Under the
  deployment-only verify policy, default `v` / CI can run the reviewed deployment suite instead of
  the full non-deployment build-system verify scope.

### Acceptance Criteria

- Every replayable provider family stores explicit runner implementation identities in the reviewed
  record and replay surfaces.
- Replay, rollback, retry, promotion, and other immutable-reuse flows fail closed when runner
  compatibility cannot be proven.
- Older provider records either migrate through reviewed explicit compatibility paths or fail closed
  clearly.
- Tests and docs describe one consistent cross-provider runner-provenance contract.

### Risks

Cross-provider provenance hardening can accidentally create inconsistent migration behavior or
provider-specific exceptions that are hard for operators to reason about.

### Mitigation

Centralize the compatibility vocabulary, keep migrations explicit and minimal, and reject any older
persisted shape whose runner provenance cannot be proven safely.

### Consequence of Not Implementing

The deployment plan would continue to overstate PR-40 by implying cross-provider replay provenance
hardening that only fully exists for `nixos-shared-host`.

### Downsides for Implementing

Adds schema, migration, and replay-compatibility work across several provider slices at once.

### Recommendation

Implement last so all replayable provider families converge on one final provenance and
compatibility contract before the deployment model is treated as fully complete.

---

## PR-43: Repo-level deploy front-door validation semantics + provision-only contract closeout

### Description

I will close the remaining repo-level `deploy` front-door gaps left behind after the earlier PR-27
surface landed only partially. This PR makes `--validate-only` enforce the reviewed validation
contract instead of only checking file presence, and it finishes the reviewed `--provision-only`
operator path so the public CLI surface matches the documented deployment model for supported
provider families.

### Scope & Changes

- Harden `deploy <id> --validate-only` so it validates the full reviewed non-mutating contract for
  the selected deployment rather than returning success after provider-config existence checks only.
- Require `--validate-only` to validate, as applicable for the selected provider slice:
  - deployment metadata extraction and fail-closed schema/contract checks
  - provider capability compatibility for the declared deployment shape
  - referenced Buck target presence and reviewed target-kind expectations
  - provider-native config parsing and semantic validation
  - provider-target/config drift checks already enforced by mutating paths
- Reuse the same reviewed provider-config validators already used by deploy-time execution paths so
  validation and mutation do not drift on what counts as a valid provider-native config.
- Add one reviewed provider-validation helper surface for repo-level front-door validation instead
  of leaving validation semantics implicit inside provider-specific mutating flows.
- Finish repo-level `deploy <id> --provision-only` for the provider families whose plan already
  says the public front door should support it.
- Replace current hard rejection of `--provision-only` with reviewed provision-only execution where
  the provider contract is metadata/provisioner driven and does not require publish-phase artifact
  mutation.
- Preserve the reviewed provision-only rules on the repo-level front door:
  - provision-only still validates
  - provision-only does not publish
  - provision-only does not run publish-phase `release_actions`
  - protected/shared provision-only binds one admitted source revision and one frozen execution
    snapshot whenever the provisioner uses immutable resolved inputs
- Fail closed when a provider family or deployment shape still does not have a reviewed
  provision-only contract, and make that refusal explicit and documented rather than looking like a
  temporary hole in the front door.
- Align repo-level front-door output and classification semantics so validation-only and
  provision-only runs preserve the reviewed operator vocabulary instead of ad hoc success payloads.
- Remove or update tests that currently lock in the incomplete behavior as the intended contract.

### Tests (in this PR)

- Add repo-level CLI tests proving `--validate-only` fails closed on invalid provider-native config
  content, not just missing files.
- Add provider-validation tests for reviewed config semantics, including at least:
  - malformed Cloudflare `wrangler.jsonc`
  - provider-target/config drift for Cloudflare Pages
  - equivalent semantic validation for every provider family that exposes repo-level validation
- Add tests proving `--validate-only` validates referenced deployment/component targets and still
  performs no build, publish, provision, `release_actions`, or external mutation.
- Replace the current repo-level tests that assert `--provision-only` rejection for supported
  provider families with tests that prove the reviewed provision-only behavior.
- Add provision-only tests proving:
  - publish is skipped
  - publish-phase `release_actions` are skipped
  - protected/shared provision-only uses the reviewed admission and frozen-snapshot path when
    immutable resolved inputs are involved
  - unsupported provider families or unsupported deployment shapes still fail closed clearly
- Add record/status tests proving provision-only preserves canonical run classification, lifecycle
  state, and final outcome semantics on the repo-level front door.
- Add regression tests proving normal deploy, preview, rollback, and promotion behavior continue to
  use the same provider validators and are not weakened by the front-door validation refactor.

### Docs (in this PR)

- Update the PR-27-facing portions of the deployment plan and companion deployment docs so the
  repo-level `deploy` operator surface matches the implemented validation and provision-only
  contract exactly.
- Document what `--validate-only` guarantees, including which classes of provider-native config and
  metadata drift it must reject before any mutation path can run.
- Document which provider families and deployment shapes support repo-level `--provision-only`, and
  which still fail closed by design.
- Document the operator-visible output and record semantics for validation-only and provision-only
  runs.

### Verification Commands

- `buck2 test //...`
- repo-level `deploy --validate-only` and `deploy --provision-only` inspection flows introduced in
  this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned front-door CLI code, provider validation helpers,
  provider-specific provision-only wiring, record/classification handling, and deployment-domain
  tests. Under the deployment-only verify policy, default `v` / CI can run the reviewed deployment
  suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- `deploy <id> --validate-only` fails closed on invalid provider-native config content and reviewed
  metadata/provider drift instead of only checking that files exist.
- Repo-level validation and mutating provider paths use the same reviewed provider-config semantic
  checks so operators do not see contradictory behavior between validate and deploy.
- Repo-level `--provision-only` is implemented for the provider families and deployment shapes that
  the plan says should support it, with tests and docs describing the same behavior.
- Unsupported provision-only shapes fail closed explicitly and are documented as such.

### Risks

Front-door cleanup work can accidentally widen validation beyond reviewed provider contracts or
introduce inconsistent provision-only behavior across providers.

### Mitigation

Centralize provider validation hooks, reuse existing mutating-path semantic validators wherever
possible, and keep provision-only enablement limited to reviewed provider/deployment shapes with
explicit tests and docs.

### Consequence of Not Implementing

The deployment plan would continue to overstate PR-27 by advertising repo-level validation and
provision-only contracts that the current front door does not actually satisfy.

### Downsides for Implementing

This adds one more late cleanup PR and touches several provider front-door surfaces that currently
look stable from the outside.

### Recommendation

Implement after PR-42 as the final front-door contract closeout so the deployment plan is not
declared fully complete while the public CLI still has known behavior gaps.

---

## PR-44: Deployment-domain methodology compliance closeout for file-size boundaries

### Description

I will close the remaining methodology gap identified during plan review: the deployment system is
functionally implemented and tested, but some deployment-owned files still violate the hard file-size
boundary from [Project Documentation Methodology](/Users/kiltyj/Code/bucknix-fresh/METHODOLOGY.XML).
This PR brings the deployment area into explicit compliance by splitting oversized deployment-owned
modules and tests into smaller reviewed units without weakening behavior, coverage, or the deployment
contracts already established by earlier PRs.

### Scope & Changes

- Audit deployment-owned implementation, test, and support files against the methodology file-size
  rule.
- Split any deployment-owned files over the reviewed limit into smaller modules with clear
  responsibilities.
- Prioritize cleanup of oversized deployment-domain test files and any deployment-owned runtime files
  that cross or drift close enough to the limit to create immediate recurrence risk.
- Preserve existing deployment contracts, target names, and reviewed operator behavior while
  refactoring file boundaries.
- Keep refactors surgical:
  - no new deployment features
  - no contract expansion
  - no semantic behavior changes except where required to preserve existing behavior after the split
- Add or tighten shared deployment-test helpers only where that reduces duplication and keeps the new
  split files readable.
- Add a reviewed deployment-domain compliance check or equivalent guardrail so future
  deployment-owned files fail closed when they exceed the methodology limit.
- Ensure any new compliance guardrail is scoped so it enforces the methodology requirement without
  broadening into unrelated style-policy churn.

### Tests (in this PR)

- Add deployment-domain compliance tests proving reviewed deployment-owned files fail closed when
  they exceed the file-size limit.
- Update or add regression tests proving the refactored deployment tests and helpers still cover the
  same runtime and policy behavior after the split.
- Add tests proving any new deployment-domain file-size guardrail reports actionable diagnostics,
  including the offending file path and measured line count.
- Re-run the representative deployment suite covering:
  - `nixos-shared-host` contract and end-to-end deploy behavior
  - platform-state and promotion flows
  - Cloudflare Pages deploy, promotion, preview, and rollback flows
  - deployment verify-scope and control-plane policy coverage
- Add tests proving the new helper boundaries do not silently drop deployment-domain labels,
  taxonomy wiring, or verify-scope ownership semantics.

### Docs (in this PR)

- Update the deployment plan and any companion deployment docs that reference implementation
  completion so they no longer leave the methodology-compliance gap implicit.
- Document the deployment-domain methodology guardrail and how contributors should respond when a
  deployment-owned file exceeds the reviewed size limit.
- Document the intended module boundaries for any split deployment helpers or large test fixtures
  where future contributors might otherwise recombine responsibilities.

### Verification Commands

- `buck2 test //...`
- deployment-domain compliance or size-check commands introduced in this PR
- representative deployment-domain Buck targets covering the refactored areas

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-owned implementation, deployment-domain tests, and any
  deployment-scoped compliance wiring needed to enforce the methodology rule. Under the
  deployment-only verify policy, default `v` / CI can run the reviewed deployment suite instead of
  the full non-deployment build-system verify scope.

### Acceptance Criteria

- Deployment-owned files in the reviewed deployment domain comply with the methodology file-size
  limit.
- Oversized deployment-domain tests or helpers are split into smaller reviewed modules without loss
  of coverage or operator-visible behavior.
- The repo has a fail-closed deployment-domain guardrail that prevents this methodology gap from
  silently returning.
- Tests and docs in this PR describe the same deployment-domain compliance contract.

### Risks

Late cleanup refactors can accidentally change behavior in subtle ways if large tests or helpers are
split mechanically rather than along real responsibility boundaries.

### Mitigation

Keep the PR behavior-preserving, split along existing seams, preserve representative deployment
end-to-end coverage, and add explicit compliance checks so the cleanup does not rely on manual
discipline alone.

### Consequence of Not Implementing

The deployment plan could look functionally complete while still failing the repository methodology
review that treats file-size compliance as a mandatory checkpoint rather than an optional cleanup.

### Downsides for Implementing

This is cleanup-heavy work late in the plan and does not add new operator-visible deployment
features.

### Recommendation

Implement after PR-43 as the final deployment-domain methodology closeout so the deployment plan can
be considered fully implemented not only functionally, but also against the reviewed repo
methodology.

---

## PR-45: Cross-provider promotion compatibility contract for flexible `dev` lanes

### Description

I will add a reviewed cross-provider promotion-compatibility model so `dev` can remain operationally
flexible without forcing `staging` and `prod` to inherit that flexibility. This PR replaces the
current blanket rejection of provider and publisher mismatches during promotion with an explicit,
fail-closed compatibility contract that can allow a lower environment such as `dev` on
`nixos-shared-host` to promote into a higher environment on a different provider family when the
lane declares that behavior and the source/target deployments still match the reviewed artifact,
component, runtime, and rollout semantics for that promotion family.

### Scope & Changes

- Introduce a reviewed promotion-compatibility contract that distinguishes:
  - strict same-provider / same-publisher promotion within higher environments
  - explicitly reviewed cross-provider promotion from flexible lower environments such as `dev`
- Add authoritative metadata or lane-policy support for declaring when a lane allows
  cross-provider promotion on specific stage edges.
- Keep the default fail-closed posture:
  - provider mismatch still rejects promotion unless the lane explicitly opts into a reviewed
    cross-provider compatibility mode
  - publisher mismatch still rejects promotion unless the reviewed compatibility contract proves the
    source artifact and target publish contract are compatible
- Replace the current hard-coded provider/publisher equality gate with a closed compatibility
  evaluation that compares:
  - component ids
  - component kinds
  - resolved artifact semantics
  - runtime contract
  - rollout semantics
  - provisioner behavior where relevant
  - any reviewed provider-family-specific compatibility inputs
- Define the repo policy for flexible lower environments:
  - `dev` may differ from higher environments when the lane explicitly allows that shape
  - higher-environment promotion edges such as `staging -> prod` remain strict unless the reviewed
    compatibility contract says otherwise
  - target-environment admission, target provider config, target smoke, and target publish behavior
    remain authoritative for the promoted run
- Generalize the compatibility model across reviewed deployment families rather than limiting it to
  one component kind:
  - static webapps
  - SSR webapps
  - mobile-app deployments
  - service / third-party-service deployments where the reviewed provider capability and runtime
    contract can express cross-provider promotion compatibility
- Ensure lanes declaring `artifact_reuse_mode = "same_artifact"` continue to require
  environment-neutral artifacts even when providers differ across the promotion edge.
- Keep `rebuild_per_stage` semantics unchanged:
  - cross-provider flexibility must not silently turn exact-artifact promotion into rebuild-per-stage
  - lanes that need stage-specific builds must still use the reviewed rebuild-per-stage path
- Update Pleomino's reviewed `dev -> staging -> prod` model so `dev` on `nixos-shared-host` can
  promote into Cloudflare Pages staging/prod through the new reviewed compatibility contract.

### Tests (in this PR)

- Add compatibility tests proving provider/publisher mismatch remains rejected by default when no
  reviewed cross-provider promotion contract is declared.
- Add tests proving reviewed flexible-`dev` lanes allow cross-provider promotion only on the
  declared stage edges and still reject the same mismatch on undeclared edges.
- Add end-to-end Pleomino promotion tests proving:
  - `pleomino-dev` on `nixos-shared-host` can promote into `pleomino-staging` on Cloudflare Pages
  - `pleomino-staging` can promote into `pleomino-prod` under the lane's reviewed higher-environment
    compatibility rules
  - lineage fields and exact-artifact reuse semantics remain correct across the flexible `dev`
    boundary
- Add tests for reviewed non-static deployment families proving the compatibility gate evaluates
  closed inputs rather than raw provider equality:
  - matching reviewed runtime/artifact contract passes when the lane allows it
  - runtime-contract drift, rollout drift, artifact-contract drift, or provisioner drift still fail
    closed
- Add tests rejecting:
  - cross-provider promotion on lanes that do not explicitly opt in
  - cross-provider promotion where source artifacts are not environment-neutral
  - cross-provider promotion that would blur `same_artifact` and `rebuild_per_stage`
  - cross-provider promotion where the target provider's reviewed capability entry does not declare
    compatibility for that component kind / runtime contract
- Extend front-door and replay tests to prove target-environment admission, smoke, and provider
  config validation remain target-authoritative even when the source run came from a different
  provider family.

### Docs (in this PR)

- Update [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) to
  define the reviewed cross-provider promotion-compatibility model for flexible lower environments.
- Update [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md) so it
  no longer implies unconditional provider/publisher equality when a reviewed cross-provider
  compatibility contract is declared.
- Update [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
  to document which provider families and component/runtime contracts support cross-provider
  promotion and which still fail closed.
- Update the Pleomino example docs so they describe the reviewed `dev` flexibility and the stricter
  higher-environment expectations consistently.
- Document the operator-facing rule of thumb:
  - `dev` may be operationally different
  - promotion still uses one explicit reviewed compatibility contract rather than an informal
    exception

### Verification Commands

- `buck2 test //...`
- promotion compatibility and end-to-end promotion flows introduced or updated in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment-domain policy extraction, promotion-compatibility
  evaluation, provider-capability wiring, concrete deployment fixtures/packages, and
  deployment-domain tests/docs. Under the deployment-only verify policy, default `v` / CI can run
  the reviewed deployment suite instead of the full non-deployment build-system verify scope.

### Acceptance Criteria

- The repo no longer treats provider and publisher equality as an unconditional prerequisite for
  promotion.
- Cross-provider promotion is allowed only through one explicit reviewed compatibility contract and
  still fails closed by default.
- Flexible `dev` lanes can promote into different higher-environment provider families when the
  lane declares that shape and the reviewed compatibility inputs match.
- Higher-environment promotion behavior remains explicit, reviewable, and target-authoritative for
  admission, provider config, publish, and smoke.
- Tests and docs in this PR describe the same cross-provider promotion contract.

### Risks

Relaxing provider/publisher equality can accidentally turn promotion into an under-specified
"artifact seems close enough" path, especially if the compatibility model is open-ended or relies
on provider-local heuristics.

### Mitigation

Keep the compatibility surface closed and declarative, make cross-provider promotion opt-in at the
lane level, preserve target-authoritative admission/publish/smoke behavior, and reject any
provider-family combination that lacks a reviewed compatibility contract.

### Consequence of Not Implementing

The deployment system would continue to reject the common and operationally sensible shape where
`dev` runs on a cheaper or more flexible shared host while `staging` and `prod` use the production
provider family, leaving the plan stricter than the repo's intended environment model.

### Downsides for Implementing

This broadens the promotion-compatibility surface and requires careful contract work across
multiple deployment families rather than a small static-webapp-only exception.

### Recommendation

Implement after PR-44 as the final promotion-compatibility closeout so the deployment plan matches
the intended flexible-`dev`, strict-higher-environment operating model without weakening the
reviewed protected/shared promotion contract.

---

## PR-46: Buck-authoritative repo front-door closeout + internal extracted-metadata boundary

### Description

I will close the remaining source-of-truth gap between the deployment design and the current
front-door implementation by removing the public mutating `--deployment-json` bypass from the
repo-level `deploy` workflow and making Buck/TARGETS the only reviewed public source of deployment
metadata. Versioned extracted-metadata documents will remain in policy only as internal
implementation contracts between extraction, the front door, tests, and the shared control plane,
not as a second public operator input surface that can bypass authoritative Buck metadata.

### Scope & Changes

- Make Buck/TARGETS authoritative for the public repo-facing deploy workflow:
  - protected/shared and local deploy runs must resolve deployment metadata from
    `--deployment <label>` or another Buck-backed selector
  - the public repo-level `deploy` front door must not accept arbitrary checked-in or ad hoc
    deployment JSON as a mutating input path
- Narrow the extracted-metadata document role to an internal contract:
  - keep the versioned extracted-metadata schema as the reviewed implementation boundary between
    Buck extraction, control-plane submission, and isolated tests/tools
  - document that extracted-metadata documents are generated artifacts, not a second operator-owned
    source of truth
- Remove or explicitly internalize the current public `--deployment-json` mutating path:
  - either retire it from the public CLI entirely, or
  - move it behind an explicitly non-public internal/test-only entrypoint that the repo-level
    operator interface does not advertise or rely on
- Rework reviewed integration and e2e tests so public-front-door coverage exercises real Buck /
  `TARGETS` resolution rather than direct deployment-JSON injection.
- Keep fail-closed validation behavior:
  - provider config validation
  - component-kind validation
  - lane/admission metadata resolution
  - deployment discovery via Buck queries
- Preserve versioned payload-contract work already introduced for downstream components, but make
  the contract origin unambiguous:
  - extracted metadata is produced from Buck
  - the public CLI does not treat hand-authored JSON as authoritative deployment definition

### Tests (in this PR)

- Replace public-front-door integration tests that currently mutate through `--deployment-json`
  with temp-workspace tests that define real `TARGETS` and invoke the public CLI through
  `--deployment <label>`.
- Add contract tests proving the public repo-level `deploy` front door rejects `--deployment-json`
  for mutating execution paths.
- Add tests proving `--list`, `--validate-only`, and ordinary deploy flows still resolve
  authoritative metadata from Buck and fail closed on malformed provider config or target-kind
  drift.
- Add tests for the internal extracted-metadata document boundary proving:
  - documents are generated from Buck extraction
  - internal consumers still accept the reviewed versioned schema
  - public operator workflows do not rely on hand-authored deployment JSON
- Extend replay / front-door tests where needed so the reviewed operator contract remains exercised
  after the `--deployment-json` public-path removal.

### Docs (in this PR)

- Update [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) and
  [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md) to make the
  public-versus-internal metadata boundary explicit:
  - `TARGETS` is the only public reviewed source of truth
  - extracted-metadata documents are internal versioned contracts, not peer operator inputs
- Update repo deploy-front-door docs/help text to remove or clearly internalize the
  `--deployment-json` path.
- Document the reviewed testing posture for deployment e2e coverage so future tests continue to
  exercise Buck-authoritative metadata resolution.
- Update any reviewed operator-facing usage docs whose invocation examples or workflow assumptions
  change because of the front-door contract tightening.

### Verification Commands

- `buck2 test //...`
- deploy front-door contract / extraction / e2e flows updated in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment front-door, Buck extraction/query wiring, payload-contract
  boundary code, deployment fixtures, and deployment-domain tests/docs. Under the deployment-only
  verify policy, default `v` / CI can run the reviewed deployment suite rather than the full
  non-deployment build-system verify scope.

### Acceptance Criteria

- The public repo-level `deploy` workflow no longer accepts hand-authored deployment JSON as a
  mutating source of truth.
- Public deploy/list/validate flows resolve authoritative metadata from Buck / `TARGETS`.
- Versioned extracted-metadata documents remain available only as reviewed internal contracts.
- Tests and docs in this PR describe the same source-of-truth boundary.

### Risks

Removing the public JSON bypass can break a large amount of existing fixture and end-to-end test
coverage if the replacement Buck-backed test harness is not ready first.

### Mitigation

Land the Buck-backed fixture scaffolding and migrate reviewed tests in the same PR so the source of
truth gets stricter without sacrificing coverage.

### Consequence of Not Implementing

The deployment system would continue to carry a public path that contradicts the design's
authoritative-metadata invariant, making it possible for operator workflows and tests to validate a
less strict contract than the one the design claims.

### Downsides for Implementing

This increases fixture/setup work in tests and may make some integration scenarios slower or more
verbose because they now need real Buck-visible deployment packages.

### Recommendation

Implement first after PR-45 so the final closeout work builds on one unambiguous source-of-truth
boundary for all later control-plane and approval-surface work.

---

## PR-47: Shared deploy control-plane API + authoritative backend / worker split closeout

### Description

I will close the remaining gap between the reviewed deployment design's shared-control-plane
architecture and the current in-process/file-backed execution path by introducing the real reviewed
protected/shared control-plane service boundary: a submission/status API, a separate worker loop or
worker service, and an authoritative backend for runs, queue state, locks, idempotency, and
status. The goal of this PR is not to change deployment semantics, but to move the already-reviewed
protected/shared behavior onto the architecture the design says operators should rely on.

### Scope & Changes

- Add the reviewed shared-control-plane service surface for protected/shared mutation:
  - submit API using the existing versioned request/response contracts
  - status/read API for polling and operator inspection
  - reviewed run-action API for cancel / resume / abort behavior already in policy
- Split execution authority across the intended roles:
  - the repo-level `deploy` CLI becomes a thin authenticated client for protected/shared mutation
  - the control-plane service persists the authoritative run/submission state
  - a separate worker loop or sibling worker service claims queued runs and performs provider-side
    mutation
- Introduce an authoritative backend for protected/shared state:
  - submissions
  - run actions
  - queue state
  - idempotency records
  - lock ownership / fencing state
  - status/read models and authoritative run references
- Keep the reviewed filesystem/JSON implementation only where it is still appropriate:
  - isolated fixture tests
  - explicitly local dev harnesses
  - compatibility shims during migration
  - but not as the normal reviewed protected/shared operator backend
- Ensure protected/shared CLI flows no longer perform direct in-process submit-and-run execution
  against local records roots as the normal architecture.
- Preserve already-reviewed behavior during the migration:
  - immutable execution snapshots
  - admission and revalidation
  - queue/supersedence behavior
  - lock fencing
  - replay / recovery / retention / observability hooks
- Add reviewed startup/configuration support for the control-plane service and worker processes so a
  homelab or single-host shared deployment setup can run the intended architecture without ad hoc
  local wiring.

### Tests (in this PR)

- Add integration tests covering submit/status/run-action behavior through the reviewed API surface
  rather than direct in-process helper calls.
- Add end-to-end tests proving the repo-level CLI submits protected/shared runs to the service and
  reads status back through the API instead of mutating provider state locally.
- Add queue / worker split tests proving:
  - the API can accept and persist a run while no worker has claimed it yet
  - a separate worker process or worker harness claims the queued run and executes it
  - status remains durable across API and worker restarts
- Add backend durability tests proving the authoritative backend preserves:
  - submissions
  - idempotency
  - queue state
  - lock state / fencing evidence
  - run-action persistence
- Extend recovery / resilience / observability tests so they still pass through the new service /
  worker / backend boundary rather than only through local in-process helpers.
- Add compatibility tests for the transitional local harness so deployment-domain tests can still run
  deterministically without requiring external infrastructure.

### Docs (in this PR)

- Update [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) to mark
  the shared-control-plane API / worker / authoritative-backend architecture as the reviewed
  implemented execution model for protected/shared mutation.
- Update [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md) and
  operational docs so the repo-level CLI is documented as a client of the control-plane service,
  not an in-process peer mutator.
- Add operator/technician docs for:
  - starting the control-plane service
  - starting the worker loop
  - configuring the authoritative backend
  - local reviewed test/harness usage
- Update operator setup/instructions docs to match the reviewed shared-control-plane architecture,
  including
  [nixos-shared-host-setup.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
  and
  [nixos-shared-host-technician-checklist.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
  wherever the install, startup, usage, or troubleshooting steps change.

### Verification Commands

- `buck2 test //...`
- reviewed control-plane API / worker / backend integration flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment control-plane runtime, CLI client wiring, backend/locking
  infrastructure, harness configuration, and deployment-domain tests/docs. Under the deployment-only
  verify policy, default `v` / CI can run the reviewed deployment suite rather than the full
  non-deployment build-system verify scope.

### Acceptance Criteria

- Protected/shared mutation goes through a reviewed control-plane service boundary with a separate
  worker execution path.
- The authoritative backend, not local ad hoc records-root execution, is the normal persistence and
  coordination layer for protected/shared runs.
- The repo-level CLI acts as a client for protected/shared mutation instead of directly executing
  the shared-control-plane logic in-process.
- Existing protected/shared semantics remain preserved across the service/backend migration.

### Risks

This is an architectural migration across the control-plane trust boundary, so regressions in
submission, queueing, locking, or restart behavior could be subtle and hard to diagnose if the new
backend and worker split land without strong integration coverage.

### Mitigation

Keep the contracts versioned and stable, preserve a reviewed local harness for deterministic tests,
and expand integration coverage around submission, worker claim, restart, recovery, and status
reads in the same PR.

### Consequence of Not Implementing

The deployment system would continue to claim a service/API/worker/backend architecture in the
design while the normal protected/shared path remained an in-process local execution model with a
weaker authority boundary than the reviewed steady-state contract.

### Downsides for Implementing

This adds operational surface area, backend configuration, and more involved integration testing for
the deployment system itself.

### Recommendation

Implement after PR-46 so the real shared-control-plane architecture lands on the already-correct
Buck-authoritative front-door contract rather than preserving the older metadata bypasses.

---

## PR-48: Pending-approval advancement + reviewed approval service closeout

### Description

I will close the remaining approval-lifecycle gap by adding the reviewed protected/shared approval
service and approval-grant operator flow that advances an existing `pending_approval` run into the
next admissible lifecycle state instead of leaving approval as a static evidence check with no
first-class same-run advancement path. This PR turns the already-reviewed approval-binding model
into a complete operator workflow.

### Scope & Changes

- Add the reviewed approval service / approval-grant path for protected/shared runs:
  - approval submission/grant request contract
  - approval persistence with explicit approver identity and binding facts
  - same-run advancement from `pending_approval` into `queued` / next admissible execution state
- Keep approval bound to the existing reviewed immutable payload:
  - `deploy_run_id` / submission identity
  - canonical target identity
  - payload fingerprint
  - provisioner plan fingerprint when infra-affecting mutation is in scope
  - source-run selector / replay selector when applicable
- Add explicit authorization and policy handling for approval operations:
  - approver role and scope enforcement
  - self-approval rejection by default
  - fail-closed handling for expired, revoked, superseded, or drifted approval inputs
- Ensure approval advancement does not create a second run:
  - the existing run remains the authoritative object
  - lifecycle progression, lineage, and audit state stay attached to that run
  - idempotent repeated approval requests for the same payload resolve safely
- Extend status/read surfaces so operators can distinguish:
  - pending approval
  - approval granted
  - approval no longer valid
  - run resumed into queue/execution
- Integrate the reviewed approval flow with existing retry / promotion / rollback policy:
  - `promotion` always uses target-environment approval
  - rollback freshness rules remain policy-driven
  - retry approval reuse remains constrained by the reviewed admission policy

### Tests (in this PR)

- Add end-to-end control-plane tests proving a run in `pending_approval` can be approved and then
  advances on the same run id rather than creating a second run.
- Add idempotency tests for repeated approval requests against the same pending run.
- Add authorization tests rejecting:
  - self-approval where policy forbids it
  - unauthorized approvers
  - wrong scope / wrong target identity
  - approval against a drifted payload or plan fingerprint
- Add tests proving approval expiry or revocation while queued/running fails closed with the
  canonical `approval_no_longer_valid` behavior.
- Extend CLI/API/status tests so operator tooling can observe approval state transitions without
  string parsing.
- Extend provider-family e2e tests where protected/shared approval is meaningful so the approval
  path is exercised on real deploy flows, not only synthetic fixtures.

### Docs (in this PR)

- Update [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) to
  document the reviewed approval-grant flow and same-run advancement behavior for
  `pending_approval`.
- Update [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md) so
  the approval lifecycle is fully described as an operator-visible, versioned control-plane
  contract rather than only an admission precondition.
- Add operator docs for reviewing and approving pending protected/shared runs, including the
  expected failure cases when approval inputs are stale, invalid, or drifted.
- Update operator/technician workflow docs so the reviewed approval steps, run-state expectations,
  and incident-handling instructions stay aligned with the implemented flow, including
  [nixos-shared-host-setup.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
  and
  [nixos-shared-host-technician-checklist.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
  when those docs describe the affected control-plane workflow.

### Verification Commands

- `buck2 test //...`
- approval service / pending-approval advancement flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment control-plane approval services, status/read models,
  authorization/policy handling, CLI/API approval wiring, and deployment-domain tests/docs. Under
  the deployment-only verify policy, default `v` / CI can run the reviewed deployment suite rather
  than the full non-deployment build-system verify scope.

### Acceptance Criteria

- Protected/shared runs in `pending_approval` can be advanced through a reviewed approval-grant
  workflow on the same run.
- Approval remains fail-closed on drift, expiry, revocation, or authorization mismatch.
- Status/read surfaces expose approval state and approval-driven lifecycle progression clearly.
- Tests and docs in this PR describe the same approval-service contract.

### Risks

Approval advancement touches the same area as admission, idempotency, authorization, and queueing,
so a weak implementation could accidentally allow duplicate advancement, stale approvals, or second
run creation.

### Mitigation

Bind approvals strictly to the existing payload fingerprint and run identity, keep the advancement
contract idempotent, and exercise the flow through end-to-end pending-approval integration tests in
the same PR.

### Consequence of Not Implementing

The deployment system would continue to support `pending_approval` only as a terminal waiting state
without the reviewed same-run approval-service behavior the design promises operators.

### Downsides for Implementing

This adds more state transitions and operator-surface complexity to the control plane.

### Recommendation

Implement after PR-47 so the approval service lands on the real reviewed control-plane API and
authoritative backend rather than on the older in-process/shared-records execution shape.

---

## PR-49: Authoritative backend durability + deploy-record closeout

### Description

I will close the remaining authoritative-backend gap by making the reviewed Postgres backend the
canonical store for live worker ownership and final deploy records, so long-running or recovered
runs cannot be reclaimed and re-executed after a short queue-claim timeout and control-plane
results are no longer sourced from local JSON mirrors as the authority.

### Scope & Changes

- Extend the reviewed authoritative backend schema to persist canonical protected/shared deploy
  records keyed by `deploy_run_id` / submission identity rather than treating `<records-root>/runs`
  as the only durable record authority.
- Persist lifecycle transitions into the backend as first-class control-plane state:
  - accepted / queued
  - waiting for lock
  - claimed / running
  - paused / cancelling when applicable
  - finished / cancelled with terminal outcome and record linkage
- Replace one-shot worker queue claims with reviewed durable worker ownership:
  - claim heartbeat / renewal while execution is active
  - fail-closed claim expiry and replacement-worker takeover rules
  - explicit fencing-aware finalize / recovery checks before a worker may continue or settle an
    in-doubt run
- Serve control-plane status / result reads from the authoritative backend, with
  `<records-root>/control-plane/*.json` and `<records-root>/runs/*.json` remaining operator-readable
  mirrors rather than the queue / lock / deploy-record authority.
- Keep the reviewed local `pgmem://...` harness aligned with the same claim, record, and read
  contracts so deployment-domain tests remain deterministic without external infrastructure.
- Preserve the PR-48 approval-service model without changing approval semantics:
  - this PR hardens the backend lifecycle the approval flow runs on
  - it does not redefine approval policy or same-run approval advancement

### Tests (in this PR)

- Add integration tests proving a long-running shared-host run remains singly owned beyond the
  normal claim lease and is not re-executed by a second worker.
- Add recovery tests proving replacement workers can take over only after the reviewed backend
  ownership / expiry rules allow it, and that duplicate finalization is rejected fail-closed.
- Add tests proving canonical deploy records are written to and read from the authoritative backend
  by `deploy_run_id` and submission id, while the JSON mirror still lands under `<records-root>`.
- Extend service/status/result tests so final result reads still work from authoritative backend
  state when local mirror timing differs.
- Extend deterministic `pgmem://...` harness coverage so backend claim heartbeat, record
  persistence, and result/status reads are exercised in deployment-domain tests.

### Docs (in this PR)

- Update [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) to
  state explicitly that the reviewed authoritative backend now backs both protected/shared deploy
  records and durable claimed-running worker ownership.
- Update [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md) so
  protected/shared status/result semantics and deploy-record authority describe Postgres as the
  authoritative record store, with JSON as operator-readable mirrors.
- Add operator docs describing:
  - canonical backend state vs filesystem mirrors
  - durable worker-ownership / recovery behavior
  - what operators should trust during in-doubt recovery or restore testing
- Update
  [nixos-shared-host-setup.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
  and
  [nixos-shared-host-technician-checklist.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
  wherever they describe where authoritative run state and final records live or how operators
  inspect them.

### Verification Commands

- `buck2 test //...`
- reviewed backend claim / recovery / deploy-record authority flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment control-plane backend schema, worker ownership / recovery,
  status/result reads, record persistence, harness coverage, and deployment-domain tests/docs.
  Under the deployment-only verify policy, default `v` / CI can run the reviewed deployment suite
  rather than the full non-deployment build-system verify scope.

### Acceptance Criteria

- A long-running protected/shared run cannot be reclaimed and re-executed while its reviewed worker
  still holds authoritative ownership.
- Replacement-worker recovery fails closed unless the backend ownership / expiry rules make
  takeover authoritative.
- Canonical protected/shared deploy records are persisted in and read from the authoritative
  backend, not only from local JSON files.
- JSON records and control-plane files remain operator-readable mirrors rather than the sole
  authority.

### Risks

This changes the control-plane backend contract for running-worker ownership and final records, so
an incomplete migration could make recovery behavior ambiguous or drift service reads away from the
persisted canonical state.

### Mitigation

Land the schema and read-path migration together, preserve deterministic `pgmem://...` coverage for
long-running claim / recovery cases, and add end-to-end tests that exercise canonical record reads
through the reviewed service surfaces in the same PR.

### Consequence of Not Implementing

The deployment system would continue to describe Postgres as the authoritative protected/shared
backend while still allowing duplicate execution after claim expiry and leaving deploy records
authoritative only on local files.

### Downsides for Implementing

This adds more backend schema, migration, and recovery-test complexity to the deployment system
itself.

### Recommendation

Implement after PR-48 so the pending-approval advancement / approval-service flow lands first and
this PR can harden the backend lifecycle it relies on without overlapping that approval-specific
work.

---

## PR-50: Service-only protected/shared client boundary closeout

### Description

I will remove the remaining peer-mutator protected/shared client paths by making every reviewed
`nixos-shared-host` mutation entrypoint act as a thin client of the central control plane instead
of falling back to in-process local submission or SSH peer authority when service configuration is
missing.

### Scope & Changes

- Remove the repo front-door fallback that directly calls the shared-host control-plane logic
  in-process for `shared_nonprod` when `--control-plane-url` is absent; same-host mutation must
  fail closed or submit through the reviewed service.
- Make same-host `deploy`, `--publish-only`, `--provision-only`, and explicit removal flows use the
  reviewed service boundary rather than local peer mutation.
- Rework the reviewed remote-profile and Jenkins wrapper flows so they submit to the central
  control plane instead of remaining SSH peer mutators:
  - wrappers may still perform reviewed artifact staging, plan rendering, or host-preflight work
  - admission, lock acquisition, orchestration, run-action handling, and final deploy-record
    authority remain central control-plane responsibilities
- Add one reviewed client configuration model for service endpoint selection and required auth
  material across same-host, remote-profile, and Jenkins callers.
- Preserve PR-48 approval / run-action semantics by routing those operator actions through the same
  control-plane API rather than introducing parallel local advancement paths.
- Fail closed with explicit machine-readable errors when a protected/shared caller lacks required
  service configuration or attempts to mix legacy peer-mutation flags with service-only mode.

### Tests (in this PR)

- Add repo CLI tests proving shared-host same-host mutation rejects missing service configuration and
  submits through the service for all supported mutation kinds.
- Add remote-profile and Jenkins wrapper contract tests proving those flows become control-plane
  submission clients rather than direct peer mutators.
- Add end-to-end tests proving service-routed same-host, remote-profile, and Jenkins submissions
  all preserve the same admission, locking, and deploy-record semantics.
- Add fail-closed tests for missing service endpoint, missing auth, unsupported mixed-mode flags,
  and service-unavailable behavior.
- Extend operator-surface tests so the machine-readable summaries for same-host, remote-profile, and
  Jenkins callers continue to report authoritative submission / result information from the control
  plane.

### Docs (in this PR)

- Update [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) and
  [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md) so
  protected/shared client paths are documented uniformly as submission clients of the central
  control plane rather than a mix of service and peer-mutator execution models.
- Remove operator docs that describe reviewed SSH peer mutation or local in-process shared-host
  mutation as normal protected/shared workflows.
- Update
  [nixos-shared-host-setup.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-setup.md)
  and
  [nixos-shared-host-technician-checklist.md](/Users/kiltyj/Code/bucknix-fresh/docs/nixos-shared-host-technician-checklist.md)
  to document the reviewed same-host, remote-profile, and Jenkins service-submission workflows,
  including required service endpoint / auth configuration.
- Document the fail-closed error cases and migration guidance for callers that still expect the
  older peer-mutator behavior.

### Verification Commands

- `buck2 test //...`
- reviewed service-only client / wrapper submission flows introduced in this PR

### Expected Regression Scope

- `deployment-only`
- This PR should stay within deployment front-door client wiring, remote-profile / Jenkins wrapper
  control-plane submission flow, service configuration handling, machine-readable result surfaces,
  and deployment-domain tests/docs. Under the deployment-only verify policy, default `v` / CI can
  run the reviewed deployment suite rather than the full non-deployment build-system verify scope.

### Acceptance Criteria

- Every reviewed `nixos-shared-host` protected/shared mutation path submits through the central
  control-plane service instead of falling back to local or SSH peer mutation.
- Same-host, remote-profile, and Jenkins callers all use one explicit reviewed service/client
  boundary with fail-closed configuration behavior.
- Approval, run-action, locking, orchestration, and deploy-record authority remain centralized
  behind the service boundary for every protected/shared client mode.
- Tests and operator docs describe the same service-only client model.

### Risks

This changes every remaining reviewed mutation entrypoint for the shared-host slice, so a weak
migration could strand operators, break wrapper automation, or accidentally preserve an undocumented
peer-mutator escape hatch.

### Mitigation

Land the migration with explicit fail-closed errors, stable machine-readable client outputs, and
end-to-end coverage for same-host, remote-profile, and Jenkins submission flows in the same PR.

### Consequence of Not Implementing

The deployment system would continue to claim a central protected/shared mutation authority while
still shipping reviewed local or SSH peer-mutator paths that bypass the service boundary.

### Downsides for Implementing

This forces remaining callers to adopt explicit service configuration and may require wrapper /
operator workflow changes during migration.

### Recommendation

Implement after PR-49 so all reviewed clients switch only once the authoritative backend already
owns durable worker claims, status/result reads, and deploy-record persistence.

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
   control-plane authority, initial shared locking, immutable artifacts, replay, and admission.
6. PR-9 through PR-10: reach the secondary milestone by adding Cloudflare Pages static-webapp deploys
   and a full Pleomino `dev -> staging -> prod` flow.
7. PR-11 through PR-13, with PR-12.1 verify-scope hardening immediately after preview: generalize
   that second milestone across providers, preview, deployment-test ownership cleanup, and
   changed-based orchestration.
8. PR-14 through PR-16: close the remaining model gaps for multi-component rollout,
   rebuild-per-stage, and cross-cutting protected/shared semantics.
9. PR-17 through PR-20: harden protected/shared admission, prerequisite-mode and
   promotion-compatibility validation, and control-plane contracts, then close the remaining
   replay, rollback, target-transition, and execution-boundary gaps needed for the full reviewed
   operator model.
10. PR-21 through PR-24: finish the infra-affecting plan/diff gate, destructive-intent workflow,
    and the core protected/shared operational closeout for retention, resilience, recovery,
    break-glass, observability, and redaction.
11. PR-25 through PR-26: finish progressive rollout and the reviewed bootstrap/self-hosting core
    so the full protected/shared execution model is in place.
12. PR-27 through PR-29: close the remaining front-door CLI contract, exact local immutable-
    selector and preview-policy boundary, shared locking plus queue/effective-lock-scope policy,
    and the non-static component-kind plus provider-capability rollout/default-action foundation.
13. PR-30 through PR-34: add the remaining provider-family breadth across S3 static hosting,
    Kubernetes service/shared-platform deployments, SSR hosting, and both mobile-store release
    families.
14. PR-35 through PR-36: close the remaining protected/shared policy contracts for admission
    attestation/supply-chain enforcement and explicit smoke exceptions.
15. PR-37 through PR-38: close the remaining protected/shared execution contracts for secrets,
    credential lifecycle, publish safety, automatic retry, and smoke timeout budgets.
16. PR-39 through PR-40: close lane-governance verification plus the core record/replay,
    compatibility, provenance, and explicit `release_actions` contract work.
17. PR-41 through PR-43: close the remaining behavioral, replay-provenance, and repo-level
    front-door contract gaps for failure-path `release_actions`, cross-provider runner identity,
    and validation/provision-only semantics so the full deployment design is implemented end to
    end.
18. PR-44 through PR-45: finish deployment-domain methodology compliance and then close the final
    promotion-compatibility gap so flexible `dev` environments can promote into stricter higher
    environments through one explicit reviewed cross-provider contract.
19. PR-46 through PR-48: close the remaining review-identified end-state gaps by restoring
    Buck/TARGETS as the sole public source of truth for deploy metadata, moving protected/shared
    mutation onto the reviewed control-plane service / backend / worker architecture, and adding
    the first-class approval-service flow that advances `pending_approval` runs without creating a
    second run.
20. PR-49 through PR-50: harden the authoritative backend / worker-ownership contract and then
    remove the remaining protected/shared peer-mutator client paths so every reviewed same-host,
    remote-profile, and Jenkins caller routes through one central control-plane authority backed by
    authoritative Postgres records.

## Companion Docs

- [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md)
