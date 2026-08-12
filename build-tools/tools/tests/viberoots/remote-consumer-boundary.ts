import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { proofBoundCachePolicyOutcome } from "../../dev/verify/nix-cache-health-config";
import { NESTED_CACHE_ROLE_CONFIG } from "../../dev/verify/nested-cache-role-transport";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";

export async function exists(file: string): Promise<boolean> {
  return await fsp
    .stat(file)
    .then(() => true)
    .catch(() => false);
}

export async function walkFiles(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) return await walkFiles(full);
      return entry.isFile() ? [full] : [];
    }),
  );
  return files.flat();
}

export function commandEnv(consumer: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const reviewedCache = proofBoundCachePolicyOutcome(process.env);
  const currentToolBin = path.join(
    consumer,
    ".viberoots",
    "current",
    "build-tools",
    "tools",
    "bin",
  );
  const env = {
    ...withoutArtifactEnvironmentInfluence(process.env),
    ...extra,
    ...(reviewedCache
      ? {
          NIX_CONFIG: reviewedCache.config,
          VBR_NIX_CACHE_ROLE_REQUIRED: reviewedCache.requiredSubstituters.join(" "),
          VBR_NIX_CACHE_ROLE_OPTIONAL: reviewedCache.optionalSubstituters.join(" "),
          VBR_NIX_CACHE_ROLE_POLICY: reviewedCache.policy,
          VBR_NIX_CACHE_ROLE_BINDING: process.env.VBR_NIX_CACHE_ROLE_BINDING,
          [NESTED_CACHE_ROLE_CONFIG]: Buffer.from(reviewedCache.config, "utf8").toString("base64"),
          VBR_NIX_CACHE_ROLE_AUTHORITY: process.env.VBR_NIX_CACHE_ROLE_AUTHORITY,
        }
      : {}),
    VIBEROOTS_ROOT: "",
    VIBEROOTS_SOURCE_ROOT: "",
    NO_DEV_SHELL: "1",
    VERIFY_SKIP_LINT: "1",
    VERIFY_ALLOW_CONCURRENT: "1",
    PATH: `${currentToolBin}:${process.env.PATH || ""}`,
  };
  delete env.IN_NIX_SHELL;
  delete env.BUCK_ISOLATION_DIR;
  delete env.VBR_BUCK_REAPER_STATE_FILE;
  for (const key of Object.keys(env)) {
    if (
      (key.startsWith("VBR_VERIFY_") && key !== "VBR_VERIFY_LOCK_DIR") ||
      (key.startsWith("VBR_TEST_SEED_") && key !== "VBR_TEST_SEED_PIN_DIR")
    ) {
      delete env[key];
    }
  }
  return env;
}

export function artifactCommandEnv(
  consumer: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env = commandEnv(consumer, extra);
  delete env.NIX_CONFIG;
  return env;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expectedRealRemoteRequestedRef(ref: string): RegExp {
  const normalized = ref
    .replace(/^git\+/, "")
    .replace(/[?&]rev=[^&]+/, "")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "");
  return new RegExp(`^${escapeRegex(normalized)}$`);
}

export const FORBIDDEN_SOURCE_STATE = [
  ".viberoots",
  "buck-out",
  "build-tools/tmp",
  "config/workspace_buck/graph.json",
  "config/workspace_providers/auto_map.bzl",
  "config/workspace_providers/provider_index.json",
  "projects/config/node-modules.hashes.json",
  "projects/config/shared.json",
  "projects/config/local.json",
  "projects/config/control-plane/stack.json",
  "projects/deployments/example-app/staging/TARGETS",
  "projects/deployments/example-app/provider-state.json",
  "projects/docs/deployments/example-app.md",
  "projects/bootstrap/example-app.json",
  "projects/bootstrap/sample-webapp.json",
  "projects/runtime/bootstrap-defaults.json",
];

export async function assertCleanConsumerBoundary(
  consumer: string,
  sourcePath: string,
  checkpoint = "final",
): Promise<void> {
  const forbiddenConsumerPaths = [
    "viberoots",
    "build-tools",
    "build-tools/tmp",
    "flake.nix",
    "flake.lock",
    "pnpm-workspace.yaml",
    "patches",
    "plugins",
    "types",
    "docs",
  ];
  for (const rel of forbiddenConsumerPaths) {
    assert.equal(await exists(path.join(consumer, rel)), false, `unexpected consumer ${rel}`);
  }
  for (const rel of FORBIDDEN_SOURCE_STATE) {
    assert.equal(
      await exists(path.join(sourcePath, rel)),
      false,
      `unexpected source ${rel} at ${checkpoint}`,
    );
  }
  assert.equal(await exists(path.join(consumer, ".viberoots", "workspace", "providers")), true);
  assert.equal(await exists(path.join(consumer, ".viberoots", "workspace", "buck")), true);
  assert.equal(
    await exists(path.join(consumer, "projects", "config", "node-modules.hashes.json")),
    true,
  );
}
