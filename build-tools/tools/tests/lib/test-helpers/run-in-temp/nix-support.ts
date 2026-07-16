import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../../../../lib/macos-metadata";
import { pathExists } from "../../../../lib/repo";
import { withSanitizedInheritedNixConfig } from "../../../../lib/nix-config-env";
import { resolveFinalPnpmStore } from "../../../../dev/update-pnpm-hash/realized-store";
import {
  pinnedCacertBundleExpr,
  nixEvalTempDirOutsideWorkspace,
  pinnedNixpkgsOutPathExpr,
} from "../../../../lib/pinned-nixpkgs";
import type { MaterializedPathInput } from "../../../../dev/filtered-flake-viberoots-input";
import { workspaceFlakeLockPath, workspaceFlakeRef } from "./filtered-inputs";

let cachedPinnedNixpkgsPath: Promise<string> | null = null;
let cachedPinnedCacertPath: Promise<string> | null = null;
export function transientNixStoreError(output: unknown): boolean {
  const text = String(output || "");
  return /path '\/nix\/store\/[^']+' is not valid/.test(text) || /database is locked/.test(text);
}

type TempViberootsRoles = {
  commandSourceRoot: string;
  consumerSnapshotRoot: string;
  flakeInput: MaterializedPathInput;
};

export async function exportDevEnvWithRetry($: any, roles: TempViberootsRoles): Promise<string> {
  const consumerFlakeRoot = await workspaceFlakeRef(roles.consumerSnapshotRoot);
  const filteredSnapshotEnv = {
    ...process.env,
    WORKSPACE_ROOT: roles.consumerSnapshotRoot,
    BUCK_TEST_SRC: roles.consumerSnapshotRoot,
    VBR_FILTERED_FLAKE_SNAPSHOT: "1",
    VBR_PNPM_FILTERED_SNAPSHOT_ROOT: roles.consumerSnapshotRoot,
  };
  const hasRootImporter = await pathExists(path.join(roles.consumerSnapshotRoot, "pnpm-lock.yaml"));
  const fixedStore = hasRootImporter
    ? await resolveFinalPnpmStore({
        repoRoot: roles.commandSourceRoot,
        importer: ".",
        flakeRef: `path:${consumerFlakeRoot}`,
        attrPath: "pnpm-store",
        env: filteredSnapshotEnv,
      })
    : { cleanup: async () => {} };
  const runOnce = async () => {
    // Avoid direnv here: it can be slow and re-run per temp repo, while nix develop is deterministic.
    const nixOut = await $({
      cwd: roles.consumerSnapshotRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: withSanitizedInheritedNixConfig({
        ...filteredSnapshotEnv,
        IN_NIX_SHELL: "1",
        VIBEROOTS_ROOT: roles.commandSourceRoot,
        VIBEROOTS_SOURCE_ROOT: roles.commandSourceRoot,
        VIBEROOTS_FLAKE_INPUT_ROOT: roles.flakeInput.storePath,
      }),
    })`nix develop ${`path:${consumerFlakeRoot}`} --no-write-lock-file --accept-flake-config -c env -0`;
    return nixOut;
  };
  try {
    let out = await runOnce();
    if (
      Number(out.exitCode || 0) !== 0 &&
      transientNixStoreError(`${out.stdout || ""}\n${out.stderr || ""}`)
    ) {
      console.error("[runInTemp] transient nix store error while exporting dev env; retrying once");
      await new Promise((resolve) => setTimeout(resolve, 750));
      out = await runOnce();
    }
    if (Number(out.exitCode || 0) !== 0) {
      throw new Error(
        String(out.stderr || out.stdout || "nix develop failed while exporting dev env"),
      );
    }
    return String((out as any).stdout || "");
  } finally {
    await fixedStore.cleanup();
  }
}

export async function retryTransientNixStoreFailure<T>(
  label: string,
  runOnce: () => Promise<T>,
  outputFor: (result: T) => unknown,
  failed: (result: T) => boolean,
): Promise<T> {
  let out = await runOnce();
  if (failed(out) && transientNixStoreError(outputFor(out))) {
    console.error(`[runInTemp] transient nix store error while ${label}; retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    out = await runOnce();
  }
  return out;
}

export async function pinnedNixpkgsPathOncePerWorker($: any): Promise<string> {
  if (cachedPinnedNixpkgsPath) return await cachedPinnedNixpkgsPath;
  cachedPinnedNixpkgsPath = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await mkdirWithMacosMetadataExclusion(nixEvalTmp).catch(() => {});
    const lockPath = await workspaceFlakeLockPath(repoRoot);
    const out = await $({
      cwd: repoRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
        TMPDIR: nixEvalTmp,
      },
    })`nix eval --impure --accept-flake-config --raw --expr ${pinnedNixpkgsOutPathExpr(lockPath)}`;
    return String((out as any).stdout || "").trim();
  })();
  return await cachedPinnedNixpkgsPath;
}

export async function pinnedCacertPathOncePerWorker($: any): Promise<string> {
  if (cachedPinnedCacertPath) return await cachedPinnedCacertPath;
  cachedPinnedCacertPath = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await mkdirWithMacosMetadataExclusion(nixEvalTmp).catch(() => {});
    const lockPath = await workspaceFlakeLockPath(repoRoot);
    const out = await $({
      cwd: repoRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
        TMPDIR: nixEvalTmp,
      },
    })`nix eval --impure --accept-flake-config --raw --expr ${pinnedCacertBundleExpr(lockPath)}`;
    return String((out as any).stdout || "").trim();
  })();
  return await cachedPinnedCacertPath;
}
