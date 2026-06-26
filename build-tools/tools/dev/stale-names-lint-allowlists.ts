import * as fsp from "node:fs/promises";
import path from "node:path";

const WORKSPACE_STALE_NAMES_CONFIG = "projects/config/stale-names-lint.json";

export const ALLOWED_PATHS = new Set([
  "build-tools/tools/dev/stale-names-lint.ts",
  "build-tools/tools/dev/stale-names-lint-allowlists.ts",
  "build-tools/tools/tests/linting/no-stale-viberoots-names.enforcement.test.ts",
  "build-tools/tools/tests/deployments/nixos-shared-host.control-plane-service-env.test.ts",
  "docs/history/migrations/repo-rename.md",
  "docs/history/migrations/runtime-prefix-migration.md",
  "docs/contributor-naming-conventions.md",
  "docs/history/migrations/mini-name-migration-instructions.md",
  "docs/history/investigations/mayday-test-time-debugging.md",
  "pnpm-lock.yaml",
]);

export const ALLOWED_PREFIXES = [
  "docs/history/build-system/logs/",
  "docs/history/designs/legacy/",
  "third_party/uv2nix/",
];

export const PLAN_NUMBER_SKIP_PATHS = new Set([
  "build-tools/tools/tests/linting/rename-inventory.closeout.test.ts",
  "build-tools/tools/tests/linting/stale-names-lint.behavior.test.ts",
  "docs/history/plans/deployment-plan.md",
  "docs/history/plans/external-deployments-plan.md",
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
]);

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function validateParentOwnedPath(configPath: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${configPath}: migrationLabelSkipPaths entries must be non-empty strings`);
  }
  const rel = normalizeRel(value);
  if (path.isAbsolute(value) || rel.startsWith("../") || rel.includes("/../")) {
    throw new Error(`${configPath}: migrationLabelSkipPaths entries must stay repo-relative`);
  }
  if (rel === "viberoots" || rel.startsWith("viberoots/")) {
    throw new Error(`${configPath}: parent config cannot skip viberoots-owned source`);
  }
  return rel;
}

export async function readMigrationLabelSkipPaths(repoRoot: string): Promise<Set<string>> {
  const skipPaths = new Set(MIGRATION_LABEL_SKIP_PATHS);
  const configPath = path.join(repoRoot, WORKSPACE_STALE_NAMES_CONFIG);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(configPath, "utf8")) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return skipPaths;
    throw err;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${WORKSPACE_STALE_NAMES_CONFIG}: expected a JSON object`);
  }
  const entries = (parsed as { migrationLabelSkipPaths?: unknown }).migrationLabelSkipPaths ?? [];
  if (!Array.isArray(entries)) {
    throw new Error(`${WORKSPACE_STALE_NAMES_CONFIG}: migrationLabelSkipPaths must be an array`);
  }
  for (const entry of entries) {
    skipPaths.add(validateParentOwnedPath(WORKSPACE_STALE_NAMES_CONFIG, entry));
  }
  return skipPaths;
}
