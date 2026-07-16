import path from "node:path";
import { registerBuckIsolationSync } from "../../../../dev/verify/owned-process-state";
import { stableBuckIsolation } from "../../../../lib/buck-command-env";
import { withGitAutoMaintenanceDisabledEnv } from "../../../../lib/git-auto-maintenance-env";
import { withSanitizedInheritedNixConfig } from "../../../../lib/nix-config-env";
import { ensureWorkspaceProvidersPackage } from "../../../../lib/workspace-providers-package";
import { ensureBuckConfigForTempRepo, ensureWorkspaceRootEnvFile } from "../buck-config";
import { ensureSharedNixTarballCacheRepo } from "../xdg-cache";
import { initTempRepoFromSeedStore } from "../seed-store";
import { rsyncRepoTo } from "../rsync";
import { timeAsync } from "../timing";
import { ensureToolchainPathsForTempRepo } from "../toolchain-paths";
import type { RunInTempOptions, SeededTempSetup, TempAllocation } from "./contracts";
import { LOCAL_FIXTURE_SERVICE_ENV } from "./contracts";
import {
  createTempBuck2Shim,
  createTempNixShim,
  createTempZxWrapperShim,
  prependPath,
} from "./command-shims";
import { activeViberootsRootFromWorkspace, prepareFilteredViberootsInput } from "./filtered-inputs";
import {
  rewriteTempViberootsInput,
  seedStoreViberootsRootIfPresent,
  tempViberootsRootIfPresent,
} from "./flake-rewrite";
import { bootstrapTempGit, commitTempFlakeRewrite } from "./git-bootstrap";
import {
  ensurePnpmfilePlaceholders,
  removeCppReqsIfRequested,
  removeInheritedBuildToolsSymlink,
} from "./seeded-overlays";
import { stableGoModCacheRoot, stableXdgCacheRoot } from "./test-roots";
import { reconcileTempDependencyInputs } from "./dependency-reconcile";

function registerRunInTempBuckIsolation(iso: string, repoRoot: string): void {
  const stateFile = String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (!stateFile || !iso) return;
  const ownerPidRaw = Number(process.env.VBR_VERIFY_OWNER_PID || process.pid);
  const ownerPid = Number.isFinite(ownerPidRaw) && ownerPidRaw > 1 ? ownerPidRaw : process.pid;
  try {
    registerBuckIsolationSync({
      stateFile,
      iso,
      repoRoot: path.resolve(repoRoot),
      ownerPid,
      kind: "run-in-temp-zxtest",
    });
  } catch {}
}

