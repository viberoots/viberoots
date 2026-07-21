import { spawn } from "node:child_process";

const DEFAULT_MAX_KIB = 500 * 1024;
const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;
export const NATIVE_PNPM_COMMAND_TIMEOUT_MS = 600_000;
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
  diskRoot?: string;
  maxKib?: number;
  measureUsage?: () => Promise<{ diskDeltaKib: number; fixtureKib: number }>;
  sampleIntervalMs?: number;
  timeoutMs?: number;
};

export async function runGuardedCommand(
  command: string,
  args: string[],
  opts: RunOptions,
): Promise<CommandResult> {
  const maxKib = opts.maxKib ?? DEFAULT_MAX_KIB;
  const diskRoot = opts.diskRoot || opts.fixtureRoot;
  const beforeDisk = opts.measureUsage ? 0 : await diskUsedKib(diskRoot);
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
    let sampleInFlight: Promise<void> | null = null;
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
    const measure = async () => {
      const { fixtureKib, diskDeltaKib } = opts.measureUsage
        ? await opts.measureUsage()
        : await (async () => {
            const [measuredFixtureKib, diskKib] = await Promise.all([
              directorySizeKib(opts.fixtureRoot),
              diskUsedKib(diskRoot),
            ]);
            return { fixtureKib: measuredFixtureKib, diskDeltaKib: diskKib - beforeDisk };
          })();
      peakFixtureKib = Math.max(peakFixtureKib, fixtureKib);
      peakDiskDeltaKib = Math.max(peakDiskDeltaKib, diskDeltaKib);
      if (fixtureKib > maxKib || diskDeltaKib > maxKib) {
        throw new Error(
          `native reconcile exceeded ${maxKib}KiB guard: fixture=${fixtureKib}KiB diskDelta=${diskDeltaKib}KiB`,
        );
      }
    };
    const invocation = [command, ...args].map((value) => JSON.stringify(value)).join(" ");
    const timeoutMs = opts.timeoutMs ?? NATIVE_PNPM_COMMAND_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      stop(new Error(`command exceeded ${timeoutMs}ms: ${invocation}`));
    }, timeoutMs);
    const sampler = setInterval(() => {
      if (settled || stopReason || sampleInFlight) return;
      sampleInFlight = measure()
        .catch((error) => {
          const reason = error instanceof Error ? error : new Error(String(error));
          if (settled) {
            stopReason ||= reason;
          } else {
            stop(reason);
          }
        })
        .finally(() => {
          sampleInFlight = null;
        });
    }, opts.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
    child.on("error", stop);
    child.on("close", async (status) => {
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      clearInterval(sampler);
      await sampleInFlight;
      if (!stopReason) {
        try {
          await measure();
        } catch (error) {
          stopReason = error instanceof Error ? error : new Error(String(error));
        }
      }
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

export function diskUsageCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  return platform === "darwin"
    ? { command: "/bin/df", args: ["-Pk", target] }
    : { command: "df", args: ["-k", target] };
}

export function parseDfUsedKib(output: string): number {
  const fields = output.trim().split("\n").at(-1)?.trim().split(/\s+/) || [];
  return parseNonnegativeKib(fields[2], "df");
}

export function parseDiskutilUsedKib(output: string): number {
  const match = output.match(/<key>CapacityInUse<\/key>\s*<integer>(\d+)<\/integer>/);
  const bytes = parseNonnegativeKib(match?.[1], "diskutil");
  return Math.ceil(bytes / 1024);
}

export function parseDfDevice(output: string): string {
  const device = output.trim().split("\n").at(-1)?.trim().split(/\s+/)[0];
  if (!device?.startsWith("/dev/")) {
    throw new Error("df did not emit a device path");
  }
  return device;
}

async function diskUsedKib(target: string): Promise<number> {
  const invocation = diskUsageCommand(target);
  const output = await shellOutput(invocation.command, invocation.args);
  if (process.platform !== "darwin") return parseDfUsedKib(output);
  const device = parseDfDevice(output);
  return parseDiskutilUsedKib(await shellOutput("/usr/sbin/diskutil", ["info", "-plist", device]));
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
