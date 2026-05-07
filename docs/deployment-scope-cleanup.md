# Deployment Scope Cleanup Proposal

## Problem

Deployment-only verification exists, but routine deployment-scope changes can still fall back to
the full build-system path when they touch shared Buck/Starlark test infrastructure.

The current example is:

- `build-tools/tools/tests/deployment_conventions.bzl`

That path looks deployment-specific, but the verify classifier intentionally treats it as a reviewed
shared build-system path. When it appears in the changed-path set,
`resolveDeploymentImpactSelection(...)` reports `mixed-build-system`, and the deployment-only verify
override does not apply.

Full build-system validation is the safe default for shared build-system changes, but it is
expensive. We should keep the safety boundary while moving routine deployment metadata edits out of
the shared path.

## Current Classification Rationale

`deployment_conventions.bzl` is loaded by `build-tools/tools/tests/defs.bzl`, which owns shared
`auto_zx_tests(...)` target generation for zx tests. The file does more than store deployment data:

- assigns `domain:deployment`
- assigns `verify:resource-limited`
- validates deployment-domain labels during Buck target generation
- fails closed when deployment tests are not explicitly classified

A bad edit can affect Buck evaluation, target labels, scheduling behavior, or label validation. For
that reason, the current classifier lists the file under reviewed shared build-system paths in
`build-tools/tools/lib/deployment-verify-scope.ts`, and the policy tests assert that it broadens to
full build-system scope.

## Why Not Reclassify It Wholesale

Reclassifying `deployment_conventions.bzl` as deployment-owned would make routine metadata edits
cheaper, but it would also make logic changes cheaper. That is the risky part.

The file is executable shared test-loading logic, not only deployment-owned taxonomy data. If logic
there mislabels targets, skips validation, or changes resource-limited scheduling, the impact can
extend beyond the deployment-only selector's intended safety boundary.

The safer rule is:

- shared loader or validation logic remains full build-system scope
- mutable deployment-domain metadata lives under the reviewed deployment-owned test area

## Proposed Refactor

Move the mutable resource-limited deployment test data out of the shared shim and into a
deployment-owned file under:

- `build-tools/tools/tests/deployments/**`

Good candidate locations:

- extend `build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl`
- or add a sibling file such as
  `build-tools/tools/tests/deployments/deployment_resource_limited_taxonomy.bzl`

The shared `deployment_conventions.bzl` should remain a small adapter that imports deployment-owned
data and applies stable validation rules.

Specifically:

1. Move the resource-limited deployment test set and exemption table out of
   `deployment_conventions.bzl`.
2. Export explicit taxonomy values from the deployment-owned file.
3. Keep `deployment_conventions.bzl` responsible only for stable glue:
   - load taxonomy data
   - check whether a path is in `build-tools/tools/tests/deployments/`
   - apply labels
   - enforce fail-closed validation
4. Update boundary and impact-policy tests so changes to deployment-owned taxonomy files remain
   `deployment-only`.
5. Keep `deployment_conventions.bzl` itself classified as shared, so future logic edits still
   require full build-system validation.
6. Keep the deployment-owned resource-limited taxonomy file data-only. A policy test should fail if
   the file grows executable Starlark such as `load(...)`, `def`, `if`, `for`, or comprehensions.

## Expected Outcome

After the refactor, common deployment test maintenance should avoid full build-system validation:

- adding a deployment test to the reviewed taxonomy
- renaming a deployment test in taxonomy data
- changing whether a deployment test is resource-limited
- adding or removing a resource-limited exemption

Those edits would touch only `build-tools/tools/tests/deployments/**`, which is already reviewed as
deployment-owned.

Edits to shared Buck/Starlark logic would still broaden to full build-system scope:

- `build-tools/tools/tests/deployment_conventions.bzl`
- `build-tools/tools/tests/defs.bzl`
- verify selector implementation under `build-tools/tools/dev/**`
- shared classifier implementation under `build-tools/tools/lib/**`

## Validation Plan

The refactor itself should receive one full build-system validation because it changes the shared
shim/import contract.

Focused validation should include:

- deployment verify scope boundary tests
- deployment impact selector policy tests
- deployment-domain taxonomy drift tests
- deployment-domain labels cquery tests
- any direct tests covering `verify:resource-limited` scheduling

After the refactor lands, subsequent taxonomy-only or resource-limited metadata-only edits should be
confirmed with the deployment impact inspector and should resolve to `deployment-only`.

## Non-Goals

- Do not weaken the fail-closed deployment-domain taxonomy check.
- Do not classify unknown `build-tools/**` paths as deployment-owned by name alone.
- Do not move shared Buck target-generation logic into the deployment-owned scope just to reduce
  validation time.
- Do not bypass full build-system validation for edits to the shared shim itself.
