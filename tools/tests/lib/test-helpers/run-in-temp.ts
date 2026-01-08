import "./worker-init";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initTempRepoFromWorkspaceOrSeed } from "../seed-temp-repo";
import { ensureBuckConfigForTempRepo, ensureWorkspaceRootEnvFile } from "./buck-config";
import { ensureBuckReaperStarted } from "./buck-reaper";
import { killBuckDaemonsForRepo } from "./buck-kill";
import { rewriteCoverageUrls } from "./coverage";
import { rsyncRepoTo } from "./rsync";
import { shSingleQuote } from "./shell-quote";
import { timeAsync } from "./timing";
import { mktemp } from "./tmp";
import { getCgoToolchainPathsOncePerWorker, getDarwinSdkPathOncePerWorker } from "./cgo-toolchain";
import { ensureZxInitProbedOnce, zxInitPathFromWorkspace } from "./zx-init-probe";

let cachedDevEnvExport: Promise<string> | null = null;
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

export async function runInTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
  opts?: { git?: boolean },
): Promise<T> {
  const tmp = await mktemp(name + "-");
  const homeBase = await stableTestHomeRoot();
  const home = await fsp.mkdtemp(path.join(homeBase, "home-"));
  const initMode = await initTempRepoFromWorkspaceOrSeed({
    tmpDir: tmp,
    deps: { mktemp, rsyncRepoTo, timeAsync },
  });

  const wantGit = opts?.git !== false && process.env.TEST_TEMP_GIT !== "0";
  if (wantGit) {
    const $tmp = $({ cwd: tmp, stdio: "pipe" });
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

  await ensureBuckConfigForTempRepo(tmp, $);
  await ensureWorkspaceRootEnvFile(tmp);

  if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
    const chk = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build ${`path:${tmp}#buck2-prelude`} --no-link --accept-flake-config --print-build-logs`.nothrow();
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

  exportEnv.GOPROXY = exportEnv.GOPROXY || "https://proxy.golang.org,direct";
  exportEnv.GOSUMDB = exportEnv.GOSUMDB || "sum.golang.org";
  exportEnv.GOMODCACHE = exportEnv.GOMODCACHE || path.join(tmp, ".gomodcache");
  exportEnv.DIRENV_LOG_FORMAT = "";
  exportEnv.ZX_INIT = zxInitPathFromWorkspace();

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

  await ensureZxInitProbedOnce({ tmp, $, exportEnv });
  const _$ = $({ cwd: tmp, env: exportEnv });
  await timeAsync("buck-daemon-reaper setup", async () => await ensureBuckReaperStarted(tmp, _$));

  try {
    return await fn(tmp, _$);
  } finally {
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
      try {
        await $({
          stdio: "ignore",
          cwd: process.cwd(),
          reject: false,
          nothrow: true,
        })`bash --noprofile --norc -c ${`chmod -R u+w ${shSingleQuote(tmp)} ${shSingleQuote(home)} >/dev/null 2>&1 || true`}`;
      } catch {}
      await fsp.rm(tmp, { recursive: true, force: true }).catch((err) => {
        console.warn("warning: failed to remove temp test dir:", err);
      });
    }
    await fsp.rm(home, { recursive: true, force: true }).catch(() => {});
  }
}
