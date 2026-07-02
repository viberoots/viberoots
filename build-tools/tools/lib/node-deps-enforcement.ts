import path from "node:path";
import * as fs from "node:fs";
import { runNodeWithZx } from "./node-run";
import { buildToolPath, zxInitPath } from "../dev/dev-build/paths";

function resolveNodeDepsScript(repoRoot: string): { zxInitPath: string; script: string } {
  return {
    zxInitPath: zxInitPath(repoRoot),
    script: buildToolPath(repoRoot, "tools/buck/enforce-node-deps.ts"),
  };
}

export async function checkNodeDepsInCi(repoRoot: string): Promise<void> {
  const { zxInitPath, script } = resolveNodeDepsScript(repoRoot);
  await runNodeWithZx({
    cwd: repoRoot,
    zxInitPath,
    script,
    args: ["--check"],
  });
}

export async function warnNodeDepsInLocal(repoRoot: string): Promise<void> {
  if (
    !fs.existsSync(path.join(repoRoot, ".viberoots", "workspace", "node", "workspace-map.json"))
  ) {
    return;
  }
  const { zxInitPath, script } = resolveNodeDepsScript(repoRoot);
  try {
    await runNodeWithZx({
      cwd: repoRoot,
      zxInitPath,
      script,
      args: ["--check"],
      stdio: "pipe",
    });
  } catch (error: any) {
    console.warn("WARN: node deps drift detected between package.json and TARGETS deps");
    const stdout = String(error?.stdout || "").trim();
    const stderr = String(error?.stderr || "").trim();
    if (stdout) console.warn(stdout);
    if (stderr) console.warn(stderr);
    console.warn("Fix: node build-tools/tools/buck/enforce-node-deps.ts --fix");
  }
}

export async function warnNodePatchRequirementsInLocal(repoRoot: string): Promise<void> {
  if (!fs.existsSync(path.join(repoRoot, ".viberoots", "workspace", "buck", "graph.json"))) {
    return;
  }
  const activeZxInitPath = zxInitPath(repoRoot);
  const script = buildToolPath(repoRoot, "tools/buck/enforce-node-patch-requirements.ts");
  try {
    await runNodeWithZx({
      cwd: repoRoot,
      zxInitPath: activeZxInitPath,
      script,
      args: ["--check"],
      stdio: "pipe",
    });
  } catch (error: any) {
    console.warn("WARN: node transitive patch requirements have gaps");
    const stdout = String(error?.stdout || "").trim();
    const stderr = String(error?.stderr || "").trim();
    if (stdout) console.warn(stdout);
    if (stderr) console.warn(stderr);
    console.warn("Fix: patch-pkg sync-required node --importer <importer>");
  }
}
