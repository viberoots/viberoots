# Deployment Verify Scope

This document records the first reviewed deployment-domain test label and the first reviewed
build-system ownership boundary from PR-4.5.1, plus the fail-closed path classifier from
PR-4.5.2. The goal is to make later deployment-only verify selection rest on explicit metadata
instead of path guesses.

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

## Deployment-impact classifier

PR-4.5.2 adds a fail-closed classifier over changed paths with these stable modes:

- `deployment-only`
- `deployment-and-project-impact`
- `mixed-build-system`
- `no-deployment-impact`

Decision order is conservative:

1. Any reviewed shared build-system path broadens immediately to `mixed-build-system`.
2. Any unknown or unreviewed relevant `build-tools/**` path broadens immediately to
   `mixed-build-system`.
3. Any change under `projects/deployments/**` produces `deployment-and-project-impact`.
4. Remaining reviewed deployment-owned build-system changes produce `deployment-only`.
5. Everything else stays `no-deployment-impact`.

The classifier emits stable JSON diagnostics with:

- all normalized changed paths
- reviewed deployment-owned paths
- deployment project paths and normalized deployment project roots
- shared build-system trigger paths
- unknown build-system trigger paths
- classifier mode and reason

Inspect the current working tree, or pass explicit changed paths:

```bash
zx-wrapper build-tools/tools/dev/inspect-deployment-impact.ts
zx-wrapper build-tools/tools/dev/inspect-deployment-impact.ts \
  --changed build-tools/deployments/defs.bzl,projects/deployments/pleomino-dev/TARGETS
```

## Non-goals for PR-4.5.2

- This PR does not change verify selector behavior yet.
- This PR does not make deployment-only skipping available yet.
- This PR does not treat project-owned deployment declarations under `projects/deployments/**` as
  part of the reviewed deployment-owned build-system boundary.
