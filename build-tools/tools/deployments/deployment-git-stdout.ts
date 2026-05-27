#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";

const execFileAsync = promisify(execFile);

export async function deploymentGitStdout(
  workspaceRoot: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workspaceRoot,
      env: scrubControlPlaneChildEnv({}, env),
    });
    return String(stdout || "").trim();
  } catch (error) {
    const stderr = String((error as any)?.stderr || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed in ${workspaceRoot}${stderr ? `: ${stderr}` : ""}`,
    );
  }
}
