import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { gcWaitConfig, nixGcLockMessage, waitForNoActiveNixGc } from "../../lib/nix-gc-lock";
import { type ManagedCommandActivity, runManagedCommand } from "../../lib/managed-command";
import { localOnlyNixBuilderArgs } from "../../lib/nix-builder-policy";

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

function envWithFetchTimeout(timeoutSec: number, extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Keep nix-evaluated derivation timeout aligned with managed-process timeout.
    NIX_PNPM_FETCH_TIMEOUT: String(timeoutSec),
    NIX_PNPM_INSTALL_TIMEOUT: String(timeoutSec),
    ...(extraEnv || {}),
  };
}

function exactStoreSandboxArgs(extraEnv?: NodeJS.ProcessEnv): string[] {
  const exactStorePath = String(extraEnv?.NIX_PNPM_EXACT_STORE || "").trim();
  if (!exactStorePath) return [];
  if (!exactStorePath.startsWith("/nix/store/")) {
    throw new Error("NIX_PNPM_EXACT_STORE must be a /nix/store path");
  }
  return [];
}

function activeViberootsOverride(): string[] {
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.cwd()).trim();
  const candidates = [
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "",
    workspaceRoot ? path.join(workspaceRoot, "viberoots") : "",
    workspaceRoot ? path.join(workspaceRoot, ".viberoots", "current") : "",
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
  ]
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    if (
      fs.existsSync(path.join(abs, "flake.nix")) &&
      fs.existsSync(path.join(abs, "build-tools", "tools", "dev", "zx-init.mjs"))
    ) {
      return ["--override-input", "viberoots", `path:${abs}`];
    }
  }
  return [];
}

function nixBuildArgs(opts: {
  flakeRef: string;
  attrPath: string;
  printOutPaths: boolean;
  maxJobs: string;
  cores: string;
  extraEnv?: NodeJS.ProcessEnv;
}): string[] {
  const args = [
    "build",
    `${opts.flakeRef}#${opts.attrPath}`,
    "--impure",
    "--no-link",
    "--accept-flake-config",
    ...activeViberootsOverride(),
    ...localOnlyNixBuilderArgs(),
    "--print-build-logs",
    "--option",
    "min-free",
    "0",
    "--option",
    "max-free",
    "0",
  ];
  args.push(...exactStoreSandboxArgs(opts.extraEnv));
  if (opts.printOutPaths) args.push("--print-out-paths");
  if (opts.maxJobs && opts.maxJobs !== "0") args.push("--max-jobs", opts.maxJobs);
  if (opts.cores && opts.cores !== "0") args.push("--option", "cores", opts.cores);
  return args;
}

export async function buildStore(
  attrPath: string,
  flakeRef: string,
  activity?: ManagedCommandActivity,
  extraEnv?: NodeJS.ProcessEnv,
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
  const streamBuildLogs = String(process.env.VBR_STREAM_NIX_BUILD_LOGS || "").trim() === "1";
  console.error(
    `[update-pnpm-hash] nix build ${attrPath} (timeout=${timeoutSec}s, logs=${streamBuildLogs ? "stream" : "compact"})`,
  );
  const res = await runManagedCommand({
    command: "nix",
    args: nixBuildArgs({ flakeRef, attrPath, printOutPaths: true, maxJobs, cores, extraEnv }),
    cwd: process.cwd(),
    env: envWithFetchTimeout(timeoutSec, extraEnv),
    timeoutMs: timeoutSec * 1000,
    activity,
    onStderr: streamBuildLogs ? (chunk) => process.stderr.write(chunk) : undefined,
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
  extraEnv?: NodeJS.ProcessEnv,
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
  const streamBuildLogs = String(process.env.VBR_STREAM_NIX_BUILD_LOGS || "").trim() === "1";
  console.error(
    `[update-pnpm-hash] nix build ${attrPath} and hash result (timeout=${timeoutSec}s, logs=${streamBuildLogs ? "stream" : "compact"})`,
  );
  const built = await runManagedCommand({
    command: "nix",
    args: nixBuildArgs({ flakeRef, attrPath, printOutPaths: true, maxJobs, cores, extraEnv }),
    cwd: process.cwd(),
    env: envWithFetchTimeout(timeoutSec, extraEnv),
    timeoutMs: timeoutSec * 1000,
    activity,
    onStderr: streamBuildLogs ? (chunk) => process.stderr.write(chunk) : undefined,
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
