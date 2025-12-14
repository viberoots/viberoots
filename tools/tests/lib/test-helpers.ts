#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
// Ensure zx globals are available in node:test workers by importing workspace zx-init
try {
  const zxInit = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");
  const href = pathToFileURL(zxInit).href;
  await import(href);
} catch {}

const ENABLE_TIMING = process.env.TEST_TIMING === "1";
function logTiming(label: string, ms: number) {
  if (!ENABLE_TIMING) return;
  try {
    console.error(`[timing] ${label}: ${ms.toFixed(1)}ms`);
  } catch {}
}
async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    logTiming(label, performance.now() - t0);
  }
}

async function rewriteCoverageUrls(tmpRoot: string) {
  try {
    const repoRoot = process.cwd();
    const covDir = path.join(repoRoot, "coverage", "raw");
    const files = await fsp.readdir(covDir).catch(() => [] as string[]);
    const fromPrefix1 = "file://" + tmpRoot; // e.g., file:///var/folders/...
    const fromPrefix2 = tmpRoot.startsWith("/") ? "file:///" + tmpRoot.slice(1) : fromPrefix1;
    // macOS sometimes resolves via /private/var/... — handle that alias too
    const privateTmp = tmpRoot.startsWith("/var/") ? "/private" + tmpRoot : tmpRoot;
    const fromPrefix3 = "file://" + privateTmp;
    const fromPrefix4 = privateTmp.startsWith("/") ? "file:///" + privateTmp.slice(1) : fromPrefix3;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(covDir, f);
      let txt = await fsp.readFile(p, "utf8").catch(() => "");
      if (!txt || (!txt.includes(fromPrefix1) && !txt.includes(fromPrefix2))) continue;
      let json: any;
      try {
        json = JSON.parse(txt);
      } catch {
        continue;
      }
      const toPrefix = "file://" + repoRoot;
      const rewriter = (u: string) =>
        u.startsWith(fromPrefix1)
          ? toPrefix + u.slice(fromPrefix1.length)
          : u.startsWith(fromPrefix2)
            ? toPrefix + u.slice(fromPrefix2.length)
            : u.startsWith(fromPrefix3)
              ? toPrefix + u.slice(fromPrefix3.length)
              : u.startsWith(fromPrefix4)
                ? toPrefix + u.slice(fromPrefix4.length)
                : u;
      // Rewrite result[].url
      if (Array.isArray(json.result)) {
        for (const e of json.result) {
          if (e && typeof e.url === "string") e.url = rewriter(e.url);
        }
      }
      // Rewrite source-map-cache keys
      if (json["source-map-cache"] && typeof json["source-map-cache"] === "object") {
        const smc = json["source-map-cache"] as Record<string, any>;
        const next: Record<string, any> = {};
        for (const [k, v] of Object.entries(smc)) {
          const nk = rewriter(k);
          next[nk] = v;
        }
        json["source-map-cache"] = next;
      }
      await fsp.writeFile(p, JSON.stringify(json), "utf8");
    }
  } catch {
    // best-effort; ignore failures
  }
}

export async function rsyncRepoTo(tmp: string) {
  await timeAsync(`rsyncRepoTo(${path.basename(tmp)})`, async () => {
    // Optional: limit sync to specific roots (comma/space-separated), e.g. "apps/demo,cpp,tools"
    const rootsEnv: string = (process.env.TEST_RSYNC_ROOTS || "").trim();
    if (rootsEnv) {
      const roots = rootsEnv
        .split(/[\,\s]+/)
        .map((r) => r.trim().replace(/^\/+/, ""))
        .filter(Boolean);
      // Always copy flake.nix if present so temp repos can run nix commands
      try {
        await $`bash -lc ${`set -euo pipefail
          if [ -f flake.nix ]; then install -D -m0644 flake.nix "${tmp}/flake.nix"; fi
        `}`;
      } catch {}
      for (const r of roots as string[]) {
        try {
          await $`rsync -a --relative ${r} ${tmp}/`;
        } catch {}
      }
      return;
    }
    const goOnly = process.env.TEST_PARTIAL_CLONE_GO_ONLY === "1";
    const excludes = [
      "/buck-out",
      "/.git",
      "/.envrc",
      "/.buck2_shim",
      "/test-logs",
      // Exclude all product repos; tests must synthesize their own temp content
      "/apps",
      "/libs",
      "/.pnpm-store",
      "/node_modules",
      "/coverage",
      "/.clinic",
      "/.direnv",
      "/result",
      "/tools/buck/graph.json",
    ];
    if (goOnly) {
      // In partial-clone GO-only mode, exclude other languages' templates entirely.
      excludes.push(
        "/cpp",
        "/tools/nix/templates", // tests will add minimal go.nix manually
        "/tools/scaffolding/templates", // tests will create minimal go template stub
      );
    }
    if (process.env.TEST_EXCLUDE_CPP_REQS === "1") {
      excludes.push("/cpp/defs.bzl", "/tools/nix/templates/cpp.nix");
    }
    // Ensure temp repo starts without any pre-generated provider/graph glue;
    // tests generate these deterministically when needed.
    excludes.push(
      "/third_party/providers/TARGETS.auto",
      "/third_party/providers/TARGETS.*.auto",
      // Keep auto_map.bzl available so node macros can parse without running glue
      "/third_party/providers/nix_attr_map.bzl",
    );
    const args = excludes.map((e) => ["--exclude", e]).flat();
    await $`rsync -a ${args} ./ ${tmp}/`;
  });
}

