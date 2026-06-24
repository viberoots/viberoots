import * as fsp from "node:fs/promises";
import path from "node:path";
import { withHiddenNodeModules } from "../../lib/pnpm-node-modules-guard";
import { runExactStoreCommand } from "./exact-store-command";

async function exactStoreLooksPopulated(storeDir: string): Promise<boolean> {
  const versions = await fsp.readdir(storeDir, { withFileTypes: true }).catch(() => []);
  for (const version of versions) {
    if (!version.isDirectory() || !version.name.startsWith("v")) continue;
    const versionDir = path.join(storeDir, version.name);
    const files = path.join(versionDir, "files");
    const indexDb = path.join(versionDir, "index.db");
    const projects = path.join(versionDir, "projects");
    const hasFiles = await fsp
      .readdir(files)
      .then((entries) => entries.length > 0)
      .catch(() => false);
    const hasIndexDb = await fsp
      .stat(indexDb)
      .then((st) => st.isFile() && st.size > 0)
      .catch(() => false);
    const hasProjects = await fsp
      .readdir(projects)
      .then((entries) => entries.length > 0)
      .catch(() => false);
    if (hasFiles && hasIndexDb && hasProjects) return true;
  }
  return false;
}

function isPnpmPostCompletionTermination(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("signal=SIGABRT") || message.includes("signal=SIGKILL");
}

export async function fetchExactPnpmStore(opts: {
  importer: string;
  importerAbs: string;
  storeDir: string;
  homeDir: string;
  fetchTimeout: string;
  timeoutMs: number;
  pnpmPath: string;
}): Promise<void> {
  await withHiddenNodeModules(opts.importerAbs, async () => {
    const env = {
      ...process.env,
      NIX_PNPM_ALLOW_GENERATE: "1",
      NIX_PNPM_FETCH_TIMEOUT: opts.fetchTimeout,
      NIX_PNPM_INSTALL_TIMEOUT: opts.fetchTimeout,
      NODE_OPTIONS: "--no-warnings",
      PNPM_HOME: opts.homeDir,
    };
    try {
      await runExactStoreCommand({
        command: opts.pnpmPath,
        label: `importer=${opts.importer} step=exact-store-fetch`,
        cwd: opts.importerAbs,
        timeoutMs: opts.timeoutMs,
        env,
        args: [
          "install",
          "--force",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--ignore-pnpmfile",
          "--prefer-offline",
          "--network-concurrency",
          "1",
          "--child-concurrency",
          "1",
          "--prod=false",
          "--lockfile-dir",
          ".",
          "--dir",
          ".",
          "--store-dir",
          opts.storeDir,
          "--reporter",
          "silent",
          "--color",
          "never",
        ],
      });
    } catch (error) {
      if (
        !isPnpmPostCompletionTermination(error) ||
        !(await exactStoreLooksPopulated(opts.storeDir))
      ) {
        throw error;
      }
      await fsp.rm(path.join(opts.importerAbs, "node_modules"), {
        recursive: true,
        force: true,
      });
      await runExactStoreCommand({
        command: opts.pnpmPath,
        label: `importer=${opts.importer} step=exact-store-offline-validate-after-termination`,
        cwd: opts.importerAbs,
        timeoutMs: opts.timeoutMs,
        env,
        args: [
          "install",
          "--offline",
          "--force",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--ignore-pnpmfile",
          "--prod=false",
          "--lockfile-dir",
          ".",
          "--dir",
          ".",
          "--store-dir",
          opts.storeDir,
          "--reporter",
          "silent",
          "--color",
          "never",
        ],
      });
      console.warn(
        `[update-pnpm-hash] importer=${opts.importer} step=exact-store-fetch verified offline install after pnpm post-completion termination`,
      );
    }
    await fsp.rm(path.join(opts.importerAbs, "node_modules"), {
      recursive: true,
      force: true,
    });
  });
}
