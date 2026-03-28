import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBuckConfigForTempRepo, ensureWorkspaceRootEnvFile } from "./buck-config";
import { killBuckDaemonsForRepo } from "./buck-kill";
import { ensureBuckReaperStarted } from "./buck-reaper";
import { getCgoToolchainPathsOncePerWorker, getDarwinSdkPathOncePerWorker } from "./cgo-toolchain";
import { rewriteCoverageUrls } from "./coverage";
import { cleanupTempRepoProcesses } from "../../../dev/verify/temp-repo-process-cleanup";
import { rsyncRepoTo } from "./rsync";
import { initTempRepoFromSeedStore } from "./seed-store";
import { shSingleQuote } from "./shell-quote";
import { timeAsync } from "./timing";
import { ensureToolchainPathsForTempRepo } from "./toolchain-paths";
import { mktemp } from "./tmp";
import { ensureSharedNixTarballCacheRepo } from "./xdg-cache";
import "./worker-init";
import { ensureZxInitProbedOnce, zxInitPathFromWorkspace } from "./zx-init-probe";
import {
  pinnedCacertBundleExpr,
  nixEvalTempDirOutsideWorkspace,
  pinnedNixpkgsOutPathExpr,
} from "../../../lib/pinned-nixpkgs.ts";
import { externalPnpmStateDirs } from "../../../lib/pnpm-state-paths.ts";

let cachedDevEnvExport: Promise<string> | null = null;
let cachedPinnedNixpkgsPath: Promise<string> | null = null;
let cachedPinnedCacertPath: Promise<string> | null = null;
let cachedUnifiedPnpmStorePath: Promise<string> | null = null;
let envMutationQueue: Promise<void> = Promise.resolve();
async function withTempProcessEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prevGate = envMutationQueue;
  let releaseGate: (() => void) | null = null;
  envMutationQueue = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  await prevGate;
  const keys = Array.from(new Set(Object.keys(overrides)));
  const prev: Record<string, string | undefined> = {};
  for (const key of keys) prev[key] = process.env[key];
  for (const key of keys) {
    const next = overrides[key];
    if (typeof next === "string") process.env[key] = next;
    else delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const val = prev[key];
      if (typeof val === "string") process.env[key] = val;
      else delete process.env[key];
    }
    releaseGate?.();
  }
}

async function exportDevEnvOncePerWorker($: any): Promise<string> {
  if (cachedDevEnvExport) return await cachedDevEnvExport;
  cachedDevEnvExport = (async () => {
    // Avoid direnv here: it can be slow and re-run per temp repo, while nix develop is deterministic.
    const out = await $({
      cwd: process.cwd(),
      stdio: "pipe",
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
      },
    })`bash --noprofile --norc -c 'if command -v nix >/dev/null 2>&1; then NO_NODE_MODULES_LINK=1 nix develop --accept-flake-config -c env -0; elif command -v direnv >/dev/null 2>&1; then eval "$(direnv export bash)"; env -0; else printf ""; fi'`;
    return String((out as any).stdout || "");
  })();
  return await cachedDevEnvExport;
}

async function pinnedNixpkgsPathOncePerWorker($: any): Promise<string> {
  if (cachedPinnedNixpkgsPath) return await cachedPinnedNixpkgsPath;
  cachedPinnedNixpkgsPath = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await fsp.mkdir(nixEvalTmp, { recursive: true }).catch(() => {});
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
    })`nix eval --impure --accept-flake-config --raw --expr ${pinnedNixpkgsOutPathExpr(path.join(repoRoot, "flake.lock"))}`;
    return String((out as any).stdout || "").trim();
  })();
  return await cachedPinnedNixpkgsPath;
}

