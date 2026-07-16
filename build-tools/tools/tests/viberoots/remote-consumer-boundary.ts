import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";

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
  const currentToolBin = path.join(
    consumer,
    ".viberoots",
    "current",
    "build-tools",
    "tools",
    "bin",
  );
  const env = {
    ...process.env,
    ...extra,
    WORKSPACE_ROOT: consumer,
    VIBEROOTS_ROOT: "",
    VIBEROOTS_SOURCE_ROOT: "",
    NO_DEV_SHELL: "1",
    VBR_RUN_IN_TEMP_REPO: "1",
    VERIFY_SKIP_LINT: "1",
    VERIFY_ALLOW_CONCURRENT: "1",
    VBR_NIX_CACHE_POLICY: "off",
    BUCK_DEVBUILD_REUSE_DAEMON: "0",
    PATH: `${currentToolBin}:${process.env.PATH || ""}`,
  };
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
  "projects/node-modules.hashes.json",
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
  assert.equal(await exists(path.join(consumer, "projects", "node-modules.hashes.json")), true);
}
