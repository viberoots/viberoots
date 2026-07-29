#!/usr/bin/env zx-wrapper
import { getArgvTokens } from "../lib/cli";
import { devOverrideEnvNameForLang } from "../lib/dev-override-envs";
import { findRepoRoot } from "../lib/repo";
import { enterCanonicalArtifactEntrypoint } from "./canonical-artifact-entrypoint";
import { runRunnable } from "./run-runnable";
import { applyNixCacheHealthPolicy } from "./verify/nix-cache-health";

async function main(): Promise<void> {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const artifactToolsRoot = enterCanonicalArtifactEntrypoint(workspaceRoot, {
    allowedDevOverrideNames: [devOverrideEnvNameForLang("rust")],
  });
  const cacheHealth = await applyNixCacheHealthPolicy(workspaceRoot);
  await runRunnable({
    argv: ["--mode", "prod", ...getArgvTokens()],
    workspaceRoot,
    artifactToolsRoot,
    ...(cacheHealth.authority === "reviewed"
      ? { nixCacheHealth: { applied: true, config: cacheHealth.nixConfig } }
      : {}),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
