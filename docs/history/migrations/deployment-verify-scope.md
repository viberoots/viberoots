# Deployment Verify Scope

This document records the first reviewed deployment-domain test label, the first reviewed
build-system ownership boundary, the fail-closed path classifier, the deployment-aware verify/CI
execution path, the ownership split that moves mutable deployment-domain taxonomy data into the
reviewed deployment-owned test area, and the methodology closeout that adds a deployment-domain
file-size guardrail. The goal is to keep deployment-only selection resting on explicit metadata
instead of path guesses.

## Reviewed Buck label

- Reviewed deployment-domain test label: `domain:deployment`
- Initial reviewed deployment test area: `build-tools/tools/tests/deployments/**`
- Fail-closed rule: every new test under that reviewed area must be classified explicitly in
  `build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl`

The shared zx-test loader stays in `build-tools/tools/tests/defs.bzl` and the thin
`build-tools/tools/tests/deployment_conventions.bzl` shim. The mutable ownership table now lives in
`build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl`, so routine deployment test
additions or renames do not touch the shared loader path.

Inspect the reviewed deployment suite with the repo wrapper:

```bash
b cquery \
  'attrfilter(labels, "domain:deployment", //...)'
```

If you need raw `buck2` instead of the wrapper, use:

```bash
buck2 cquery --target-platforms prelude//platforms:default \
  'attrfilter(labels, "domain:deployment", //...)'
```

## Reviewed deployment-owned build-system paths

The initial deployment-owned build-system boundary is intentionally narrow:

- `build-tools/deployments/**`
- `build-tools/tools/deployments/**`
- `build-tools/tools/tests/deployments/**`
- reviewed deployment-owned support files outside those primary prefixes:
  - `build-tools/tools/tests/scaffolding/deployment.cloudflare-containers.scaffold-contract.test.ts`
  - `build-tools/tools/tests/scaffolding/deployment.scaffold-contract.test.ts`
  - `build-tools/tools/bin/control-plane`
  - `build-tools/tools/nix/shared-host-identity-provider-bootstrap.nix`
  - `build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-migration-steps.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-module.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-migration.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-options.nix`
  - `build-tools/tools/nix/shared-host-postgres-module.nix`
  - `build-tools/tools/nix/shared-host-vault-module.nix`
  - `build-tools/tools/nix/nixos-shared-host-module.nix`
  - `build-tools/tools/nix/nixos-shared-host-module-runtimes.nix`
  - `build-tools/tools/nix/deployment-control-plane-container-defaults.nix`
  - `build-tools/tools/nix/deployment-control-plane-container-module.nix`
  - `build-tools/tools/nix/deployment-control-plane-mini-cloud-profile.nix`
- deployment-domain taxonomy data currently lives at
  `build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl`

## Reviewed shared paths

Touches to these reviewed shared paths still stay on the full build-system verify path:

- `build-tools/tools/buck/**`
- `build-tools/tools/tests/deployment_conventions.bzl`
- `build-tools/tools/tests/defs.bzl`
- `build-tools/tools/dev/**`
- `build-tools/tools/lib/**`
- `build-tools/lang/**`
- `toolchains/**`
- `third_party/providers/**`
- `prelude/**`
- root Buck/Nix config files: `BUCK`, `TARGETS`, `.buckconfig`, `flake.nix`, `flake.lock`

## Deployment-impact classifier

The fail-closed classifier covers changed paths with these stable modes:

- `deployment-only`
- `deployment-and-project-impact`
- `mixed-build-system`
- `no-deployment-impact`

Decision order is conservative:

1. Markdown and reStructuredText are documentation by default, including files under
   `build-tools/**`. They do not broaden to full build-system verification unless a separate
   non-documentation file in the same change-set requires it.
