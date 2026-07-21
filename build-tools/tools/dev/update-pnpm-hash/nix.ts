import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { type ManagedCommandActivity, runManagedCommand } from "../../lib/managed-command";
import {
  activeNixGcPids,
  gcWaitConfig,
  nixGcLockMessage,
  waitForNoActiveNixGc,
} from "../../lib/nix-gc-lock";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { runCommand } from "../filtered-flake-command";
import {
  cleanupChangedOwnedInvalidPnpmStores,
  snapshotOwnedInvalidPnpmStores,
} from "./invalid-store-cleanup";
import { isCanonicalSha256SRI } from "../../lib/nix-sri";
import { localOnlyNixBuilderArgs } from "../../lib/nix-builder-policy";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";

export function extractHash(
  text: string,
  expectedDerivationName: string,
  expectedSpecifiedHash: string,
): string | null {
  if (!/^pnpm-store-lock-[a-f0-9]{64}$/.test(expectedDerivationName)) return null;
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(expectedSpecifiedHash)) return null;
  const headers = Array.from(
    text.matchAll(/^error: hash mismatch in fixed-output derivation '([^']+)':\s*$/gm),
  );
  const matches: string[] = [];
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    const drvPath = header[1];
    if (
      !new RegExp(`^[a-z0-9]{32}-${expectedDerivationName}\\.drv$`).test(path.basename(drvPath))
    ) {
      continue;
    }
    const start = (header.index || 0) + header[0].length;
    const remainder = text.slice(start);
    const nextError = remainder.search(/^error:/m);
    const block = nextError === -1 ? remainder : remainder.slice(0, nextError);
    const specified = Array.from(
      block.matchAll(/^\s*specified:\s*(sha256-[A-Za-z0-9+/]{43}=)\s*$/gm),
    );
    const got = Array.from(block.matchAll(/^\s*got:\s*(sha256-[A-Za-z0-9+/]{43}=)\s*$/gm));
    if (specified.length === 1 && specified[0][1] === expectedSpecifiedHash && got.length === 1) {
      matches.push(got[0][1]);
    }
  }
  const escapedName = expectedDerivationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerEvidence = new Map<string, string>();
  for (const marker of text.matchAll(
    new RegExp(
      `^(?:(?:pnpm-store-lock|${escapedName})> )?viberoots-pnpm-fod-hash-mismatch-v1 output=(/nix/store/[a-z0-9]{32}-${escapedName}) specified=(sha256-[A-Za-z0-9+/]{43}=) got=(sha256-[A-Za-z0-9+/]{43}=)\\s*$`,
      "gm",
    ),
  )) {
    if (marker[2] !== expectedSpecifiedHash) continue;
    markerEvidence.set(`${marker[1]}\0${marker[2]}\0${marker[3]}`, marker[3]);
  }
  if (markerEvidence.size > 1) return null;
  if (markerEvidence.size === 1) matches.push(markerEvidence.values().next().value as string);
  return matches.length === 1 ? matches[0] : null;
}

