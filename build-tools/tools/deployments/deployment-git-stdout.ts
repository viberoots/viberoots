#!/usr/bin/env zx-wrapper

export async function deploymentGitStdout(
  workspaceRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe", env })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    const stderr = String((out as any).stderr || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed in ${workspaceRoot}${stderr ? `: ${stderr}` : ""}`,
    );
  }
  return String((out as any).stdout || "").trim();
}
