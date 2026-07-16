import { runManagedCommand } from "../../../lib/managed-command";

export function testCommandTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.TEST_NIX_TIMEOUT_SECS || "600").trim();
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 1800) {
    throw new Error("TEST_NIX_TIMEOUT_SECS must be an integer from 1 to 1800");
  }
  return Number(raw) * 1000;
}

export async function execManaged(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const result = await runManagedCommand({
    command,
    args,
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs ?? testCommandTimeoutMs(opts.env),
  });
  if (!result.ok) {
    const reason = result.timedOut
      ? ` timed out after ${opts.timeoutMs ?? testCommandTimeoutMs(opts.env)}ms`
      : result.signal
        ? ` exited with signal ${result.signal}`
        : ` exited with code ${String(result.code)}`;
    const diagnostic = [result.stderr, result.stdout]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n")
      .slice(-4096);
    throw Object.assign(
      new Error(`${command}${reason}${diagnostic ? `\n${diagnostic}` : ""}`),
      result,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}