function resolvedFetchTimeoutSec(): number {
  return Number.parseInt(String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600").trim(), 10) || 600;
}

function envWithFetchTimeout(timeoutSec: number, extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return withSanitizedInheritedNixConfig(
    envWithResolvedNixBin({
      ...process.env,
      // Keep nix-evaluated derivation timeout aligned with managed-process timeout.
      NIX_PNPM_FETCH_TIMEOUT: String(timeoutSec),
      NIX_PNPM_INSTALL_TIMEOUT: String(timeoutSec),
      ...(extraEnv || {}),
    }),
  );
}

function validViberootsSource(candidate: string): string {
  const abs = path.resolve(candidate);
  const real = fs.existsSync(abs) ? fs.realpathSync.native(abs) : abs;
  if (
    fs.existsSync(path.join(abs, "flake.nix")) &&
    fs.existsSync(path.join(abs, "build-tools", "tools", "dev", "zx-init.mjs"))
  ) {
    return real;
  }
  return "";
}

function flakeDirFromRef(flakeRef: string): string {
  const withoutAttr = flakeRef.replace(/#.*$/, "");
  if (!withoutAttr.startsWith("path:")) return "";
  const [rawPath, query = ""] = withoutAttr.slice("path:".length).split("?", 2);
  const root = path.resolve(decodeURIComponent(rawPath || ""));
  const dir = new URLSearchParams(query).get("dir") || "";
  if (!dir) return root;
  if (path.posix.isAbsolute(dir) || dir.includes("\\") || dir.split("/").includes("..")) return "";
  const resolved = path.resolve(root, ...dir.split("/"));
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : "";
}

export function immutableViberootsInputFromFlakeFiles(flakeText: string, lockText: string): string {
  const match = flakeText.match(/\bviberoots\.url\s*=\s*"path:([^"]+)"/);
  const inputPath = String(match?.[1] || "");
  if (!path.isAbsolute(inputPath)) return "";
  if (!/^\/nix\/store\/[a-z0-9]{32}-source$/.test(inputPath)) {
    throw new Error(`invalid absolute viberoots flake input: ${inputPath}`);
  }
  let lock: any;
  try {
    lock = JSON.parse(lockText);
  } catch {
    throw new Error("invalid flake.lock for immutable viberoots input");
  }
  const inputName = lock?.nodes?.root?.inputs?.viberoots || "viberoots";
  const node = lock?.nodes?.[inputName];
  const locked = node?.locked;
  const original = node?.original;
  if (
    locked?.type !== "path" ||
    locked?.path !== inputPath ||
    !isCanonicalSha256SRI(locked?.narHash) ||
    original?.type !== "path" ||
    original?.path !== inputPath
  ) {
    throw new Error(`flake.lock does not match immutable viberoots input: ${inputPath}`);
  }
  return inputPath;
}

function flakeLocalViberootsSource(flakeRef: string): string {
  const flakeDir = flakeDirFromRef(flakeRef);
  if (!flakeDir) return "";
  const flakeFile = path.join(flakeDir, "flake.nix");
  let text = "";
  try {
    text = fs.readFileSync(flakeFile, "utf8");
  } catch {
    return "";
  }
  const lockText = (() => {
    try {
      return fs.readFileSync(path.join(flakeDir, "flake.lock"), "utf8");
    } catch {
      return "";
    }
  })();
  const immutableInput = immutableViberootsInputFromFlakeFiles(text, lockText);
  if (immutableInput) {
    return fs.existsSync(path.join(immutableInput, "flake.nix")) ? immutableInput : "";
  }
  const match = text.match(/\bviberoots\.url\s*=\s*"path:([^"]+)"/);
  const inputPath = String(match?.[1] || "");
  if (!inputPath) return "";
  const resolved = path.resolve(flakeDir, inputPath);
  if (!inputPath.startsWith(".")) return "";
  return validViberootsSource(resolved);
}

export function activeViberootsOverride(
  flakeRef: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (flakeLocalViberootsSource(flakeRef)) return [];
  const candidate = String(env.VIBEROOTS_FLAKE_INPUT_ROOT || "").trim();
  const real = candidate ? validViberootsSource(candidate) : "";
  if (!real || !/^\/nix\/store\/[a-z0-9]{32}-source$/.test(real)) {
    throw new Error(
      "update-pnpm-hash requires an immutable Nix-store viberoots flake-input authority",
    );
  }
  return ["--override-input", "viberoots", `path:${real}`];
}