async function pinnedCacertPathOncePerWorker($: any): Promise<string> {
  if (cachedPinnedCacertPath) return await cachedPinnedCacertPath;
  cachedPinnedCacertPath = (async () => {
    const repoRoot = process.cwd();
    const nixEvalTmp = nixEvalTempDirOutsideWorkspace(repoRoot);
    await fsp.mkdir(nixEvalTmp, { recursive: true }).catch(() => {});
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
    })`nix eval --impure --accept-flake-config --raw --expr ${pinnedCacertBundleExpr(path.join(repoRoot, "flake.lock"))}`;
    return String((out as any).stdout || "").trim();
  })();
  return await cachedPinnedCacertPath;
}

async function stableTestHomeRoot(): Promise<string> {
  // Keep per-test HOME outside repo-local TMPDIR to avoid flake input churn and rsync/nix races
  // caused by transient tool caches (e.g. pnpm metadata temp files).
  if (process.platform === "win32") return os.tmpdir();
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const root = path.join(base, `bucknix-test-home${suffix}`);
  await fsp.mkdir(root, { recursive: true }).catch(() => {});
  return root;
}

async function stableGoModCacheRoot(): Promise<string> {
  if (process.platform === "win32") return path.join(os.tmpdir(), "bucknix-go-modcache");
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const root = path.join(base, `bucknix-go-modcache${suffix}`);
  await fsp.mkdir(root, { recursive: true }).catch(() => {});
  return root;
}

async function stableXdgCacheRoot(): Promise<string> {
  if (process.platform === "win32") return path.join(os.tmpdir(), "bucknix-xdg-cache");
  const base = "/tmp";
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const root = path.join(base, `bucknix-xdg-cache${suffix}`);
  await fsp.mkdir(root, { recursive: true }).catch(() => {});
  return root;
}

async function removeCppReqsIfRequested(tmp: string): Promise<void> {
  if (String(process.env.TEST_EXCLUDE_CPP_REQS || "").trim() !== "1") return;
  const rels = [
    "build-tools/cpp/defs.bzl",
    "build-tools/cpp/wasm_defs.bzl",
    "build-tools/tools/nix/templates/cpp.nix",
  ];
  for (const rel of rels) {
    try {
      await fsp.rm(path.join(tmp, rel), { force: true });
    } catch {}
  }
}

async function unifiedPnpmStoreFromRepoRoot(repoRoot: string): Promise<string> {
  const pathFile = path.join(repoRoot, "buck-out", ".unified-pnpm-store", "path");
  try {
    const txt = await fsp.readFile(pathFile, "utf8");
    const p = String(txt || "").trim();
    if (!p) return "";
    const st = await fsp.stat(p).catch(() => null);
    if (!st || !st.isDirectory()) return "";
    return p;
  } catch {
    return "";
  }
}

async function ensureUnifiedPnpmStoreOncePerWorker($: any): Promise<string> {
  if (cachedUnifiedPnpmStorePath) return await cachedUnifiedPnpmStorePath;
  cachedUnifiedPnpmStorePath = (async () => {
    const repoRoot = process.cwd();
    const existing = await unifiedPnpmStoreFromRepoRoot(repoRoot);
    if (existing) return existing;
    const out = await $({
      cwd: repoRoot,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        IN_NIX_SHELL: "1",
      },
    })`zx-wrapper build-tools/tools/dev/require-unified-pnpm-store.ts`;
    if ((out as any).exitCode !== 0) {
      throw new Error("runInTemp: failed to build unified pnpm store for temp-repo tests");
    }
    const built = String((out as any).stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (built) return built;
    const resolved = await unifiedPnpmStoreFromRepoRoot(repoRoot);
    if (resolved) return resolved;
    throw new Error("runInTemp: unified pnpm store did not produce a usable store path");
  })();
  return await cachedUnifiedPnpmStorePath;
}

let stableTestHomeOnce: Promise<string> | null = null;
async function stableTestHomeOncePerWorker(): Promise<string> {
  if (stableTestHomeOnce) return await stableTestHomeOnce;
  stableTestHomeOnce = (async () => {
    const homeBase = await stableTestHomeRoot();
    return await fsp.mkdtemp(path.join(homeBase, "home-"));
  })();
  return await stableTestHomeOnce;
}

