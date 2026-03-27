import process from "node:process";
import { gcWaitConfig, nixGcLockMessage, waitForNoActiveNixGc } from "../../lib/nix-gc-lock.ts";
import { type ManagedCommandActivity, runManagedCommand } from "../../lib/managed-command.ts";

export function extractHash(text: string): string | null {
  const mismatchGot = text.match(/got:\s*(sha256-[A-Za-z0-9+/=\-_]{43,})/);
  if (mismatchGot?.[1]) return mismatchGot[1];
  const all = Array.from(text.matchAll(/sha256-[A-Za-z0-9+/=\-_]{43,}/g)).map((m) => m[0]);
  if (all.length) return all[all.length - 1];
  return null;
}

function resolvedFetchTimeoutSec(): number {
  return Number.parseInt(String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim(), 10) || 600;
}

function envWithFetchTimeout(timeoutSec: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Keep nix-evaluated derivation timeout aligned with managed-process timeout.
    NIX_PNPM_FETCH_TIMEOUT: String(timeoutSec),
  };
}

function nixBuildArgs(opts: {
  flakeRef: string;
  attrPath: string;
  printOutPaths: boolean;
  maxJobs: string;
  cores: string;
}): string[] {
  const args = [
    "build",
    `${opts.flakeRef}#${opts.attrPath}`,
    "--impure",
    "--no-link",
    "--accept-flake-config",
    "--builders",
    "",
    "--option",
    "min-free",
    "0",
    "--option",
    "max-free",
    "0",
  ];
  if (opts.printOutPaths) args.push("--print-out-paths");
  if (opts.maxJobs && opts.maxJobs !== "0") args.push("--max-jobs", opts.maxJobs);
  if (opts.cores && opts.cores !== "0") args.push("--option", "cores", opts.cores);
  return args;
}

export async function buildStore(
  attrPath: string,
  flakeRef: string,
  activity?: ManagedCommandActivity,
): Promise<{ ok: boolean; output: string; outPath?: string }> {
  const gcCfg = gcWaitConfig();
  const gcPids = await waitForNoActiveNixGc({
    timeoutMs: gcCfg.timeoutMs,
    pollMs: gcCfg.pollMs,
  });
  if (gcPids.length > 0) {
    return {
      ok: false,
      output: nixGcLockMessage("update-pnpm-hash buildStore", gcPids),
    };
  }
  const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim() || "0";
  const cores = String(process.env.NIX_CORES || "").trim() || "0";
  const timeoutSec = resolvedFetchTimeoutSec();
  const res = await runManagedCommand({
    command: "nix",
    args: nixBuildArgs({ flakeRef, attrPath, printOutPaths: true, maxJobs, cores }),
    cwd: process.cwd(),
    env: envWithFetchTimeout(timeoutSec),
    timeoutMs: timeoutSec * 1000,
    activity,
  });
  const output = String(res.stdout || "") + String(res.stderr || "");
  if (res.timedOut) {
    return {
      ok: false,
      output:
        output +
        `\nupdate-pnpm-hash: timed out building ${attrPath} after ${timeoutSec}s (descendants terminated)`,
    };
  }
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || undefined;
  return { ok: res.ok, output, outPath };
}

export async function buildUnfixedAndHash(
  attrPath: string,
  flakeRef: string,
  activity?: ManagedCommandActivity,
): Promise<{ ok: boolean; sri?: string; output?: string }> {
  const gcCfg = gcWaitConfig();
  const gcPids = await waitForNoActiveNixGc({
    timeoutMs: gcCfg.timeoutMs,
    pollMs: gcCfg.pollMs,
  });
  if (gcPids.length > 0) {
    return {
      ok: false,
      output: nixGcLockMessage("update-pnpm-hash buildUnfixedAndHash", gcPids),
    };
  }
  const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim() || "0";
  const cores = String(process.env.NIX_CORES || "").trim() || "0";
  const timeoutSec = resolvedFetchTimeoutSec();
  const built = await runManagedCommand({
    command: "nix",
    args: nixBuildArgs({ flakeRef, attrPath, printOutPaths: true, maxJobs, cores }),
    cwd: process.cwd(),
    env: envWithFetchTimeout(timeoutSec),
    timeoutMs: timeoutSec * 1000,
    activity,
  });
  if (!built.ok) {
    const output = String(built.stdout || "") + String(built.stderr || "");
    if (built.timedOut) {
      return {
        ok: false,
        output:
          output +
          `\nupdate-pnpm-hash: timed out building ${attrPath} after ${timeoutSec}s (descendants terminated)`,
      };
    }
    return { ok: false, output };
  }
  const outPath =
    String(built.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath) {
    return { ok: false, output: "nix build returned no out path for " + attrPath };
  }
  const hashed = await runManagedCommand({
    command: "nix",
    args: ["hash", "path", "--sri", outPath],
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 120_000,
  });
  if (!hashed.ok) {
    return {
      ok: false,
      output: String(hashed.stdout || "") + String(hashed.stderr || ""),
    };
  }
  const sri = String(hashed.stdout || "").trim();
  if (!/^sha256-[A-Za-z0-9+/=_-]+$/.test(sri)) {
    return { ok: false, output: "unexpected hash-path output: " + sri };
  }
  return { ok: true, sri };
}

async function currentSystem(): Promise<string> {
  try {
    const res = await $({ stdio: "pipe" })`nix eval --impure --expr builtins.currentSystem`;
    return String(res.stdout || "")
      .trim()
      .replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

export async function flakeAttrExists(
  attrset: string,
  key: string,
  flakeRef: string,
): Promise<boolean> {
  try {
    const sys = await currentSystem();
    if (!sys) return false;
    const out = await $({
      stdio: "pipe",
    })`bash --noprofile --norc -c ${`nix eval --impure ${flakeRef}#packages.${sys}.${attrset} --apply 'builtins.hasAttr "${key}"' --accept-flake-config`}`;
    const val = String(out.stdout || "").trim();
    return val === "true";
  } catch {
    return false;
  }
}
