export const ALLOWED_PATHS = new Set([
  "build-tools/tools/dev/stale-names-lint.ts",
  "build-tools/tools/dev/stale-names-lint-allowlists.ts",
  "build-tools/tools/tests/linting/no-stale-viberoots-names.enforcement.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.control-plane-service-env.test.ts",
  "docs/repo-rename.md",
  "docs/runtime-prefix-migration.md",
  "docs/contributor-naming-conventions.md",
  "docs/mini-name-migration-instructions.md",
  "mayday-test-time-debugging.md",
  "pnpm-lock.yaml",
]);

export const ALLOWED_PREFIXES = [
  "docs/build-history/",
  "docs/design-history/",
  "third_party/uv2nix/",
];

export const PLAN_NUMBER_SKIP_PATHS = new Set([
  "build-tools/tools/tests/linting/rename-inventory.closeout.test.ts",
  "build-tools/tools/tests/linting/stale-names-lint.behavior.test.ts",
  "docs/deployment-plan.md",
  "docs/external-deployments-plan.md",
  "docs/handbook/nix-gaps-plan.md",
  "docs/handbook/nix-gaps-prs.md",
  "build-tools/tools/nix/shared-host-identity-provider-migration.nix",
]);

export const PLAN_NUMBER_SKIP_PREFIXES = [
  "build-tools/tools/deployments/deployment-phase0-",
  "build-tools/tools/tests/deployments/deployment-phase0-",
  "build-tools/tools/tests/deployments/deployment-readiness-gates",
  "build-tools/tools/tests/deployments/opentofu-foundation-",
  "build-tools/tools/tests/deployments/phase0-deployments.",
  "build-tools/tools/tests/scaffolding/webapp-",
];

export const MIGRATION_LABEL_SKIP_PATHS = new Set([
  "build-tools/tools/dev/stale-names-lint.ts",
  "build-tools/tools/dev/stale-names-lint-allowlists.ts",
  "build-tools/tools/deployments/nixos-shared-host-client-manifest.ts",
  "build-tools/tools/deployments/nixos-shared-host-host-apply.ts",
  "build-tools/tools/deployments/nixos-shared-host-install-contract.ts",
  "build-tools/tools/deployments/nixos-shared-host-install-host-support.ts",
  "build-tools/tools/deployments/nixos-shared-host-install-host.ts",
  "build-tools/tools/tests/deployments/deployment-admission.fixture.ts",
  "build-tools/tools/tests/deployments/deployment-admission.supply-chain.replay.test.ts",
  "build-tools/tools/tests/deployments/deployment-admission.supply-chain.test.ts",
  "build-tools/tools/tests/deployments/deployment-admin-keycloak.remote-profile.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.install.manifest.contract.test.ts",
  "build-tools/tools/tests/lang/importer-wiring.macros-avoid-direct-lockfile-parsing.enforcement.test.ts",
  "build-tools/tools/tests/lang/importer-wiring.no-v2-paths.enforcement.test.ts",
  "build-tools/tools/tests/lang/package-local-wiring.enforcement.no-bypass.test.ts",
  "build-tools/tools/tests/lib/providers.lockfile-collision-detection.test.ts",
  "build-tools/tools/tests/linting/rename-inventory.closeout.test.ts",
  "build-tools/tools/tests/linting/stale-names-lint.behavior.test.ts",
  "build-tools/tools/tests/scaffolding/sync-providers-node.determinism.test.ts",
  "build-tools/tools/tests/scaffolding/webapp.module-dep-label-normalization.contract.test.ts",
  "projects/apps/pleomino/src/game/persistence-state-v1.ts",
]);
