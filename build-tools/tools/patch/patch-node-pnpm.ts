import { externalNodeToolEnv } from "../lib/external-node-env";

function pnpmBin(): string {
  return (process.env.PNPM_BIN || "").trim() || "pnpm";
}

export async function startNodePatch(importerDir: string, pkg: string) {
  return await $({
    cwd: importerDir,
    env: externalNodeToolEnv(),
    stdio: "pipe",
  })`${pnpmBin()} patch ${pkg}`;
}

export async function commitNodePatch(importerDir: string, workspacePath: string): Promise<void> {
  await $({ cwd: importerDir, env: externalNodeToolEnv() })`${pnpmBin()} patch-commit ${
    workspacePath
  }`;
}

export async function removeNodePatch(importerDir: string, pkg: string): Promise<void> {
  await $({ cwd: importerDir, env: externalNodeToolEnv() })`${pnpmBin()} patch-remove ${pkg}`;
}
