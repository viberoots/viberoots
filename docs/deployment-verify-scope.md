# Deployment Verify Scope

This document records the first reviewed deployment-domain test label and the first reviewed
build-system ownership boundary from PR-4.5.1. The goal is to make later deployment-only verify
selection rest on explicit metadata instead of path guesses.

## Reviewed Buck label

- Reviewed deployment-domain test label: `domain:deployment`
- Initial reviewed deployment test area: `build-tools/tools/tests/deployments/**`
- Fail-closed rule: every new test under that reviewed area must be classified explicitly in
  `build-tools/tools/tests/deployment_conventions.bzl`

Inspect the reviewed deployment suite with Buck:

```bash
buck2 cquery --target-platforms prelude//platforms:default \
  'attrfilter(labels, "domain:deployment", //...)'
```

## Reviewed deployment-owned build-system paths

The initial deployment-owned build-system boundary is intentionally narrow:

- `build-tools/deployments/**`
- `build-tools/tools/deployments/**`
- `build-tools/tools/tests/deployments/**`

## Reviewed shared paths

Touches to these reviewed shared paths still stay on the full build-system verify path:

- `build-tools/tools/buck/**`
- `build-tools/tools/dev/**`
- `build-tools/tools/lib/**`
- `build-tools/lang/**`
- `toolchains/**`
- `third_party/providers/**`
- `prelude/**`
- root Buck/Nix config files: `BUCK`, `TARGETS`, `.buckconfig`, `flake.nix`, `flake.lock`

## Non-goals

- This PR does not change verify selector behavior yet.
- This PR does not make deployment-only skipping available yet.
- This PR does not treat project-owned deployment declarations under `projects/deployments/**` as
  part of the reviewed build-system ownership boundary.
