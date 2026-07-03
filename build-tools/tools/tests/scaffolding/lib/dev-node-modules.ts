#!/usr/bin/env zx-wrapper
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { stageTempRepoPaths } from "../../lib/test-helpers/git-stage";
import { resolveToolPathSync } from "../../../lib/tool-paths";
import { viberootsDevTool } from "./viberoots-tools";
import { viberootsRoot } from "./viberoots-tools";
import { esbuildPackageName } from "./wasm-watch";

type PnpmDevInstallOptions = {
  tmp: string;
  filter: string;
  _$: any;
  lockfileOnly?: boolean;
  frozenLockfile?: boolean;
  installMode?: "nix" | "raw-pnpm";
  stdio?: "inherit" | "pipe";
  env?: NodeJS.ProcessEnv;
};

type WorkspacePackageInfo = {
  name: string;
  relPath: string;
  dependencies: Record<string, string>;
};

async function readPrewarmedPnpmStore(): Promise<string> {
  const existing = String(process.env.LOCAL_PNPM_STORE || "").trim();
  if (existing) return existing;
  const root = viberootsRoot();
  const candidates = [
    path.join(root, ".viberoots", "workspace", "buck", "unified-pnpm-store", "path"),
    path.join(path.dirname(root), ".viberoots", "workspace", "buck", "unified-pnpm-store", "path"),
  ];
  for (const marker of candidates) {
    const storePath = (await fsp.readFile(marker, "utf8").catch(() => "")).trim();
    if (!storePath) continue;
    const st = await fsp.stat(storePath).catch(() => null);
    if (st?.isDirectory()) return storePath;
  }
  return "";
}

function mergedDependencySpecs(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}): Record<string, string> {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
}

async function workspacePackageInfoMap(tmp: string): Promise<Map<string, WorkspacePackageInfo>> {
  const out = new Map<string, WorkspacePackageInfo>();
  for (const rootRel of ["projects/apps", "projects/libs"]) {
    const root = path.join(tmp, rootRel);
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relPath = path.posix.join(rootRel, entry.name);
      const pkgDir = path.join(tmp, relPath);
      const pkgRaw = await fsp.readFile(path.join(pkgDir, "package.json"), "utf8").catch(() => "");
      if (!pkgRaw) continue;
      const pkg = JSON.parse(pkgRaw) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const name = String(pkg.name || "").trim();
      if (!name) continue;
      out.set(name, {
        name,
        relPath,
        dependencies: mergedDependencySpecs(pkg),
      });
    }
  }
  return out;
}

