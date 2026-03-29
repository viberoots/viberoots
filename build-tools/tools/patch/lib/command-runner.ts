import { runManagedCommand } from "../../lib/managed-command.ts";

export async function runPatchCommand(
  command: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const result = await runManagedCommand({
    command,
    args,
    cwd: opts.cwd,
    env: opts.env,
  });
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}