2. Reviewed deployment/operator documentation paths select the deployment documentation contract
   bucket instead of the full deployment domain. This includes active deployment docs under
   `docs/deployment*`, `docs/deployments*`, `docs/infisical*`, `docs/nixos-shared-host*`,
   `docs/sprinkleref*`, `projects/docs/phase_0_*`, `projects/deployments/**`, and deployment
   profile docs under `build-tools/tools/deployments/**`.
3. Any reviewed shared build-system path broadens immediately to `mixed-build-system`.
4. Any unknown or unreviewed relevant `build-tools/**` path broadens immediately to
   `mixed-build-system`.
5. Any non-documentation change under `projects/deployments/**` produces
   `deployment-and-project-impact`.
6. Remaining reviewed deployment-owned build-system changes produce `deployment-only`.
7. Everything else stays `no-deployment-impact`.

Because the taxonomy table now lives under `build-tools/tools/tests/deployments/**`, a taxonomy-only
edit resolves to `deployment-only`, while edits to the shared loader shim still broaden to
`mixed-build-system`.

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
  --changed build-tools/deployments/defs.bzl,projects/deployments/pleomino/dev/TARGETS
```

## Deployment-aware verify execution

The first execution control is:

- `VBR_DEPLOYMENT_TEST_SCOPE=auto|always|never`
- `auto`:
  - reviewed deployment/operator documentation-only changes run the documentation contract bucket
    rather than `domain:deployment`
  - `deployment-only` runs `domain:deployment` targets plus the reviewed deployment safety floor
  - `deployment-and-project-impact` runs that same deployment suite plus project-impact targets for
    the changed app/lib/deployment projects
  - `mixed-build-system` keeps the existing full build-system verify path
  - `no-deployment-impact` keeps the existing non-deployment selector behavior
- `always` requires the change-set to classify as safe `deployment-only`; otherwise verify/CI fails
  fast with diagnostics
- `never` bypasses the deployment-aware override and keeps the existing selector behavior

The reviewed deployment safety floor is intentionally non-empty and currently includes:

- `//:deployment_domain_file_size_lint`
- `//:deployment_domain_labels_cquery`
- `//:deployment_domain_taxonomy_drift`
- `//:deployment_verify_scope_boundary`

Verify and CI both log the resolved deployment selection so operators can audit why a deployment
suite, union scope, or full build-system scope ran.

## Deployment-domain methodology guardrail

The deployment-owned file-size closeout started this contract, and the current contract keeps those files
inside the repo-wide owner-local methodology gate:

- command: `zx-wrapper build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true`
- deployment-owned files under:
  - `build-tools/deployments/**`
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - `build-tools/tools/nix/shared-host-deploy-auth-callback-module.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-bootstrap.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-migration-steps.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-module.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-migration.nix`
  - `build-tools/tools/nix/shared-host-identity-provider-options.nix`
  - `build-tools/tools/nix/shared-host-postgres-module.nix`
  - `build-tools/tools/nix/shared-host-vault-module.nix`
  - `build-tools/tools/nix/nixos-shared-host-module.nix`
  - `build-tools/tools/nix/nixos-shared-host-module-runtimes.nix`
  - `build-tools/tools/nix/deployment-control-plane-container-defaults.nix`
  - `build-tools/tools/nix/deployment-control-plane-container-module.nix`
  - `build-tools/tools/nix/deployment-control-plane-mini-cloud-profile.nix`
    are covered automatically by that repo-wide scope
- failure contract:
  - fail closed when a reviewed deployment-owned file exceeds 250 lines
  - report the offending relative path and measured line count
  - do not rely on a shared deployment-only allowlist or scope registry

When this guardrail fails, the expected fix is still to split the oversized deployment-owned file
into smaller focused modules instead of adding shared verify wiring. If a checked-in generated
artifact truly needs an exception, it must live in an owner-local `methodology-exceptions.json`
below the owning subtree.

## Historical Non-Goals

- This PR does not change verify selector behavior yet.
- This PR does not make deployment-only skipping available yet.
- This PR does not treat project-owned deployment declarations under `projects/deployments/**` as
  part of the reviewed deployment-owned build-system boundary.
