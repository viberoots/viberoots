import path from "node:path";
import { runNodeWithZx } from "./node-run";

const ZX_INIT = path.join("build-tools", "tools", "dev", "zx-init.mjs");
const ENFORCE_SCRIPT = path.join("build-tools", "tools", "buck", "enforce-node-deps.ts");
const ENFORCE_PATCH_REQUIREMENTS_SCRIPT = path.join(
  "build-tools",
  "tools",
  "buck",
  "enforce-node-patch-requirements.ts",
);

function resolveNodeDepsScript(repoRoot: string): { zxInitPath: string; script: string } {
  return {
    zxInitPath: path.join(repoRoot, ZX_INIT),
    script: path.join(repoRoot, ENFORCE_SCRIPT),
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
  const zxInitPath = path.join(repoRoot, ZX_INIT);
  const script = path.join(repoRoot, ENFORCE_PATCH_REQUIREMENTS_SCRIPT);
  try {
    await runNodeWithZx({
      cwd: repoRoot,
      zxInitPath,
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
