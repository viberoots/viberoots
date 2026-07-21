import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withGitAutoMaintenanceDisabledEnv } from "../../../../lib/git-auto-maintenance-env";
import { withSanitizedInheritedNixConfig } from "../../../../lib/nix-config-env";
import { removeTreeWithWritableFallback } from "../remove-tree";
import { timeAsync } from "../timing";
import type { RunInTempCallback, TempAllocation } from "./contracts";
import { LOCAL_FIXTURE_SERVICE_ENV } from "./contracts";
import { applyTempNodePath, prependTempRepoBin } from "./command-shims";
import { activeViberootsRootFromWorkspace, prepareFilteredViberootsInput } from "./filtered-inputs";
import { rewriteTempViberootsInput } from "./flake-rewrite";
import { withTempProcessEnv } from "./process-env";
import { absoluteXdgCacheHome, stableXdgCacheRoot } from "./test-roots";

export async function runScratchTemp<T>(
  allocation: TempAllocation,
  fn: RunInTempCallback<T>,
): Promise<T> {
  const { home, realHome, removeHome, tmp } = allocation;
  const xdgCacheHome = await timeAsync(
    "runInTemp stableXdgCacheRoot",
    async () => await stableXdgCacheRoot(),
  );
  const activeViberootsRoot = await timeAsync(
    "runInTemp activeViberootsRoot",
    async () => await activeViberootsRootFromWorkspace(),
  );
  const viberootsInput = await timeAsync(
    "runInTemp prepareFilteredViberootsInput",
    async () => await prepareFilteredViberootsInput(activeViberootsRoot),
  );
  let exportEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") exportEnv[k] = v;
  }
  exportEnv.WORKSPACE_ROOT = tmp;
  exportEnv.BUCK_TEST_SRC = tmp;
  exportEnv.REPO_ROOT = tmp;
  exportEnv.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = process.cwd();
  exportEnv.VBR_RUN_IN_TEMP_REPO = "1";
  exportEnv.SCAF_ALLOW_LIVE_REPO = "1";
  exportEnv.VIBEROOTS_ROOT = activeViberootsRoot;
  exportEnv.VIBEROOTS_SOURCE_ROOT = activeViberootsRoot;
  exportEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput.storePath;
  exportEnv.TEST_NO_BROWSER = exportEnv.TEST_NO_BROWSER || "1";
  exportEnv[LOCAL_FIXTURE_SERVICE_ENV] = exportEnv[LOCAL_FIXTURE_SERVICE_ENV] || "1";
  exportEnv.HOME = home;
  exportEnv.XDG_CACHE_HOME = absoluteXdgCacheHome(exportEnv.XDG_CACHE_HOME, xdgCacheHome);
  if (!exportEnv.BUCK2_REAL_HOME && realHome) {
    exportEnv.BUCK2_REAL_HOME = realHome;
  }
  if (!exportEnv.XDG_CONFIG_HOME) {
    exportEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  }
  exportEnv.ZX_INIT = path.join(activeViberootsRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  await rewriteTempViberootsInput(tmp, viberootsInput);
  await prependTempRepoBin(exportEnv, tmp);
  applyTempNodePath(exportEnv, [
    path.join(process.cwd(), "node_modules"),
    path.join(activeViberootsRoot, "node_modules"),
  ]);
  withSanitizedInheritedNixConfig(exportEnv);
  const nodeOpts = [
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    `--import ${exportEnv.ZX_INIT}`,
  ];
  exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
    .filter(Boolean)
    .join(" ");
  exportEnv = withGitAutoMaintenanceDisabledEnv(exportEnv);
  const _$ = $({ cwd: tmp, env: exportEnv });
  try {
    return await timeAsync("runInTemp testBody", async () => {
      return await withTempProcessEnv(exportEnv, async () => await fn(tmp, _$));
    });
  } finally {
    if (process.env.TEST_KEEP_TMP === "1") {
      try {
        console.error(`KEEP_TMP ${tmp}`);
        await fsp
          .appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8")
          .catch(() => {});
      } catch {}
    } else {
      await removeTreeWithWritableFallback(tmp, $);
    }
    if (removeHome) {
      await removeTreeWithWritableFallback(home, $);
    }
  }
}