export async function mktemp(prefix = "test-") {
  const inRepo = process.env.TEST_TMP_IN_REPO === "1";
  const base = inRepo ? path.join(process.cwd(), "buck-out", "tmp") : os.tmpdir();
  if (inRepo) await fsp.mkdir(base, { recursive: true });
  return await fsp.mkdtemp(path.join(base, prefix));
}

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runInTemp<T>(
  name: string,
  fn: (tmp: string, $: any) => Promise<T>,
): Promise<T> {
  const overallStart = performance.now();
  const tmp = await mktemp(name + "-");
  await rsyncRepoTo(tmp);
  // Normalize flake.lock path inputs that use relative 'path:./...' to absolute paths within the temp repo.
  // This avoids Nix errors when evaluating from store snapshots where relative path inputs are disallowed.
  try {
    const flakeLockPath = path.join(tmp, "flake.lock");
    const lockTxt = await fsp.readFile(flakeLockPath, "utf8").catch(() => "");
    if (lockTxt) {
      const lockJson: any = JSON.parse(lockTxt);
      const nodes = (lockJson && lockJson.nodes) || {};
      const uv = nodes["uv2nix"];
      const locked = uv && uv.locked;
      const original = uv && uv.original;
      const isPathType =
        locked &&
        locked.type === "path" &&
        typeof locked.path === "string" &&
        locked.path.length > 0;
      if (isPathType) {
        const rel = locked.path as string;
        const abs = path.resolve(tmp, rel);
        // Write back absolute paths; keep type=path
        lockJson.nodes.uv2nix.locked.path = abs;
        if (original && typeof original === "object" && original.type === "path") {
          lockJson.nodes.uv2nix.original.path = abs;
        }
        await fsp.writeFile(flakeLockPath, JSON.stringify(lockJson, null, 2) + "\n", "utf8");
      }
    }
  } catch {
    // best-effort; leave as-is if any failure occurs
  }
  // Ensure Buck prelude and config exist inside the temp repo so @prelude loads work
  {
    let preludePath = "";
    // Prefer the checked-in prelude from the workspace copy
    const localPrelude = path.join(tmp, "prelude");
    try {
      await fsp.access(localPrelude);
      preludePath = localPrelude;
    } catch {}
    // If not available, best-effort: obtain nix prelude path (non-fatal if it fails)
    if (!preludePath) {
      try {
        const pre = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
        const out = String(pre.stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop();
        if (out) preludePath = path.join(out, "prelude").replaceAll("\\", "/");
      } catch {}
      if (!preludePath) {
        try {
          const ev = await $({ cwd: tmp, stdio: "pipe" })`nix eval --raw .#inputs.buck2.outPath`;
          const p = String(ev.stdout || "").trim();
          if (p) preludePath = path.join(p, "prelude").replaceAll("\\", "/");
        } catch {}
      }
    }
    if (preludePath) {
      const setupScript = [
        "set -euo pipefail",
        "printf '.\\n' > .buckroot",
        `[ -e prelude ] || ln -s "${preludePath}" prelude`,
        "cat > .buckconfig <<'EOF'",
        "[buildfile]",
        "name = TARGETS",
        "",
        "[repositories]",
        "root = .",
        "prelude = ./prelude",
        "toolchains = ./toolchains",
        "repo_toolchains = ./toolchains",
        "config = ./prelude",
        "fbsource = ./prelude/third-party/fbsource_stub",
        "fbcode = ./prelude/third-party/fbcode_stub",
        "",
        "[cells]",
        "root = .",
        "prelude = ./prelude",
        "toolchains = ./toolchains",
        "repo_toolchains = ./toolchains",
        "config = ./prelude",
        "fbsource = ./prelude/third-party/fbsource_stub",
        "fbcode = ./prelude/third-party/fbcode_stub",
        "",
        "[build]",
        "prelude = prelude",
        "default_platform = //:no_cgo",
        "user_platform = //:no_cgo",
        "target_platforms = //:no_cgo",
        "action_env = SDKROOT,CPATH,LIBRARY_PATH,CGO_CFLAGS,CGO_CPPFLAGS,CGO_ENABLED,WORKSPACE_ROOT,REPO_ROOT",
        "EOF",
        "mkdir -p toolchains",
        "printf '[buildfile]\\nname = TARGETS\\n' > toolchains/.buckconfig",
        "cat > toolchains/TARGETS <<'EOF'",
        'load("@repo_toolchains//:go.bzl", "system_go_bootstrap_toolchain", "system_go_toolchain")',
        'load("@repo_toolchains//:python.bzl", "system_python_bootstrap_toolchain", "system_python_toolchain")',
        'load("@prelude//tests:test_toolchain.bzl", "noop_test_toolchain")',
        'load("@repo_toolchains//:remote_test_execution.bzl", "remote_test_execution_toolchain")',
        'load("@prelude//toolchains:genrule.bzl", "system_genrule_toolchain")',
        'load("@repo_toolchains//:cxx.bzl", "system_cxx_toolchain")',
        "",
        'system_go_toolchain(name = "go", visibility = ["PUBLIC"]) ',
        'system_go_bootstrap_toolchain(name = "go_bootstrap", visibility = ["PUBLIC"]) ',
        'system_python_bootstrap_toolchain(name = "python_bootstrap", visibility = ["PUBLIC"]) ',
        'system_python_toolchain(name = "python", visibility = ["PUBLIC"]) ',
        'system_cxx_toolchain(name = "cxx", visibility = ["PUBLIC"]) ',
        'noop_test_toolchain(name = "test", visibility = ["PUBLIC"]) ',
        'remote_test_execution_toolchain(name = "remote_test_execution", visibility = ["PUBLIC"]) ',
        'system_genrule_toolchain(name = "genrule", visibility = ["PUBLIC"]) ',
        "EOF",
        "# Define a local platform that disables CGO globally for tests in temp repos",
        "cat > TARGETS <<'EOF'",
        'load("@prelude//:rules.bzl", "export_file")',
        "",
        "# Local test platform to disable CGO",
        "platform(",
        '    name = "no_cgo",',
        "    constraint_values = [",
        '        "config//go/constraints:cgo_enabled_false",',
        '        "config//go/constraints:asan_false",',
        '        "config//go/constraints:race_false",',
        "    ],",
        '    visibility = ["PUBLIC"],',
        ")",
        "",
        "# Expose flake.lock as a source label for nix_inputs in temp repos",
        "export_file(",
        '    name = "flake.lock",',
        '    src = "flake.lock",',
        '    visibility = ["PUBLIC"],',
        ")",
        "EOF",
        "# Ensure ephemeral build directories are ignored by git in temp repos",
        "cat > .gitignore <<'EOF'",
        "/.buck/",
        "/.cache/",
        "/buck-out/",
        "/node_modules/",
        "EOF",
      ].join("\n");
      await $({ cwd: tmp })`bash --noprofile --norc -c ${setupScript}`;
      // Debug: print generated configs for troubleshooting Buck configuration
      try {
        await $({
          cwd: tmp,
        })`bash -c 'echo ==== .buckconfig ====; sed -n 1,200p .buckconfig || true; echo ==== toolchains/TARGETS ====; sed -n 1,200p toolchains/TARGETS || true'`;
      } catch {}
    }
  }
  // Ensure Buck actions that source tools/buck/workspace-root.env (e.g., bundled node cli)
  // resolve the temp repo as WORKSPACE_ROOT instead of the real checkout path.
  try {
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "workspace-root.env"),
      `WORKSPACE_ROOT=${tmp}\n`,
      "utf8",
    );
  } catch {}
  // Strict dev-shell pre-check: when TEST_NEED_DEV_ENV=1, require buck2 prelude to be buildable in temp repo
  if ((process.env.TEST_NEED_DEV_ENV || "") === "1") {
    try {
      const chk = await $({
        cwd: tmp,
        stdio: "pipe",
      })`nix build '.#buck2-prelude' --no-link --accept-flake-config --print-build-logs`.nothrow();
      if (chk.exitCode !== 0) {
        throw new Error(
          "dev-shell check failed: nix build .#buck2-prelude did not succeed in temp repo; ensure direnv/dev shell is active",
        );
      }
    } catch (e) {
      throw e;
    }
  }
  // No fallback link to root workspace node_modules — tests must link per-importer via Nix outputs.
  // Avoid bootstrapping a dev environment in temp repos by default to prevent timeouts.
  // Opt-in only when TEST_NEED_DEV_ENV=1 is set in the environment.
  let envOut: any = { stdout: "" };
  const inferredNeedDev = false;
  if (process.env.TEST_NEED_DEV_ENV === "1" || inferredNeedDev) {
    try {
      envOut = await timeAsync(
        `devEnvExport(${path.basename(tmp)})`,
        async () =>
          $({
            cwd: tmp,
            stdio: "pipe",
            env: { ...process.env, TEST_NEED_DEV_ENV: "1" },
          })`bash --noprofile --norc -c 'if command -v direnv >/dev/null 2>&1; then direnv allow . >/dev/null 2>&1 || true; eval "$(direnv export bash)"; env -0; elif command -v nix >/dev/null 2>&1; then NO_NODE_MODULES_LINK=1 nix develop --accept-flake-config -c env -0; else printf ""; fi'`,
      );
    } catch {
      // ignore; proceed with current environment
    }
  }
  const exportEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") exportEnv[k] = v;
  }
  // Expose the real workspace root so actions can locate a stable flake root
  try {
    exportEnv.REPO_ROOT = process.cwd();
  } catch {}
  // In temp repos, prefer disabling CGO to avoid stdlib cgotest header dependencies
  exportEnv.CGO_ENABLED = "0";
  // Propagate SDKROOT and basic CGO flags on macOS so Go stdlib cgotest can find headers
  try {
    if (process.platform === "darwin") {
      const { stdout } = await $({ stdio: "pipe" })`xcrun --show-sdk-path`.nothrow();
      const sdk = String(stdout || "").trim();
      if (sdk) {
        exportEnv.SDKROOT = exportEnv.SDKROOT || sdk;
        const base = `-isysroot ${sdk}`;
        exportEnv.CGO_CPPFLAGS = [base, exportEnv.CGO_CPPFLAGS || ""].filter(Boolean).join(" ");
        exportEnv.CGO_CFLAGS = [base, exportEnv.CGO_CFLAGS || ""].filter(Boolean).join(" ");
        // Help clang/cgo find headers and libs inside the SDK even if flags get reset downstream
        const inc = `${sdk}/usr/include`;
        const lib = `${sdk}/usr/lib`;
        exportEnv.CPATH = [inc, exportEnv.CPATH || ""].filter(Boolean).join(path.delimiter);
        exportEnv.LIBRARY_PATH = [lib, exportEnv.LIBRARY_PATH || ""]
          .filter(Boolean)
          .join(path.delimiter);
        // Prefer invoking clang via xcrun so it honors SDKROOT reliably
        exportEnv.CC = exportEnv.CC || "xcrun --sdk macosx clang";
      }
    }
  } catch {}
  // Enforce that core toolchain binaries come from Nix; set CC/CXX accordingly
  try {
    const which = async (cmd: string): Promise<string> => {
      const out = await $({ stdio: "pipe" })`command -v ${cmd}`.nothrow();
      return String(out.stdout || "").trim();
    };
    const isNix = (p: string) => !!p && p.startsWith("/nix/store/");
    const clang = await which("clang");
    const clangxx = (await which("clang++")) || clang;
    const llvmAr = await which("llvm-ar");
    const ar = llvmAr || (await which("ar"));
    // Only enforce/use tools that are present and Nix-provided
    if (isNix(clang) && isNix(clangxx)) {
      if (process.platform === "darwin") {
        const xcrun = await which("xcrun");
        if (isNix(xcrun)) {
          exportEnv.CC = `${xcrun} --sdk macosx ${clang}`;
          exportEnv.CXX = `${xcrun} --sdk macosx ${clangxx}`;
        }
      } else {
        exportEnv.CC = clang;
        exportEnv.CXX = clangxx;
      }
    }
    if (!isNix(ar)) {
      // If ar missing or non-Nix, skip; CGO might not need archiver on this path
    }
  } catch {}
  const injected = String((envOut as any).stdout || "");
  for (const entry of injected ? injected.split("\0") : []) {
    if (!entry) continue;
    const idx = entry.indexOf("=");
    if (idx > 0) {
      const k = entry.slice(0, idx);
      const v = entry.slice(idx + 1);
      exportEnv[k] = v;
    }
  }
  // Ensure dev deps (fs-extra, c8, yaml, etc.) resolve from the main workspace initially.
  // When tests install additional deps in the temp repo, local node_modules will take precedence.
  try {
    const wsNodeModules = path.join(process.cwd(), "node_modules");
    exportEnv.NODE_PATH = [wsNodeModules, exportEnv.NODE_PATH || ""]
      .filter(Boolean)
      .join(path.delimiter);
  } catch {}
  // Ensure repo-aware bin helpers (e.g., tools/bin/build, verify) operate on the temp copy
  // Keep WORKSPACE_ROOT as the temp repo for file operations
  exportEnv.WORKSPACE_ROOT = tmp;
  // Avoid per-temp nested buck2 isolation; reuse a single daemon for all tests to reduce process churn.
  // Point HOME at the temp repo to avoid loading user login profiles (which may invoke direnv)
  // when tests run shells like `bash -lc ...`.
  exportEnv.HOME = tmp;
  // Prefer Go proxy to avoid GitHub API rate limiting; keep a local module cache under tmp
  try {
    exportEnv.GOPROXY = exportEnv.GOPROXY || "https://proxy.golang.org,direct";
    exportEnv.GOSUMDB = exportEnv.GOSUMDB || "sum.golang.org";
    exportEnv.GOMODCACHE = exportEnv.GOMODCACHE || path.join(tmp, ".gomodcache");
  } catch {}
  // Silence any direnv logging if hooks are present in environment.
  exportEnv.DIRENV_LOG_FORMAT = "";
  // Ensure zx init import always points to the real workspace, not the temp copy
  exportEnv.ZX_INIT = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");
  // Do not force NO_NODE_MODULES_LINK; allow initial symlink and per-temp installs to override.
  // Do not mutate PATH; rely on direnv-provided environment from the dev shell.
  // Already set above to disable node_modules linking in zx_test rule
  const nodeOpts = ["--experimental-strip-types", `--import ${exportEnv.ZX_INIT}`];
  exportEnv.NODE_OPTIONS = [nodeOpts.join(" "), exportEnv.NODE_OPTIONS || ""]
    .filter(Boolean)
    .join(" ");
  // Ensure zx globals are loaded in the temp repo when tests call bare `$` inside runInTemp
  // by importing the workspace zx-init explicitly once.
  try {
    await $({
      cwd: tmp,
      env: exportEnv,
    })`node --experimental-strip-types --import ${exportEnv.ZX_INIT} -e ${"console.log('zx-init-loaded')"}`;
  } catch {}
  const _$ = $({ cwd: tmp, env: exportEnv });
  try {
    // quiet: remove temporary diagnostics
    if (process.env.TEST_KEEP_TMP === "1") {
      try {
        // quiet: keep path logging minimal
        console.error(`KEEP_TMP ${tmp}`);
        await fsp
          .appendFile(path.join(process.cwd(), "test-tmp-paths.log"), tmp + "\n", "utf8")
          .catch(() => {});
      } catch {}
    }
    return await fn(tmp, _$);
  } finally {
    // Best-effort: stop any buck2 daemon for this temp repo to prevent buckd accumulation.
    // Do not kill buck2 daemon per test; reuse across tests to avoid fork storms
    // Avoid rewriting shared coverage artifacts concurrently; zx_test already normalizes coverage.
    // Opt-in via TEST_REWRITE_COVERAGE_TMP=1 if a test explicitly needs this legacy behavior.
    if ((process.env.TEST_REWRITE_COVERAGE_TMP || "") === "1") {
      await timeAsync(`rewriteCoverageUrls(${path.basename(tmp)})`, async () =>
        rewriteCoverageUrls(tmp).catch(() => {}),
      );
    }
    if (process.env.TEST_KEEP_TMP === "1") {
      try {
        // quiet: keep path logging minimal
        console.error(`KEEP_TMP ${tmp}`);
        const logFile = path.join(process.cwd(), "test-tmp-paths.log");
        await fsp.appendFile(logFile, tmp + "\n", "utf8").catch(() => {});
      } catch {}
    } else {
      await fsp.rm(tmp, { recursive: true, force: true }).catch((err) => {
        console.warn("warning: failed to remove temp test dir:", err);
      });
    }
    // quiet: timing footer removed (use TEST_TIMING=1 to enable timings)
  }
}
