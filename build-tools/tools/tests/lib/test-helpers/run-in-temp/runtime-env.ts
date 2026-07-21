import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCgoToolchainPathsOncePerWorker, getDarwinSdkPathOncePerWorker } from "../cgo-toolchain";
import { ensureZxInitProbedOnce } from "../zx-init-probe";
import { timeAsync } from "../timing";
import { repoNodeBinDirectories } from "../../../../lib/repo-node-bin";
import { withGitAutoMaintenanceDisabledEnv } from "../../../../lib/git-auto-maintenance-env";
import { withSanitizedInheritedNixConfig } from "../../../../lib/nix-config-env";
import type { SeededTempSetup } from "./contracts";
import { LOCAL_FIXTURE_SERVICE_ENV } from "./contracts";
import { applyTempNodePath, prependPath, prependTempRepoBin } from "./command-shims";
import { pinnedCacertPathOncePerWorker, pinnedNixpkgsPathOncePerWorker } from "./nix-support";
import { configureTempPnpmEnv, nixPathHasNixpkgsEntry } from "./seeded-overlays";
import { absoluteXdgCacheHome } from "./test-roots";

export async function buildSeededRuntimeEnv(
  setup: SeededTempSetup,
  envOut: { stdout: string },
): Promise<{ exportEnv: Record<string, string>; tempPnpmStateRoot: string | null }> {
  const {
    activeViberootsRoot,
    buck2ShimDir,
    goModCacheRoot,
    home,
    realHome,
    tempNestedIso,
    tmp,
    viberootsInput,
    viberootsSourceRoot,
    xdgCacheHome,
  } = setup;
  let exportEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") exportEnv[k] = v;
  }
  withSanitizedInheritedNixConfig(exportEnv);
  const allowDevOverrides = String(process.env.TEST_ALLOW_DEV_OVERRIDES || "").trim() === "1";
  if (!allowDevOverrides) {
    // Avoid leaking local dev overrides into temp-repo commands unless explicitly allowed.
    for (const key of [
      "NIX_CPP_DEV_OVERRIDE_JSON",
      "NIX_GO_DEV_OVERRIDE_JSON",
      "NIX_PY_DEV_OVERRIDE_JSON",
    ]) {
      delete exportEnv[key];
    }
  }
  exportEnv.REPO_ROOT = process.cwd();
  exportEnv.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = process.cwd();
  exportEnv.CGO_ENABLED = String(exportEnv.CGO_ENABLED || "").trim() || "0";

  const injected = String((envOut as any).stdout || "");
  for (const entry of injected ? injected.split("\0") : []) {
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx > 0) exportEnv[entry.slice(0, idx)] = entry.slice(idx + 1);
  }

  exportEnv.IN_NIX_SHELL = exportEnv.IN_NIX_SHELL || "1";
  try {
    const wsNodeModules = path.join(process.cwd(), "node_modules");
    const activeViberootsNodeModules = path.join(activeViberootsRoot, "node_modules");
    const viberootsSourceNodeModules = path.join(viberootsSourceRoot, "node_modules");
    const viberootsInputNodeModules = path.join(viberootsInput.storePath, "node_modules");
    applyTempNodePath(exportEnv, [
      wsNodeModules,
      activeViberootsNodeModules,
      viberootsSourceNodeModules,
      viberootsInputNodeModules,
    ]);
    const nodeBinDirs = await repoNodeBinDirectories(process.cwd(), exportEnv);
    for (const binDir of nodeBinDirs.reverse()) {
      if ((await fsp.stat(binDir).catch(() => null))?.isDirectory()) {
        prependPath(exportEnv, binDir);
      }
    }
  } catch {}
  exportEnv.WORKSPACE_ROOT = tmp;
  exportEnv.BUCK_TEST_SRC = tmp;
  exportEnv.VIBEROOTS_ROOT = viberootsSourceRoot;
  exportEnv.VIBEROOTS_SOURCE_ROOT = viberootsSourceRoot;
  exportEnv.VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput.storePath;
  exportEnv.VBR_RUN_IN_TEMP_REPO = "1";
  exportEnv.SCAF_ALLOW_LIVE_REPO = "1";
  exportEnv.BUCK_ISOLATION_DIR = tempNestedIso;
  exportEnv.BUCK_NESTED_ISO = tempNestedIso;
  exportEnv.TEST_NO_BROWSER = exportEnv.TEST_NO_BROWSER || "1";
  exportEnv[LOCAL_FIXTURE_SERVICE_ENV] = exportEnv[LOCAL_FIXTURE_SERVICE_ENV] || "1";
  exportEnv.BUCK_EXPORTER_REUSE_DAEMON = exportEnv.BUCK_EXPORTER_REUSE_DAEMON || "1";
  exportEnv.BUCKD_STARTUP_TIMEOUT = exportEnv.BUCKD_STARTUP_TIMEOUT || "300";
  exportEnv.BUCKD_STARTUP_INIT_TIMEOUT =
    exportEnv.BUCKD_STARTUP_INIT_TIMEOUT || exportEnv.BUCKD_STARTUP_TIMEOUT;
  exportEnv.HOME = home;
  exportEnv.XDG_CACHE_HOME = absoluteXdgCacheHome(exportEnv.XDG_CACHE_HOME, xdgCacheHome);
  if (!exportEnv.BUCK2_REAL_HOME && realHome) {
    exportEnv.BUCK2_REAL_HOME = realHome;
  }
  if (!exportEnv.XDG_CONFIG_HOME) {
    exportEnv.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  }

  exportEnv.GOPROXY = exportEnv.GOPROXY || "https://proxy.golang.org,direct";
  exportEnv.GOSUMDB = exportEnv.GOSUMDB || "sum.golang.org";
  exportEnv.GOMODCACHE = exportEnv.GOMODCACHE || goModCacheRoot;
  try {
    if (!nixPathHasNixpkgsEntry(exportEnv.NIX_PATH || "")) {
      const pinnedNixpkgs = await timeAsync("runInTemp pinnedNixpkgsPath", async () => {
        return await pinnedNixpkgsPathOncePerWorker($);
      });
      if (pinnedNixpkgs) {
        const nixPathEntries = String(exportEnv.NIX_PATH || "")
          .split(":")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .filter((entry) => !entry.startsWith("nixpkgs="));
        exportEnv.NIX_PATH = [`nixpkgs=${pinnedNixpkgs}`, ...nixPathEntries].join(":");
      }
    }
  } catch {}
  if (!exportEnv.SSL_CERT_FILE && exportEnv.NIX_SSL_CERT_FILE) {
    exportEnv.SSL_CERT_FILE = exportEnv.NIX_SSL_CERT_FILE;
  }
  if (!exportEnv.SSL_CERT_FILE) {
    try {
      const pinnedCacert = await timeAsync("runInTemp pinnedCacertPath", async () => {
        return await pinnedCacertPathOncePerWorker($);
      });
      if (pinnedCacert) {
        exportEnv.SSL_CERT_FILE = pinnedCacert;
        exportEnv.NIX_SSL_CERT_FILE = pinnedCacert;
        exportEnv.NODE_EXTRA_CA_CERTS = exportEnv.NODE_EXTRA_CA_CERTS || pinnedCacert;
      }
    } catch {}
  }
  if (!exportEnv.SSL_CERT_FILE) {
    const defaultCert = "/nix/var/nix/profiles/default/etc/ssl/certs/ca-bundle.crt";
    try {
      await fsp.access(defaultCert);
      exportEnv.SSL_CERT_FILE = defaultCert;
    } catch {}
  }
  if (!exportEnv.SSL_CERT_DIR && exportEnv.NIX_SSL_CERT_DIR) {
    exportEnv.SSL_CERT_DIR = exportEnv.NIX_SSL_CERT_DIR;
  }
  exportEnv.DIRENV_LOG_FORMAT = "";
  exportEnv.ZX_INIT = path.join(viberootsSourceRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  prependPath(exportEnv, buck2ShimDir);
  await prependTempRepoBin(exportEnv, tmp);
  prependPath(exportEnv, buck2ShimDir);
  const tempPnpmStateRoot = await configureTempPnpmEnv(exportEnv, tmp, $);

  const nodeOpts = [
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    `--import ${exportEnv.ZX_INIT}`,
  ];
  exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
    .filter(Boolean)
    .join(" ");
  exportEnv = withGitAutoMaintenanceDisabledEnv(exportEnv);

  const needCgo =
    exportEnv.CGO_ENABLED === "1" || String(process.env.TEST_ENABLE_CGO || "").trim() === "1";
  if (needCgo) {
    try {
      const sdk = await getDarwinSdkPathOncePerWorker($);
      const tc = await getCgoToolchainPathsOncePerWorker($);
      if (sdk && process.platform === "darwin") {
        exportEnv.SDKROOT = exportEnv.SDKROOT || sdk;
        const base = `-isysroot ${sdk}`;
        exportEnv.CGO_CPPFLAGS = [base, exportEnv.CGO_CPPFLAGS || ""].filter(Boolean).join(" ");
        exportEnv.CGO_CFLAGS = [base, exportEnv.CGO_CFLAGS || ""].filter(Boolean).join(" ");
        const inc = `${sdk}/usr/include`;
        const lib = `${sdk}/usr/lib`;
        exportEnv.CPATH = [inc, exportEnv.CPATH || ""].filter(Boolean).join(path.delimiter);
        exportEnv.LIBRARY_PATH = [lib, exportEnv.LIBRARY_PATH || ""]
          .filter(Boolean)
          .join(path.delimiter);
        exportEnv.CC = exportEnv.CC || "xcrun --sdk macosx clang";
      }
      if (tc) {
        const isNix = (p: string) => !!p && p.startsWith("/nix/store/");
        if (isNix(tc.clang) && isNix(tc.clangxx)) {
          if (process.platform === "darwin") {
            if (isNix(tc.xcrun)) {
              exportEnv.CC = `${tc.xcrun} --sdk macosx ${tc.clang}`;
              exportEnv.CXX = `${tc.xcrun} --sdk macosx ${tc.clangxx}`;
            }
          } else {
            exportEnv.CC = tc.clang;
            exportEnv.CXX = tc.clangxx;
          }
        }
      }
    } catch {}
  }

  const forceZxProbe = String(process.env.TEST_FORCE_ZX_INIT_PROBE || "").trim() === "1";
  if ((process.env.TEST_NEED_DEV_ENV || "") === "1" || forceZxProbe) {
    await timeAsync("runInTemp ensureZxInitProbedOnce", async () => {
      await ensureZxInitProbedOnce({ tmp, $, exportEnv });
    });
  }

  return { exportEnv, tempPnpmStateRoot };
}
