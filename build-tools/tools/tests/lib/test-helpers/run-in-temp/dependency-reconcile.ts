import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../../../lib/repo";
import { activeViberootsRootFromWorkspace } from "./filtered-inputs";

export async function reconcileTempDependencyInputs(
  tmp: string,
  $tmp: any,
  sourceRoot = String(process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || ""),
): Promise<void> {
  const canonicalSourceRoot = sourceRoot
    ? await fsp.realpath(sourceRoot).catch(() => path.resolve(sourceRoot))
    : await activeViberootsRootFromWorkspace();
  const updateTool = path.join(canonicalSourceRoot, "build-tools", "tools", "dev", "update.ts");
  if (!(await pathExists(updateTool))) {
    throw new Error(`runInTemp: production u entry is missing: ${updateTool}`);
  }
  await $tmp({ cwd: tmp, stdio: "inherit" })`zx-wrapper ${updateTool}`;
}