export function nixBuildArgs(opts: {
  flakeRef: string;
  attrPath: string;
  printOutPaths: boolean;
  maxJobs: string;
  cores: string;
  extraEnv?: NodeJS.ProcessEnv;
  rebuild?: boolean;
}): string[] {
  const args = [
    "build",
    `${opts.flakeRef}#${opts.attrPath}`,
    "--no-link",
    "--no-write-lock-file",
    "--accept-flake-config",
    ...activeViberootsOverride(opts.flakeRef, opts.extraEnv),
    ...localOnlyNixBuilderArgs(),
    "--print-build-logs",
    "--option",
    "min-free",
    "0",
    "--option",
    "max-free",
    "0",
    "--option",
    "keep-failed",
    "false",
  ];
  if (
    String(opts.extraEnv?.NIX_PNPM_ALLOW_GENERATE || "").trim() === "1" ||
    String(opts.extraEnv?.NIX_PNPM_RECONCILE || "").trim() === "1" ||
    String(opts.extraEnv?.NIX_PNPM_MATERIALIZE || "").trim() === "1"
  ) {
    args.splice(2, 0, "--impure");
  }
  if (opts.rebuild) args.push("--rebuild");
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
  opts: { rebuild?: boolean; ownedDerivationName?: string } = {},
): Promise<{ ok: boolean; output: string; outPath?: string; interrupted?: boolean }> {
  const maxJobs = String(process.env.NIX_MAX_JOBS || "").trim() || "0";
  const cores = String(process.env.NIX_CORES || "").trim() || "0";
  const timeoutSec = resolvedFetchTimeoutSec();
  const streamBuildLogs = String(process.env.VBR_STREAM_NIX_BUILD_LOGS || "").trim() === "1";
  const commandEnv = envWithFetchTimeout(timeoutSec, extraEnv);
  const invalidBefore = opts.ownedDerivationName
    ? await snapshotOwnedInvalidPnpmStores({
        derivationName: opts.ownedDerivationName,
        env: commandEnv,
      })
    : null;
  const nixBin = resolveToolPathSync("nix", commandEnv);
  console.error(
    `[update-pnpm-hash] nix build ${attrPath} (timeout=${timeoutSec}s, logs=${streamBuildLogs ? "stream" : "compact"})`,
  );
  const res = await runManagedCommand({
    command: nixBin,
    args: nixBuildArgs({
      flakeRef,
      attrPath,
      printOutPaths: true,
      maxJobs,
      cores,
      extraEnv: commandEnv,
      rebuild: opts.rebuild,
    }),
    cwd: process.cwd(),
    env: commandEnv,
    timeoutMs: timeoutSec * 1000,
    activity,
    onStderr: streamBuildLogs ? (chunk) => process.stderr.write(chunk) : undefined,
  });
  const output = String(res.stdout || "") + String(res.stderr || "");
  let cleanupOutput = "";
  if (!res.ok && invalidBefore && opts.ownedDerivationName) {
    try {
      const deleted = await cleanupChangedOwnedInvalidPnpmStores({
        derivationName: opts.ownedDerivationName,
        before: invalidBefore,
        env: commandEnv,
      });
      if (deleted.length > 0)
        cleanupOutput = `\nremoved failed-build invalid output: ${deleted.join(", ")}`;
    } catch (error) {
      cleanupOutput = `\nfailed-build invalid-output cleanup failed: ${String(error)}`;
    }
  }
  const expectedHashMismatch = output.includes("viberoots-pnpm-fod-hash-mismatch-v1");
  if (!res.ok && !res.interrupted && !res.timedOut && !expectedHashMismatch) {
    const gcPids = await activeNixGcPids();
    if (gcPids.length > 0) {
      const gcCfg = gcWaitConfig();
      const remaining = await waitForNoActiveNixGc({
        timeoutMs: gcCfg.timeoutMs,
        pollMs: gcCfg.pollMs,
      });
      if (remaining.length > 0) {
        return {
          ok: false,
          output:
            output +
            cleanupOutput +
            "\n" +
            nixGcLockMessage("update-pnpm-hash buildStore", remaining),
          interrupted: res.interrupted || res.timedOut,
        };
      }
      return await buildStore(attrPath, flakeRef, activity, extraEnv, opts);
    }
  }
  if (res.timedOut) {
    return {
      ok: false,
      output:
        output +
        cleanupOutput +
        `\nupdate-pnpm-hash: timed out building ${attrPath} after ${timeoutSec}s (descendants terminated)`,
      interrupted: true,
    };
  }
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || undefined;
  return { ok: res.ok, output: output + cleanupOutput, outPath, interrupted: res.interrupted };
}

async function currentSystem(): Promise<string> {
  try {
    const nixEnv = withSanitizedInheritedNixConfig(envWithResolvedNixBin(process.env));
    const nixBin = resolveToolPathSync("nix", nixEnv);
    const res = await runCommand({
      command: nixBin,
      args: ["eval", "--impure", "--expr", "builtins.currentSystem"],
      env: nixEnv,
    });
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
    const nixEnv = withSanitizedInheritedNixConfig(envWithResolvedNixBin(process.env));
    const nixBin = resolveToolPathSync("nix", nixEnv);
    const out = await runCommand({
      command: nixBin,
      args: [
        "eval",
        "--impure",
        ...activeViberootsOverride(flakeRef, nixEnv),
        `${flakeRef}#packages.${sys}.${attrset}`,
        "--apply",
        `builtins.hasAttr "${key}"`,
        "--accept-flake-config",
      ],
      env: nixEnv,
    });
    const val = String(out.stdout || "").trim();
    return val === "true";
  } catch {
    return false;
  }
}
