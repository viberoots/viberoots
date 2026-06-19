import { runNodeWithZx } from "../../lib/node-run";
import { buildToolPath } from "../dev-build/paths";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function zxTestNodeModulesImporter(root: string): Promise<string> {
  try {
    await fsp.access(path.join(root, "pnpm-lock.yaml"));
    return ".";
  } catch {}
  try {
    await fsp.access(path.join(root, "viberoots", "pnpm-lock.yaml"));
    return "viberoots";
  } catch {}
  return ".";
}

export async function computeZxTestNodeModulesOut(
  root: string,
  zxInitPath: string,
): Promise<string> {
  const importer = await zxTestNodeModulesImporter(root);
  const { stdout } = await runNodeWithZx({
    cwd: root,
    script: buildToolPath(root, "tools/dev/node-modules-build.ts"),
    args: ["--print-out-paths", "--importer", importer],
    zxInitPath,
    stdio: "pipe",
    env: {
      ...process.env,
      REPO_ROOT: root,
      WORKSPACE_ROOT: root,
    },
  });
  return (
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || ""
  );
}
