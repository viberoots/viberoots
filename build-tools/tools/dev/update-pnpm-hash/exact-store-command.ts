import process from "node:process";
import { runManagedCommand } from "../../lib/managed-command.ts";
import { newManagedCommandActivity } from "./activity.ts";
import { withHeartbeat } from "./heartbeat.ts";

export async function runExactStoreCommand(opts: {
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
      command: "nix",
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

export async function addExactStoreToNixStore(opts: {
  repoRoot: string;
  importer: string;
  storeDir: string;
  timeoutMs: number;
}): Promise<string> {
  const safeName = opts.importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-") || "root";
  const added = await runExactStoreCommand({
    label: `importer=${opts.importer} step=exact-store-add-path`,
    cwd: opts.repoRoot,
    timeoutMs: opts.timeoutMs,
    env: { ...process.env },
    args: ["store", "add-path", "--name", `pnpm-exact-store-${safeName}`, opts.storeDir],
  });
  const nixStorePath = added.stdout.trim().split(/\s+/).pop() || "";
  if (nixStorePath.startsWith("/nix/store/")) return nixStorePath;
  const output = `${added.stdout}${added.stderr}`.trim();
  throw new Error(
    `failed to import exact pnpm store into nix store for ${opts.importer}: ${output}`,
  );
}
