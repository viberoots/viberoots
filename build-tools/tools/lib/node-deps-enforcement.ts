import path from "node:path";
import { runNodeWithZx } from "./node-run.ts";

const ZX_INIT = path.join("build-tools", "tools", "dev", "zx-init.mjs");
const ENFORCE_SCRIPT = path.join("build-tools", "tools", "buck", "enforce-node-deps.ts");

function resolveNodeDepsScript(repoRoot: string): { zxInitPath: string; script: string } {
  return {
    zxInitPath: path.join(repoRoot, ZX_INIT),
    script: path.join(repoRoot, ENFORCE_SCRIPT),
  };
}

export async function checkNodeDepsInCi(repoRoot: string): Promise<void> {
  const { zxInitPath, script } = resolveNodeDepsScript(repoRoot);
  await runNodeWithZx({
    zxInitPath,
    script,
    args: ["--check"],
  });
}

export async function warnNodeDepsInLocal(repoRoot: string): Promise<void> {
  const { zxInitPath, script } = resolveNodeDepsScript(repoRoot);
  try {
    await runNodeWithZx({
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
