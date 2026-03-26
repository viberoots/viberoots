#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli.ts";
import {
  applyNixosSharedHostScopedDeployments,
  reconcileNixosSharedHostPlatformState,
  removeNixosSharedHostPlatformDeployment,
} from "./nixos-shared-host-platform.ts";
import {
  readNixosSharedHostDeploymentsDocument,
  readNixosSharedHostPlatformStateOrEmpty,
  writeJsonDocument,
} from "./nixos-shared-host-io.ts";

function requireFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

async function main() {
  const mode = requireFlag("mode");
  if (mode === "scoped-apply") {
    const statePath = requireFlag("state");
    const outPath = getFlagStr("out", statePath).trim() || statePath;
    const deployments = await readNixosSharedHostDeploymentsDocument(requireFlag("deployments"));
    const current = await readNixosSharedHostPlatformStateOrEmpty(statePath);
    await writeJsonDocument(
      outPath,
      applyNixosSharedHostScopedDeployments(current, deployments.deployments),
    );
    return;
  }
  if (mode === "full-reconcile") {
    const outPath = requireFlag("out");
    const deployments = await readNixosSharedHostDeploymentsDocument(requireFlag("deployments"));
    await writeJsonDocument(
      outPath,
      reconcileNixosSharedHostPlatformState(deployments.deployments),
    );
    return;
  }
  if (mode === "remove") {
    const statePath = requireFlag("state");
    const outPath = getFlagStr("out", statePath).trim() || statePath;
    const deploymentId = requireFlag("deployment-id");
    const current = await readNixosSharedHostPlatformStateOrEmpty(statePath);
    await writeJsonDocument(
      outPath,
      removeNixosSharedHostPlatformDeployment(current, deploymentId),
    );
    return;
  }
  throw new Error(
    `unsupported --mode "${mode}" (expected scoped-apply, full-reconcile, or remove)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