async function resolveTestHome(): Promise<{ home: string; removeOnExit: boolean }> {
  if (String(process.env.TEST_HOME_PER_TEST || "").trim() === "1") {
    const homeBase = await stableTestHomeRoot();
    const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
    return { home, removeOnExit: true };
  }
  const home = await stableTestHomeOncePerWorker();
  return { home, removeOnExit: false };
}

async function removeTreeWithWritableFallback(target: string, $: any): Promise<void> {
  try {
    await fsp.rm(target, { recursive: true, force: true });
    return;
  } catch {
    // Only pay the recursive chmod cost when deletion actually fails.
    try {
      const q = shSingleQuote(target);
      await $({
        stdio: "ignore",
        cwd: process.cwd(),
        reject: false,
        nothrow: true,
      })`bash --noprofile --norc -c ${`chmod -R u+w ${q} >/dev/null 2>&1 || true`}`;
    } catch {}
    await fsp.rm(target, { recursive: true, force: true }).catch((err) => {
      console.warn("warning: failed to remove temp test dir:", err);
    });
  }
}

export async function runInTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
  opts?: { git?: boolean },
): Promise<T> {
  const realHome = String(process.env.HOME || os.homedir() || "").trim();
  const tmp = await mktemp(name + "-");
  // Optional early signal for tests that need the temp path even if setup is interrupted or slow
  // (e.g. to coordinate out-of-process cleanup/reaping assertions).
  if (String(process.env.TEST_EARLY_TMP_STDOUT || "").trim() === "1") {
    try {
      console.log(`TMP ${tmp}`);
    } catch {}
  }
  const { home, removeOnExit: removeHome } = await resolveTestHome();
  const xdgCacheHome = await stableXdgCacheRoot();
  const activeXdgCacheHome = process.env.XDG_CACHE_HOME || xdgCacheHome;
  await ensureSharedNixTarballCacheRepo(activeXdgCacheHome);
  const tempSetupEnv = {
    ...process.env,
    WORKSPACE_ROOT: tmp,
    BUCK_TEST_SRC: tmp,
    REPO_ROOT: process.cwd(),
    HOME: home,
    XDG_CACHE_HOME: activeXdgCacheHome,
  };
  const goModCacheRoot = await stableGoModCacheRoot();
  const initMode = await initTempRepoFromSeedStore({
    tmpDir: tmp,
    deps: { rsyncRepoTo, timeAsync },
  });
  await removeCppReqsIfRequested(tmp);

  const wantGit = opts?.git !== false && process.env.TEST_TEMP_GIT !== "0";
  if (wantGit) {
    const $tmp = $({ cwd: tmp, stdio: "pipe", env: tempSetupEnv });
    try {
      if (initMode === "rsync") {
        await $tmp`git -c init.defaultBranch=main -c advice.defaultBranchName=false init -q`;
        await $tmp`git add -A`;
        await $tmp`git -c user.name=tmp -c user.email=tmp@example.com commit -q -m init --allow-empty`.nothrow();
      } else {
        const ok = await $tmp`git rev-parse --is-inside-work-tree`.nothrow();
        const inside = String(ok.stdout || "").trim();
        if (inside !== "true") {
          throw new Error(
            `runInTemp: expected seeded temp repo to be a git worktree (mode=${initMode})`,
          );
        }
        const head = await $tmp`git rev-parse HEAD`.nothrow();
        if (head.exitCode !== 0) {
          throw new Error(
            `runInTemp: expected seeded temp repo to have an initial commit (mode=${initMode})`,
          );
        }
      }
    } catch {
      throw new Error("runInTemp: git is required for deterministic temp-repo nix builds");
    }
  }

  const $setup = $({ cwd: tmp, env: tempSetupEnv, stdio: "pipe" });
  await ensureBuckConfigForTempRepo(tmp, $setup);
  await ensureWorkspaceRootEnvFile(tmp);
  await ensureToolchainPathsForTempRepo(tmp, $setup);

  if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
    const chk =
      await $setup`nix build ${`path:${tmp}#buck2-prelude`} --no-link --accept-flake-config --print-build-logs`.nothrow();
    if (chk.exitCode !== 0) {
      throw new Error(
        "dev-shell check failed: nix build path:<tmp>#buck2-prelude did not succeed in temp repo; ensure direnv/dev shell is active",
      );
    }
  }

  let envOut: any = { stdout: "" };
  if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
    envOut = await timeAsync(`devEnvExport(${path.basename(tmp)})`, async () => {
      return { stdout: await exportDevEnvOncePerWorker($) };
    });
  }

  const exportEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") exportEnv[k] = v;
  }
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
    exportEnv.NODE_PATH = [wsNodeModules, exportEnv.NODE_PATH || ""]
      .filter(Boolean)
      .join(path.delimiter);
  } catch {}

  exportEnv.WORKSPACE_ROOT = tmp;
  exportEnv.BUCK_TEST_SRC = tmp;
  exportEnv.HOME = home;
  exportEnv.XDG_CACHE_HOME = exportEnv.XDG_CACHE_HOME || xdgCacheHome;
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
    const pinnedNixpkgs = await pinnedNixpkgsPathOncePerWorker($);
    if (pinnedNixpkgs) {
      const nixPathEntries = String(exportEnv.NIX_PATH || "")
        .split(":")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => !entry.startsWith("nixpkgs="));
      exportEnv.NIX_PATH = [`nixpkgs=${pinnedNixpkgs}`, ...nixPathEntries].join(":");
    }
  } catch {}
  if (!exportEnv.SSL_CERT_FILE && exportEnv.NIX_SSL_CERT_FILE) {
    exportEnv.SSL_CERT_FILE = exportEnv.NIX_SSL_CERT_FILE;
  }
  if (!exportEnv.SSL_CERT_FILE) {
    try {
      const pinnedCacert = await pinnedCacertPathOncePerWorker($);
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
  exportEnv.ZX_INIT = zxInitPathFromWorkspace();
  const wantsUnifiedPnpmStore =
    String(process.env.TEST_DISABLE_UNIFIED_PNPM_STORE || "").trim() !== "1";
  if (wantsUnifiedPnpmStore) {
    const unified = await ensureUnifiedPnpmStoreOncePerWorker($);
    const pnpmState = await externalPnpmStateDirs(tmp);
    exportEnv.LOCAL_PNPM_STORE = exportEnv.LOCAL_PNPM_STORE || unified;
    exportEnv.NIX_USE_PREFETCHED_PNPM_STORE = "1";
    exportEnv.PNPM_HOME = exportEnv.PNPM_HOME || pnpmState.homeDir;
    exportEnv.npm_config_store_dir = exportEnv.npm_config_store_dir || unified;
    exportEnv.NPM_CONFIG_STORE_DIR = exportEnv.NPM_CONFIG_STORE_DIR || unified;
  }

  const nodeOpts = ["--experimental-strip-types", `--import ${exportEnv.ZX_INIT}`];
  exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
    .filter(Boolean)
    .join(" ");

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
    await ensureZxInitProbedOnce({ tmp, $, exportEnv });
  }
  const _$ = $({ cwd: tmp, env: exportEnv });
  await timeAsync("buck-daemon-reaper setup", async () => await ensureBuckReaperStarted(tmp, _$));

  try {
    return await withTempProcessEnv(exportEnv, async () => await fn(tmp, _$));
  } finally {
    await timeAsync("temp process cleanup", async () => {
      await cleanupTempRepoProcesses({ roots: [tmp] }).catch(() => {});
    });
    await timeAsync("buck-daemon cleanup", async () => await killBuckDaemonsForRepo(tmp, _$));
    if ((process.env.TEST_REWRITE_COVERAGE_TMP || "") === "1") {
      await timeAsync(`rewriteCoverageUrls(${path.basename(tmp)})`, async () =>
        rewriteCoverageUrls(tmp).catch(() => {}),
      );
    }
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
