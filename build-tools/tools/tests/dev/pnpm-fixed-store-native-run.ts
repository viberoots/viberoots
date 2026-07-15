import { spawn } from "node:child_process";

const DEFAULT_MAX_KIB = 500 * 1024;
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
const COMMAND_TIMEOUT_MS = 150_000;
const TERMINATION_GRACE_MS = 5_000;

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  peakFixtureKib: number;
  peakDiskDeltaKib: number;
};

type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  fixtureRoot: string;
  maxKib?: number;
  sampleIntervalMs?: number;
  timeoutMs?: number;
};

export async function runGuardedCommand(
  command: string,
  args: string[],
  opts: RunOptions,
): Promise<CommandResult> {
  const maxKib = opts.maxKib ?? DEFAULT_MAX_KIB;
  const beforeDisk = await diskUsedKib(opts.fixtureRoot);
  const startedAt = Date.now();
  let peakFixtureKib = 0;
  let peakDiskDeltaKib = 0;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let stopReason: Error | null = null;
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));

    const signalChild = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
      } catch {}
    };
    const stop = (reason: Error) => {
      if (stopReason || settled) return;
      stopReason = reason;
      signalChild("SIGTERM");
      forceTimer = setTimeout(() => signalChild("SIGKILL"), TERMINATION_GRACE_MS);
    };
    const timeout = setTimeout(
      () =>
        stop(new Error(`command exceeded ${opts.timeoutMs ?? COMMAND_TIMEOUT_MS}ms: ${command}`)),
      opts.timeoutMs ?? COMMAND_TIMEOUT_MS,
    );
    const sampler = setInterval(async () => {
      if (settled || stopReason) return;
      try {
        const [fixtureKib, diskKib] = await Promise.all([
          directorySizeKib(opts.fixtureRoot),
          diskUsedKib(opts.fixtureRoot),
        ]);
        peakFixtureKib = Math.max(peakFixtureKib, fixtureKib);
        peakDiskDeltaKib = Math.max(peakDiskDeltaKib, diskKib - beforeDisk);
        if (fixtureKib > maxKib || diskKib - beforeDisk > maxKib) {
          stop(
            new Error(
              `native reconcile exceeded ${maxKib}KiB guard: fixture=${fixtureKib}KiB diskDelta=${diskKib - beforeDisk}KiB`,
            ),
          );
        }
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    }, opts.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
    child.on("error", stop);
    child.on("close", (status) => {
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      clearInterval(sampler);
      if (stopReason) {
        Object.assign(stopReason, {
          stdout,
          stderr,
          elapsedMs: Date.now() - startedAt,
          peakFixtureKib,
          peakDiskDeltaKib,
        });
        reject(stopReason);
      } else
        resolve({
          status,
          stdout,
          stderr,
          elapsedMs: Date.now() - startedAt,
          peakFixtureKib,
          peakDiskDeltaKib,
        });
    });
  });
}

export async function directorySizeKib(target: string): Promise<number> {
  const output = await shellOutput("du", ["-sk", target], (candidate) => /^\d+\s/.test(candidate));
  return parseNonnegativeKib(output.split(/\s+/)[0], "du");
}

async function diskUsedKib(target: string): Promise<number> {
  const output = await shellOutput("df", ["-k", target]);
  const fields = output.trim().split("\n").at(-1)?.trim().split(/\s+/) || [];
  return parseNonnegativeKib(fields[2], "df");
}

export function parseNonnegativeKib(value: string | undefined, command: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${command} did not emit a nonnegative KiB value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${command} emitted an invalid KiB value`);
  }
  return parsed;
}

async function shellOutput(
  command: string,
  args: string[],
  acceptOutputOnFailure?: (output: string) => boolean,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (status) => {
      const output = stdout.trim();
      if (status === 0 || acceptOutputOnFailure?.(output)) resolve(output);
      else reject(new Error(stderr || `${command} failed`));
    });
  });
}