export async function prepareSeededTemp(
  allocation: TempAllocation,
  opts?: RunInTempOptions,
): Promise<SeededTempSetup> {
  const { tmp, home, removeHome, realHome } = allocation;
  const xdgCacheHome = await timeAsync(
    "runInTemp stableXdgCacheRoot",
    async () => await stableXdgCacheRoot(),
  );
  const activeXdgCacheHome = process.env.XDG_CACHE_HOME || xdgCacheHome;
  await timeAsync("runInTemp ensureSharedNixTarballCacheRepo", async () => {
    await ensureSharedNixTarballCacheRepo(activeXdgCacheHome);
  });
  const tempNestedIso = stableBuckIsolation(tmp, "zxtest-shared");
  registerRunInTempBuckIsolation(tempNestedIso, tmp);
  const buck2ShimDir = await timeAsync(
    "runInTemp createTempBuck2Shim",
    async () => await createTempBuck2Shim(tmp, tempNestedIso),
  );
  await timeAsync("runInTemp createTempNixShim", async () => await createTempNixShim(buck2ShimDir));
  await timeAsync(
    "runInTemp createTempZxWrapperShim",
    async () => await createTempZxWrapperShim(buck2ShimDir),
  );
  const tempSetupEnv = withSanitizedInheritedNixConfig(
    withGitAutoMaintenanceDisabledEnv({
      ...process.env,
      WORKSPACE_ROOT: tmp,
      BUCK_TEST_SRC: tmp,
      BUCK_ISOLATION_DIR: tempNestedIso,
      BUCK_NESTED_ISO: tempNestedIso,
      TEST_NO_BROWSER: process.env.TEST_NO_BROWSER || "1",
      [LOCAL_FIXTURE_SERVICE_ENV]: process.env[LOCAL_FIXTURE_SERVICE_ENV] || "1",
      BUCK_EXPORTER_REUSE_DAEMON: process.env.BUCK_EXPORTER_REUSE_DAEMON || "1",
      BUCKD_STARTUP_TIMEOUT: process.env.BUCKD_STARTUP_TIMEOUT || "300",
      BUCKD_STARTUP_INIT_TIMEOUT:
        process.env.BUCKD_STARTUP_INIT_TIMEOUT || process.env.BUCKD_STARTUP_TIMEOUT || "300",
      VBR_RUN_IN_TEMP_REPO: "1",
      SCAF_ALLOW_LIVE_REPO: "1",
      REPO_ROOT: process.cwd(),
      VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT: process.cwd(),
      HOME: home,
      XDG_CACHE_HOME: activeXdgCacheHome,
    }),
  );
  prependPath(tempSetupEnv, buck2ShimDir);
  const goModCacheRoot = await timeAsync(
    "runInTemp stableGoModCacheRoot",
    async () => await stableGoModCacheRoot(),
  );
  const initResult = await timeAsync("runInTemp initTempRepoFromSeedStore", async () => {
    return await initTempRepoFromSeedStore({
      tmpDir: tmp,
      deps: { rsyncRepoTo, timeAsync },
    });
  });
  const seedTouchedRelPaths = [...initResult.touchedRelPaths];
  const activeViberootsRoot = await timeAsync(
    "runInTemp activeViberootsRoot",
    async () => await activeViberootsRootFromWorkspace(),
  );
  const tempViberootsRoot = await timeAsync(
    "runInTemp tempViberootsRoot",
    async () => await tempViberootsRootIfPresent(tmp),
  );
  const seedStoreViberootsRoot = await timeAsync(
    "runInTemp seedStoreViberootsRoot",
    async () => await seedStoreViberootsRootIfPresent(),
  );
  const viberootsSourceRoot = tempViberootsRoot || activeViberootsRoot;
  const viberootsInputSourceRoot =
    seedStoreViberootsRoot || tempViberootsRoot || activeViberootsRoot;
  const viberootsInput = await timeAsync(
    "runInTemp prepareFilteredViberootsInput",
    async () => await prepareFilteredViberootsInput(viberootsInputSourceRoot),
  );
  tempSetupEnv.VIBEROOTS_ROOT = viberootsSourceRoot;
  tempSetupEnv.VIBEROOTS_SOURCE_ROOT = viberootsSourceRoot;
  tempSetupEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput.storePath;
  tempSetupEnv.ZX_INIT = path.join(
    viberootsSourceRoot,
    "build-tools",
    "tools",
    "dev",
    "zx-init.mjs",
  );
  await timeAsync("runInTemp rewriteTempViberootsInput", async () => {
    seedTouchedRelPaths.push(...(await rewriteTempViberootsInput(tmp, viberootsInput)));
  });
  await timeAsync("runInTemp removeInheritedBuildToolsSymlink", async () => {
    seedTouchedRelPaths.push(...(await removeInheritedBuildToolsSymlink(tmp)));
  });
  await timeAsync("runInTemp removeCppReqsIfRequested", async () => {
    seedTouchedRelPaths.push(...(await removeCppReqsIfRequested(tmp)));
  });
  await timeAsync("runInTemp ensurePnpmfilePlaceholders", async () => {
    seedTouchedRelPaths.push(...(await ensurePnpmfilePlaceholders(tmp)));
  });

  const wantGit = opts?.git !== false && process.env.TEST_TEMP_GIT !== "0";
  if (wantGit) {
    await bootstrapTempGit({
      initMode: initResult.mode,
      seedTouchedRelPaths,
      tempSetupEnv,
      tmp,
    });
  }

  const $setup = $({ cwd: tmp, env: tempSetupEnv, stdio: "pipe" });
  await timeAsync("runInTemp ensureBuckConfigForTempRepo", async () => {
    await ensureBuckConfigForTempRepo(tmp, $setup, {
      viberootsInputRoot: viberootsInput.storePath,
      viberootsSourceRoot,
    });
  });
  await timeAsync("runInTemp ensureWorkspaceProvidersPackage", async () => {
    await ensureWorkspaceProvidersPackage(tmp);
  });
  await timeAsync("runInTemp ensureWorkspaceRootEnvFile", async () => {
    await ensureWorkspaceRootEnvFile(tmp, viberootsSourceRoot, viberootsInput.storePath);
  });
  await timeAsync("runInTemp ensureToolchainPathsForTempRepo", async () => {
    await ensureToolchainPathsForTempRepo(tmp, $setup);
  });
  await timeAsync("runInTemp rewriteTempViberootsInput after setup", async () => {
    const touched = await rewriteTempViberootsInput(tmp, viberootsInput);
    if (!wantGit || touched.length === 0) return;
    await commitTempFlakeRewrite({ tempSetupEnv, tmp, touched });
  });

  if (opts?.reconcileDependencyInputs) {
    await timeAsync("runInTemp reconcileTempDependencyInputs", async () => {
      await reconcileTempDependencyInputs(tmp, $setup, viberootsSourceRoot);
    });
  }

  return {
    $setup,
    activeViberootsRoot,
    buck2ShimDir,
    goModCacheRoot,
    home,
    realHome,
    removeHome,
    tempNestedIso,
    tempSetupEnv,
    tmp,
    viberootsInput,
    viberootsSourceRoot,
    xdgCacheHome,
  };
}
