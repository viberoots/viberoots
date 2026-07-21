import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../../../lib/repo";
import { canonicalArtifactToolsRoot } from "../../../../lib/artifact-tool-authority";
import { activeViberootsRootFromWorkspace } from "./filtered-inputs";

const commandEnvironments = new WeakMap<object, NodeJS.ProcessEnv>();

export function registerTempCommandEnvironment(
  $tmp: object,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): void {
  if (path.resolve(String(env.WORKSPACE_ROOT || "")) !== path.resolve(workspaceRoot)) {
    throw new Error("runInTemp: command environment does not own the declared workspace root");
  }
  commandEnvironments.set($tmp, env);
}

export async function reconcileTempDependencyInputs(
  tmp: string,
  $tmp: any,
  sourceRoot = String(process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || ""),
): Promise<void> {
  const canonicalSourceRoot = sourceRoot
    ? await fsp.realpath(sourceRoot).catch(() => path.resolve(sourceRoot))
    : await activeViberootsRootFromWorkspace();
  const updateTool = path.join(canonicalSourceRoot, "build-tools", "tools", "bin", "u");
  if (!(await pathExists(updateTool))) {
    throw new Error(`runInTemp: production u entry is missing: ${updateTool}`);
  }
  const commandEnv = commandEnvironments.get($tmp);
  if (!commandEnv) {
    throw new Error("runInTemp: reconciliation requires a registered command environment");
  }
  await $tmp({ cwd: tmp, stdio: "inherit" })`${updateTool}`;
  const repairedArtifactToolsRoot = canonicalArtifactToolsRoot(tmp);
  commandEnv.VBR_ARTIFACT_TOOLS_ROOT = repairedArtifactToolsRoot;
  process.env.VBR_ARTIFACT_TOOLS_ROOT = repairedArtifactToolsRoot;
}
