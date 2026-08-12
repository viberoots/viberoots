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
};

type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  fixtureRoot: string;
  maxKib?: number;
  measureUsage?: () => Promise<{ fixtureKib: number }>;
  sampleIntervalMs?: number;
  timeoutMs?: number;
};

export async function runGuardedCommand(
  command: string,
  args: string[],
  opts: RunOptions,
): Promise<CommandResult> {
  const maxKib = opts.maxKib ?? DEFAULT_MAX_KIB;
  const startedAt = Date.now();
  let peakFixtureKib = 0;
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
    let timeout: NodeJS.Timeout | undefined;
    let sampler: NodeJS.Timeout | undefined;
    let sampleInFlight: Promise<void> | null = null;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));

    const signalChild = (signal: NodeJS.Signals): boolean => {
      if (!child.pid) return false;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
        return true;
      } catch {
        return false;
      }
    };
    const stop = (reason: Error) => {
      if (stopReason || settled) return;
      stopReason = reason;
      if (!signalChild("SIGTERM")) {
        Object.assign(stopReason, {
          terminationError: "failed to deliver SIGTERM to guarded command process group",
        });
        return;
      }
      forceTimer = setTimeout(() => signalChild("SIGKILL"), TERMINATION_GRACE_MS);
    };
    const measure = async () => {
      const { fixtureKib } = opts.measureUsage
        ? await opts.measureUsage()
        : { fixtureKib: await directorySizeKib(opts.fixtureRoot) };
      peakFixtureKib = Math.max(peakFixtureKib, fixtureKib);
      if (fixtureKib > maxKib) {
        throw new Error(`native reconcile exceeded ${maxKib}KiB guard: fixture=${fixtureKib}KiB`);
      }
    };
    const invocation = [command, ...args].map((value) => JSON.stringify(value)).join(" ");
    const timeoutMs = opts.timeoutMs ?? NATIVE_PNPM_COMMAND_TIMEOUT_MS;
    child.once("spawn", () => {
      timeout = setTimeout(() => {
        stop(new Error(`command exceeded ${timeoutMs}ms: ${invocation}`));
      }, timeoutMs);
      sampler = setInterval(() => {
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
    });
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
        });
        reject(stopReason);
      } else
        resolve({
          status,
          stdout,
          stderr,
          elapsedMs: Date.now() - startedAt,
          peakFixtureKib,
        });
    });
  });
}

export async function directorySizeKib(target: string): Promise<number> {
  const output = await shellOutput("du", ["-sk", target], (candidate) => /^\d+\s/.test(candidate));
  return parseNonnegativeKib(output.split(/\s+/)[0], "du");
}

export type OwnedStorePathSize = { narKib: number; closureKib: number };

export function parseOwnedStorePathSize(output: string, storePath: string): OwnedStorePathSize {
  const parsed = JSON.parse(output) as unknown;
  const record = Array.isArray(parsed)
    ? parsed.find((entry) => String((entry as { path?: unknown }).path || "") === storePath)
    : (parsed as Record<string, unknown>)[storePath];
  const narSize = Number((record as { narSize?: unknown } | undefined)?.narSize);
  const closureSize = Number((record as { closureSize?: unknown } | undefined)?.closureSize);
  if (
    !Number.isSafeInteger(narSize) ||
    narSize < 0 ||
    !Number.isSafeInteger(closureSize) ||
    closureSize < 0
  ) {
    throw new Error(`Nix path-info omitted owned size evidence for ${storePath}`);
  }
  return { narKib: Math.ceil(narSize / 1024), closureKib: Math.ceil(closureSize / 1024) };
}

export function assertOwnedStorePathWithinKib(
  storePath: string,
  size: OwnedStorePathSize,
  maxKib: number,
): void {
  if (size.narKib > maxKib || size.closureKib > maxKib) {
    throw new Error(
      `owned reconciled output exceeded ${maxKib}KiB guard: path=${storePath} nar=${size.narKib}KiB closure=${size.closureKib}KiB`,
    );
  }
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
