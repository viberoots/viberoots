import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { withSanitizedInheritedNixConfig } from "../../lib/nix-config-env";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { installLockKeyForImporter } from "./paths";

const execFileAsync = promisify(execFile);

export type ExactStoreGcRootMode = "read-only" | "reconcile";

export function exactStoreGcRootPath(repoRoot: string, importer: string): string {
  const key = installLockKeyForImporter(importer).replace(/^node-modules:/, "");
  return path.join(repoRoot, ".nix-gcroots", `pnpm-store.${key}`);
}

async function rootTarget(gcRoot: string): Promise<string> {
  try {
    return await fsp.realpath(gcRoot);
  } catch {
    return "";
  }
}

async function removeOwnedStaleRoot(gcRoot: string): Promise<void> {
  const stat = await fsp.lstat(gcRoot).catch(() => null);
  if (!stat) return;
  if (!stat.isSymbolicLink()) {
    throw new Error(`refusing to replace non-symlink exact pnpm store gc root: ${gcRoot}`);
  }
  await fsp.unlink(gcRoot);
}

export function exactStoreGcRootArgs(gcRoot: string, storePath: string): string[] {
  return ["--add-root", gcRoot, "--indirect", "--realise", storePath];
}

export async function ensureExactStoreGcRoot(opts: {
  repoRoot: string;
  importer: string;
  storePath: string;
  mode: ExactStoreGcRootMode;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const gcRoot = exactStoreGcRootPath(opts.repoRoot, opts.importer);
  if ((await rootTarget(gcRoot)) === opts.storePath) return gcRoot;

  const existing = await fsp.lstat(gcRoot).catch(() => null);
  if (existing && opts.mode === "read-only") {
    throw new Error(`exact pnpm store gc root is stale for ${opts.importer}; repair: run u`);
  }
  if (opts.mode === "reconcile") await removeOwnedStaleRoot(gcRoot);

  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  const env = withSanitizedInheritedNixConfig(
    envWithResolvedNixBin({ ...(opts.env || process.env) }),
  );
  const nixStore =
    String(env.VBR_NIX_STORE_BIN || "").trim() || resolveToolPathSync("nix-store", env);
  const result = await execFileAsync(nixStore, exactStoreGcRootArgs(gcRoot, opts.storePath), {
    cwd: opts.repoRoot,
    env,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const realized =
    String(result.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() || "";
  const rooted = await rootTarget(gcRoot);
  if (![opts.storePath, gcRoot].includes(realized) || rooted !== opts.storePath) {
    throw new Error(
      `failed to establish exact pnpm store gc root for ${opts.importer}: expected ${opts.storePath}; realized ${realized || "(empty)"}; rooted ${rooted || "(missing)"}`,
    );
  }
  return gcRoot;
}
