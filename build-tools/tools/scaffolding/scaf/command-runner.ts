import path from "node:path";

import { runManagedCommand } from "../../lib/managed-command";
import { runNodeWithZx } from "../../lib/node-run";

function repoRoot(): string {
  return path.resolve(process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || process.cwd());
}

function zxInitPath(root: string): string {
  return path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
}

export async function runScafNodeTool(
  scriptRelativePath: string,
  args: string[] = [],
  cwd = repoRoot(),
): Promise<void> {
  const root = repoRoot();
  await runNodeWithZx({
    cwd,
    script: path.join(root, scriptRelativePath),
    args,
    zxInitPath: zxInitPath(root),
    stdio: "pipe",
  });
}

export async function runScafCommand(
  command: string,
  args: string[],
  cwd = repoRoot(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await runManagedCommand({
    command,
    args,
    cwd,
    env,
  });
  if (result.ok) return;
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(output || `${command} exited with code ${String(result.code)}`);
}