async function rawPnpmWorkspacePackagePaths(tmp: string, importer: string): Promise<string[]> {
  const packages = await workspacePackageInfoMap(tmp);
  const importerAbs = path.join(tmp, importer);
  const importerPkg = JSON.parse(
    await fsp.readFile(path.join(importerAbs, "package.json"), "utf8"),
  ) as {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const importerName = String(importerPkg.name || "").trim();
  if (!importerName) throw new Error(`package.json for ${importer} is missing a package name`);
  const importerInfo: WorkspacePackageInfo = {
    name: importerName,
    relPath: importer,
    dependencies: mergedDependencySpecs(importerPkg),
  };
  packages.set(importerName, importerInfo);

  const selected = new Map<string, WorkspacePackageInfo>();
  const visit = (info: WorkspacePackageInfo): void => {
    if (selected.has(info.name)) return;
    selected.set(info.name, info);
    for (const [depName, spec] of Object.entries(info.dependencies)) {
      if (!String(spec || "").startsWith("workspace:")) continue;
      const dep = packages.get(depName);
      if (!dep) throw new Error(`workspace dependency ${depName} not found for ${info.relPath}`);
      visit(dep);
    }
  };
  visit(importerInfo);
  return Array.from(new Set(Array.from(selected.values()).map((info) => info.relPath))).sort(
    (a, b) => a.localeCompare(b),
  );
}

async function rawPnpmInstallForDevTest(
  opts: PnpmDevInstallOptions,
  importer: string,
  env: NodeJS.ProcessEnv,
  localPnpmStore: string,
): Promise<void> {
  const node = resolveToolPathSync("node", env);
  const pnpm = resolveToolPathSync("pnpm", env);
  const importerAbs = path.join(opts.tmp, importer);
  const importerPkg = JSON.parse(
    await fsp.readFile(path.join(importerAbs, "package.json"), "utf8"),
  ) as {
    name?: string;
  };
  const filter = String(importerPkg.name || "").trim();
  if (!filter) throw new Error(`package.json for ${importer} is missing a package name`);
  const workspacePackagePaths = await rawPnpmWorkspacePackagePaths(opts.tmp, importer);
  await fsp
    .writeFile(
      path.join(opts.tmp, "pnpm-workspace.yaml"),
      [
        "packages:",
        ...workspacePackagePaths.map((pkgPath) => `  - ${pkgPath}`),
        "overrides:",
        "  nanoid: 3.3.11",
        "",
      ].join("\n"),
      { flag: "wx" },
    )
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  const storeArgs = localPnpmStore ? ["--store-dir", localPnpmStore] : [];
  const sharedArgs = [
    "--lockfile-dir",
    importerAbs,
    "--filter",
    filter,
    "--force",
    "--prod=false",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--reporter=append-only",
    "--color=never",
    "--network-concurrency",
    "1",
    "--child-concurrency",
    "1",
    "--package-import-method",
    "copy",
    ...storeArgs,
  ];
  const base = opts._$({
    cwd: opts.tmp,
    stdio: opts.stdio || "inherit",
    env,
  });

  if (!opts.frozenLockfile) {
    await base`${node} ${pnpm} install ${sharedArgs} --lockfile-only --prefer-offline`;
  }
  if (opts.lockfileOnly) {
    return;
  }
  const lockfilePolicy = opts.frozenLockfile
    ? "--config.frozen-lockfile=true"
    : "--config.frozen-lockfile=false";
  await base`${node} ${pnpm} install ${sharedArgs} ${lockfilePolicy} --prefer-offline`;
  await overlayWorkspacePackagesForDevTest(opts.tmp, importer);
}

export async function pnpmInstallForDevTest(opts: PnpmDevInstallOptions): Promise<void> {
  const importer = opts.filter
    .replace(/^\.\//, "")
    .replace(/\.\.\.$/, "")
    .replace(/\/$/, "");
  const lockfile = `${importer}/pnpm-lock.yaml`;
  const localPnpmStore = await readPrewarmedPnpmStore();
  const localPnpmStoreEnv =
    opts.installMode === "raw-pnpm" && localPnpmStore ? { LOCAL_PNPM_STORE: localPnpmStore } : {};
  const env = {
    ...process.env,
    WORKSPACE_ROOT: opts.tmp,
    CI: "1",
    NIX_PNPM_ALLOW_GENERATE: opts.frozenLockfile ? "" : "1",
    NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600"),
    NODE_OPTIONS: "--no-warnings",
    ...(opts.installMode === "raw-pnpm" ? { NODE_PATH: "" } : {}),
    NEXT_TELEMETRY_DISABLED: "1",
    ...localPnpmStoreEnv,
    ...(opts.env || {}),
  };
  if (opts.installMode === "raw-pnpm") {
    await rawPnpmInstallForDevTest(opts, importer, env, localPnpmStore);
    return;
  }
  const base = opts._$({
    cwd: opts.tmp,
    stdio: opts.stdio || "inherit",
    env,
  });
  if (!opts.frozenLockfile) {
    await base`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;
  }
  if (opts.lockfileOnly) {
    return;
  }
  await base`zx-wrapper ${viberootsDevTool("install/link-node.ts")} --importer ${importer} --force`;
  await overlayWorkspacePackagesForDevTest(opts.tmp, importer);
}

async function symlinkReplace(target: string, linkPath: string): Promise<void> {
  await fsp.rm(linkPath, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(linkPath), { recursive: true });
  await fsp.symlink(target, linkPath);
}

async function symlinkStoreNodeModulesEntries(
  storeNodeModules: string,
  appNodeModules: string,
): Promise<void> {
  await fsp.rm(appNodeModules, { recursive: true, force: true });
  await fsp.mkdir(appNodeModules, { recursive: true });
  for (const entry of await fsp.readdir(storeNodeModules, { withFileTypes: true })) {
    const source = path.join(storeNodeModules, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      const scopeDir = path.join(appNodeModules, entry.name);
      await fsp.mkdir(scopeDir, { recursive: true });
      for (const scoped of await fsp.readdir(source, { withFileTypes: true })) {
        await symlinkReplace(path.join(source, scoped.name), path.join(scopeDir, scoped.name));
      }
      continue;
    }
    await symlinkReplace(source, path.join(appNodeModules, entry.name));
  }
}

async function workspacePackageMap(tmp: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [name, info] of await workspacePackageInfoMap(tmp)) {
    out.set(name, path.join(tmp, info.relPath));
  }
  return out;
}

async function overlayWorkspacePackagesForDevTest(tmp: string, importer: string): Promise<void> {
  const appAbs = path.join(tmp, importer);
  const nodeModules = path.join(appAbs, "node_modules");
  const nodeModulesStat = await fsp.lstat(nodeModules).catch(() => null);
  if (nodeModulesStat?.isSymbolicLink()) {
    const target = await fsp.readlink(nodeModules);
    await symlinkStoreNodeModulesEntries(path.resolve(appAbs, target), nodeModules);
  }

  const pkg = JSON.parse(await fsp.readFile(path.join(appAbs, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const workspacePackages = await workspacePackageMap(tmp);
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
  for (const [name, spec] of Object.entries(deps)) {
    if (!String(spec || "").startsWith("workspace:")) continue;
    const target = workspacePackages.get(name);
    if (!target) throw new Error(`workspace dependency ${name} not found for ${importer}`);
    await symlinkReplace(target, path.join(nodeModules, ...name.split("/")));
  }
}

function devServerEnv(appAbs: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WORKSPACE_ROOT: path.resolve(appAbs, "..", "..", ".."),
    CI: "1",
    NODE_OPTIONS: "",
    NEXT_TELEMETRY_DISABLED: "1",
    ...extra,
  };
}

export async function resolveEsbuildBinForDevTest(appAbs: string): Promise<string> {
  const esbuildPkg = esbuildPackageName();
  if (!esbuildPkg) return "";
  const binName = process.platform === "win32" ? "esbuild.exe" : "esbuild";
  const candidates = [
    path.join(appAbs, "node_modules", esbuildPkg, "bin", binName),
    path.join(appAbs, "node_modules", ".pnpm", "node_modules", esbuildPkg, "bin", binName),
  ];
  for (const candidate of candidates) {
    const ok = await fsp
      .access(candidate, fs.constants.X_OK)
      .then(() => true)
      .catch(() => false);
    if (ok) return candidate;
  }
  throw new Error(
    `expected executable esbuild binary for ${esbuildPkg}; checked ${candidates.join(", ")}`,
  );
}

export function spawnNextSsrDevServer(appAbs: string, port: number): ChildProcess {
  return spawn(
    "zx-wrapper",
    [
      viberootsDevTool("dev-with-wasm-watch.ts"),
      "--vite-cmd",
      `node ./node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${port}`,
      "--watch-cmd",
      "node scripts/dev-wasm-watch.mjs",
    ],
    {
      cwd: appAbs,
      stdio: "pipe",
      env: devServerEnv(appAbs, { PORT: String(port) }),
    },
  );
}

export function spawnNextDevServer(appAbs: string, port: number): ChildProcess {
  return spawn(
    "node",
    ["./node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: appAbs,
      stdio: "pipe",
      env: devServerEnv(appAbs, { PORT: String(port) }),
    },
  );
}

export function spawnViteSsrDevServer(
  appAbs: string,
  port: number,
  extraEnv: NodeJS.ProcessEnv = {},
): ChildProcess {
  return spawn(
    "zx-wrapper",
    [
      viberootsDevTool("dev-with-wasm-watch.ts"),
      "--vite-cmd",
      "node server/dev.mjs",
      "--watch-cmd",
      "node scripts/dev-wasm-watch.mjs",
    ],
    {
      cwd: appAbs,
      stdio: "pipe",
      env: devServerEnv(appAbs, { PORT: String(port), NODE_ENV: "development", ...extraEnv }),
    },
  );
}

export function spawnStaticViteDevServer(
  appAbs: string,
  port: number,
  extraEnv: NodeJS.ProcessEnv = {},
): ChildProcess {
  return spawn(
    "zx-wrapper",
    [
      viberootsDevTool("dev-with-wasm-watch.ts"),
      "--vite-cmd",
      `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort --clearScreen false --logLevel info`,
      "--watch-cmd",
      "node scripts/dev-wasm-watch.mjs",
    ],
    {
      cwd: appAbs,
      stdio: "pipe",
      env: devServerEnv(appAbs, { PORT: String(port), NODE_ENV: "development", ...extraEnv }),
    },
  );
}

export async function ensureNodeModulesForDevApp(opts: {
  tmp: string;
  appAbs: string;
  appRel: string;
  $: any;
  _$: any;
}): Promise<{ esbuildBin: string }> {
  const { tmp, appAbs, appRel, $, _$ } = opts;
  const lockfile = `${appRel}/pnpm-lock.yaml`;
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [appRel],
  });
  await pnpmInstallForDevTest({
    tmp,
    _$,
    filter: `./${appRel}...`,
    installMode: "raw-pnpm",
  });
  await _$({ cwd: tmp, stdio: "pipe" })`git add ${lockfile}`;
  await stageTempRepoPaths({
    tmp,
    _$,
    explicitPaths: [lockfile],
  });

  return { esbuildBin: await resolveEsbuildBinForDevTest(appAbs) };
}
