import fs from "node:fs/promises";
import path from "node:path";
import { exactStoreGcRootPath } from "../dev/update-pnpm-hash/exact-store-gc-root";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import { runArtifactTool } from "./artifact-command";

type ExactNix = {
  runNix(args: string[]): Promise<{ stdout: string; stderr: string }>;
};

export async function prepareProtectedTauriPnpmAuthority(opts: {
  workspaceRoot: string;
  artifactToolsRoot: string;
  active: ExactNix;
  updateRunner?: (args: string[]) => Promise<string>;
}): Promise<{ storePath: string }> {
  const lockfile = "projects/apps/repro-rust-tauri/pnpm-lock.yaml";
  const sourceRoot = path.join(opts.artifactToolsRoot, "share/viberoots-source");
  const baseEnv = artifactTransportEnvironment(process.env);
  delete baseEnv.VBR_ARTIFACT_TOOLS_ROOT;
  const updateRunner =
    opts.updateRunner ||
    (async (args: string[]) => {
      const result = await runArtifactTool({
        tool: "node",
        args: [
          "--experimental-strip-types",
          "--experimental-top-level-await",
          "--disable-warning=ExperimentalWarning",
          "--import",
          path.join(sourceRoot, "build-tools/tools/dev/zx-init.mjs"),
          path.join(sourceRoot, "build-tools/tools/dev/update-pnpm-hash.ts"),
          ...args,
        ],
        workspaceRoot: opts.workspaceRoot,
        artifactToolsRoot: opts.artifactToolsRoot,
        baseEnv,
        internalEnv: {
          VIBEROOTS_FLAKE_INPUT_ROOT: sourceRoot,
          VIBEROOTS_SOURCE_ROOT: sourceRoot,
        },
      });
      return `${result.stdout}\n${result.stderr}`;
    });
  await updateRunner(["--lockfile", lockfile]);
  const materialized = await updateRunner(["--materialize-committed", "--lockfile", lockfile]);
  const matches = materialized.match(/\/nix\/store\/[a-z0-9]{32}-pnpm-store-lock-[a-f0-9]{64}/gu);
  const paths = [...new Set(matches || [])];
  if (paths.length !== 1) {
    throw new Error("protected Tauri update did not produce one exact immutable pnpm store");
  }
  const storePath = paths[0]!;
  await opts.active.runNix(["copy", "--from", "daemon", storePath]);
  const registered = (await opts.active.runNix(["path-info", "--json", storePath])).stdout;
  if (!registered.includes(storePath)) {
    throw new Error("protected Tauri pnpm store is absent from the reviewed builder");
  }
  const gcRoot = exactStoreGcRootPath(opts.workspaceRoot, "projects/apps/repro-rust-tauri");
  const gcRootStat = await fs.lstat(gcRoot).catch(() => null);
  if (gcRootStat && !gcRootStat.isSymbolicLink()) {
    throw new Error(`refusing to remove non-symlink protected Tauri pnpm GC root: ${gcRoot}`);
  }
  if (gcRootStat) await fs.unlink(gcRoot);
  return { storePath };
}
