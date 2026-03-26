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
migration or alias exception support for controlled target ownership transitions.

### Scope & Changes

- Implement secret-requirement and runtime-config-requirement validation and replay preservation.
- Implement reviewed built-in release-action registry support for protected/shared flows.
- Implement migration or alias exception objects for controlled live-target ownership transitions.
- Enforce fail-closed handling when replay invariants no longer match current ownership or policy.
- Ensure deployment records preserve the required secret-free config and exception references.

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

### Acceptance Criteria

- The remaining major cross-cutting design requirements are implemented and tested.
- Secret, config, release-action, and migration semantics are explicit and fail closed.
- The system no longer relies on undocumented assumptions for protected/shared execution.

### Risks

These are cross-cutting features with broad reach, so late-stage drift is easy.

### Mitigation

Anchor each feature to explicit validation, replay, and record contracts in the same PR.

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
2. PR-4 through PR-8: turn that first provider slice into a real shared deployment system with
   records, control-plane authority, immutable artifacts, replay, and admission.
3. PR-9 through PR-10: reach the secondary milestone by adding Cloudflare Pages static-webapp deploys
   and a full Pleomino `dev -> staging -> prod` flow.
4. PR-11 through PR-13: generalize that second milestone across providers, preview, and changed-based
   orchestration.
5. PR-14 through PR-16: close the remaining model gaps for multi-component rollout, rebuild-per-stage,
   and cross-cutting protected/shared semantics.

## Companion Docs

- [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Mini Shared-Dev Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/mini-deployment.md)
