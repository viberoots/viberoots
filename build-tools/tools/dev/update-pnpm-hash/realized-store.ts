import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { committedFinalStore } from "./exact-store";
import { sha256File } from "./verified-marker";

const execFileAsync = promisify(execFile);
const REALIZED_FINAL_STORE_PROBE_TIMEOUT_MS = 30_000;

function finalStoreProbeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = withSanitizedInheritedNixConfig(envWithResolvedNixBin({ ...baseEnv }));
  for (const key of [
    "NIX_PNPM_ALLOW_GENERATE",
    "NIX_PNPM_RECONCILE",
    "NIX_PNPM_EXACT_STORE",
    "NIX_PNPM_EXACT_STORE_INDEX",
    "NIX_PNPM_EXACT_STORE_LOCK_HASH",
  ]) {
    delete env[key];
  }
  return env;
}

function commandOutput(stdout: string): string {
  return (
    String(stdout || "")
      .trim()
      .split(/\s+/)
      .pop() || ""
  );
}

function resolveNixStoreBin(env: NodeJS.ProcessEnv): string {
  return String(env.VBR_NIX_STORE_BIN || "").trim() || resolveToolPathSync("nix-store", env);
}

function filteredSnapshotEvalArgs(env: NodeJS.ProcessEnv, flakeRef: string): string[] {
  const markedRoot = String(env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT || "").trim();
  const workspaceRoot = String(env.WORKSPACE_ROOT || "").trim();
  const flakePath = flakeRef.startsWith("path:") ? flakeRef.slice("path:".length) : "";
  if (!markedRoot || !workspaceRoot || !flakePath) return [];
  const root = path.resolve(markedRoot);
  if (path.resolve(workspaceRoot) !== root) return [];
  const flakeDir = path.resolve(flakePath);
  return flakeDir === root || flakeDir.startsWith(`${root}${path.sep}`) ? ["--impure"] : [];
}

export type FinalPnpmStoreInspection =
  | { status: "realized"; path: string }
  | { status: "absent"; path: string }
  | { status: "invalid"; path: string };

export async function checkLiteralStorePathValidity(opts: {
  repoRoot: string;
  storePath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<"valid" | "invalid"> {
  const env = opts.env || finalStoreProbeEnv();
  const nixStoreBin = resolveNixStoreBin(env);
  const invalid = String(
    (
      await execFileAsync(nixStoreBin, ["--check-validity", "--print-invalid", opts.storePath], {
        cwd: opts.repoRoot,
        env,
        timeout: REALIZED_FINAL_STORE_PROBE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout || "",
  ).trim();
  if (invalid === "") return "valid";
  if (invalid === opts.storePath) return "invalid";
  throw new Error(
    `nix-store validity check returned unexpected output: ${invalid}; expected ${opts.storePath}`,
  );
}

export async function inspectFinalPnpmStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  expectedPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FinalPnpmStoreInspection> {
  const env = finalStoreProbeEnv(opts.env);
  const nixBin = resolveToolPathSync("nix", env);
  const flakeRef = opts.flakeRef.split("#", 1)[0] || opts.flakeRef;
  const evaluated = commandOutput(
    (
      await execFileAsync(
        nixBin,
        [
          "eval",
          ...filteredSnapshotEvalArgs(env, flakeRef),
          "--raw",
          "--no-write-lock-file",
          "--accept-flake-config",
          `${flakeRef}#${opts.attrPath}.outPath`,
        ],
        {
          cwd: opts.repoRoot,
          env,
          timeout: REALIZED_FINAL_STORE_PROBE_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        },
      )
    ).stdout,
  );
  if (!/^\/nix\/store\/[A-Za-z0-9._+?=-]+$/.test(evaluated)) {
    throw new Error(
      `nix eval returned an invalid final pnpm store path: ${evaluated || "(empty)"}`,
    );
  }
  if (evaluated !== opts.expectedPath) {
    throw new Error(
      `evaluated final pnpm store path does not match committed metadata for ${opts.importer}: ${evaluated}; expected ${opts.expectedPath}`,
    );
  }
  if (!fs.existsSync(evaluated)) {
    return { status: "absent", path: evaluated };
  }
  if (
    (await checkLiteralStorePathValidity({
      repoRoot: opts.repoRoot,
      storePath: evaluated,
      env,
    })) === "invalid"
  ) {
    return { status: "invalid", path: evaluated };
  }
  const validated = commandOutput(
    (
      await execFileAsync(nixBin, ["path-info", evaluated], {
        cwd: opts.repoRoot,
        env,
        timeout: REALIZED_FINAL_STORE_PROBE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout,
  );
  if (validated !== evaluated) {
    throw new Error(
      `nix path-info returned an unexpected final pnpm store path: ${validated || "(empty)"}; expected ${evaluated}`,
    );
  }
  return { status: "realized", path: evaluated };
}

export async function probeRealizedFinalPnpmStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  expectedPath: string;
}): Promise<string> {
  const inspected = await inspectFinalPnpmStore(opts);
  if (inspected.status !== "realized") {
    throw new Error(
      `final pnpm store is not realized for ${opts.importer}: ${inspected.path}\nno tracked files were modified\nrepair: run u`,
    );
  }
  return inspected.path;
}

export async function inspectCommittedFinalPnpmStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<FinalPnpmStoreInspection> {
  const committed = await committedFinalStore({
    repoRoot: opts.repoRoot,
    importer: opts.importer,
    lockHash: await sha256File(path.resolve(opts.repoRoot, opts.importer, "pnpm-lock.yaml")),
    timeoutMs: REALIZED_FINAL_STORE_PROBE_TIMEOUT_MS,
  });
  return await inspectFinalPnpmStore({ ...opts, expectedPath: committed.expectedPath });
}

export async function resolveFinalPnpmStore(opts: {
  repoRoot: string;
  importer: string;
  flakeRef: string;
  attrPath: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ fixedStorePath: string; cleanup: () => Promise<void> }> {
  const inspected = await inspectCommittedFinalPnpmStore(opts);
  if (inspected.status !== "realized") {
    throw new Error(
      `final pnpm store is not realized for ${opts.importer}: ${inspected.path}\nno tracked files were modified\nrepair: run u`,
    );
  }
  return { fixedStorePath: inspected.path, cleanup: async () => {} };
}

export async function withResolvedFinalPnpmStore<T>(
  opts: { repoRoot: string; importer: string; flakeRef: string; attrPath: string },
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const resolved = await resolveFinalPnpmStore(opts);
  try {
    return await fn(finalStoreProbeEnv());
  } finally {
    await resolved.cleanup();
  }
}
