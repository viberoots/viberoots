import process from "node:process";
import { runManagedCommand } from "../../lib/managed-command";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { newManagedCommandActivity } from "./activity";
import { withHeartbeat } from "./heartbeat";

export async function runExactStoreCommand(opts: {
  command?: string;
  label: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  args: string[];
}): Promise<{ stdout: string; stderr: string }> {
  const activity = newManagedCommandActivity();
  const result = await withHeartbeat(
    opts.label,
    runManagedCommand({
      command: opts.command || resolveToolPathSync("nix", opts.env),
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env,
      timeoutMs: opts.timeoutMs,
      activity,
    }),
    { activity, noOutputWarnSec: 60 },
  );
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (stdout) process.stderr.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.ok) return { stdout, stderr };
  const reason = result.timedOut
    ? `timed out after ${Math.max(1, Math.ceil(opts.timeoutMs / 1000))}s`
    : `failed (code=${String(result.code)} signal=${String(result.signal)})`;
  const output = `${stdout}${stderr}`.trim();
  throw new Error(
    output
      ? `[update-pnpm-hash] ${opts.label} ${reason}\n${output}`
      : `[update-pnpm-hash] ${opts.label} ${reason}`,
  );
}
