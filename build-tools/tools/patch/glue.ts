#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { exportInlineGraph } from "../buck/export-inline";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { artifactGraphQueryRoots } from "../buck/artifact-graph-query-roots";
import { runNodeWithZx } from "../lib/node-run";
import { resolveWorkspaceRootsSync } from "../lib/repo";
import { ensureWorkspaceBuckStatePackage } from "../lib/workspace-buck-state";
import { buildToolPath, zxInitPath } from "../dev/dev-build/paths";
import { isVbrVerbose } from "../lib/command-ui";
import { runCommand } from "./run-command";
import { buck2Present, graphContainsTarget, isJsonFile } from "./glue-graph";
import { requireGeneratedGraph } from "../buck/generated-graph";

export { runGlue } from "./run-glue";

type GraphWriteOptions = {
  exportGraph?: () => Promise<void>;
  workspaceRoot?: string;
  target?: string;
  queryRoots?: string[];
  graphPath?: string;
  force?: boolean;
  env?: NodeJS.ProcessEnv;
  nodeBin?: string;
  buck2Bin?: string;
  nixBin?: string;
  toolSourceRoot?: string;
};

async function writeGeneratedGraph(
  opts: GraphWriteOptions,
  publishWorkspaceIdentity: boolean,
): Promise<void> {
  const verbose = isVbrVerbose();
  const debug = (message: string): void => {
    if (verbose) console.error(message);
  };
  const inherited = opts.env || process.env;
  const workspaceRoot = (
    opts.workspaceRoot ||
    inherited.WORKSPACE_ROOT ||
    inherited.BUCK_TEST_SRC ||
    process.cwd()
  ).trim();
  const graphPath = opts.graphPath || path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  const forceInline = String(inherited.EXPORTER_FORCE_INLINE || "").trim() === "1";
  debug(`[ensureGraph] workspaceRoot=${workspaceRoot}`);
  if (publishWorkspaceIdentity) await ensureWorkspaceBuckStatePackage(workspaceRoot);
  const wantTargetRaw = (opts.target || inherited.BUCK_TARGET || "").trim();
  const shouldRegenerate = async (): Promise<boolean> => {
    if (opts.force) return true;
    try {
      const txt = await fsp.readFile(graphPath, "utf8");
      const trimmed = String(txt || "").trim();
      if (!trimmed || trimmed === "[]") return true;
      // If the file exists but is not valid JSON (e.g. tests may "touch" it with a comment),
      // treat it as missing so we regenerate a well-formed graph for downstream consumers.
      try {
        JSON.parse(trimmed);
      } catch {
        return true;
      }
      if (!wantTargetRaw) return false;
      try {
        return !graphContainsTarget(trimmed, wantTargetRaw);
      } catch {
        return true;
      }
    } catch {
      return true;
    }
  };

  if (!(await shouldRegenerate())) {
    debug(`[ensureGraph] graph exists and satisfies BUCK_TARGET: ${graphPath}`);
    return;
  }

  if (wantTargetRaw) {
    debug(`[ensureGraph] target ${wantTargetRaw} missing in existing graph — regenerating`);
  }

  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  try {
    await fsp.access(graphPath);
  } catch {
    // Buck queries may need //build-tools/tools/buck:graph.json to exist as a
    // declared source before the exporter can regenerate its real contents.
    await fsp.writeFile(graphPath, "[]\n", "utf8");
  }

  const publishGraphIdentity = async (): Promise<void> => {
    if (publishWorkspaceIdentity) await ensureWorkspaceBuckStatePackage(workspaceRoot);
  };

  const tryInjected = async (): Promise<boolean> => {
    if (!opts.exportGraph) return false;
    try {
      await opts.exportGraph();
      const valid = await isJsonFile(graphPath, false);
      if (valid) await publishGraphIdentity();
      return valid;
    } catch {
      return false;
    }
  };
  if (await tryInjected()) return;

  const nodeBin = opts.nodeBin || process.execPath;
  const repoRoot =
    opts.toolSourceRoot ||
    (inherited.REPO_ROOT && inherited.REPO_ROOT.trim()) ||
    resolveWorkspaceRootsSync({ start: workspaceRoot }).viberootsRoot;
  const zxInit = zxInitPath(repoRoot);
  const exportScript = buildToolPath(repoRoot, "tools/buck/export-graph.ts");
  const exporterArgs = ["--out", graphPath];

  const exportWithInline = async (inlineOpts: {
    includeTargetPlatforms: boolean;
    normalizeLabels: boolean;
    target: string;
  }) => {
    debug(`[ensureGraph] inline export via buck2 → ${graphPath}`);
    const defaultRoots = artifactGraphQueryRoots();
    const rawRoots = (
      opts.queryRoots?.join(",") ||
      inherited.BUCK_QUERY_ROOTS ||
      defaultRoots.join(",")
    )
      .split(/[,\s]+/)
      .filter(Boolean);
    const fs = await import("node:fs");
    const existingRoots = rawRoots.filter((r: string) => {
      const dir = r.replace(/^\/+/, "");
      try {
        return fs.existsSync(path.join(workspaceRoot, dir));
      } catch {
        return false;
      }
    });
    await exportInlineGraph({
      workspaceRoot,
      outPath: graphPath,
      target: inlineOpts.target,
      roots: existingRoots.length > 0 ? existingRoots : ["libs"],
      includeTargetPlatforms: inlineOpts.includeTargetPlatforms,
      normalizeLabels: inlineOpts.normalizeLabels,
      env: passEnv,
      buck2Bin: opts.buck2Bin,
    });
  };

  const passEnv = {
    ...inherited,
    WORKSPACE_ROOT: workspaceRoot,
    BUCK_TEST_SRC: workspaceRoot,
    REPO_ROOT: repoRoot,
    VIBEROOTS_ROOT: inherited.VIBEROOTS_ROOT || repoRoot,
    VIBEROOTS_SOURCE_ROOT: inherited.VIBEROOTS_SOURCE_ROOT || repoRoot,
    ...(opts.queryRoots?.length ? { BUCK_QUERY_ROOTS: opts.queryRoots.join(",") } : {}),
    ...(wantTargetRaw
      ? {
          BUCK_TARGET: wantTargetRaw,
          BUCK_TARGET_PLATFORMS:
            inherited.BUCK_TARGET_PLATFORMS ||
            inherited.BUCK_TARGET_PLATFORM ||
            "prelude//platforms:default",
        }
      : {}),
  } as Record<string, string>;
  const buck2Bin = opts.buck2Bin || "buck2";
  const haveBuck = await buck2Present(buck2Bin, passEnv);
  if (forceInline) {
    await exportWithInline({
      includeTargetPlatforms: true,
      normalizeLabels: true,
      target: wantTargetRaw,
    });
    await publishGraphIdentity();
    return;
  }

  if (haveBuck) {
    await runNodeWithZx({
      nodeBin,
      zxInitPath: zxInit,
      script: exportScript,
      args: exporterArgs,
      cwd: workspaceRoot,
      env: passEnv,
    });
    if (!(await isJsonFile(graphPath, true))) {
      throw new Error(`export-graph produced invalid JSON at ${graphPath}`);
    }
    await publishGraphIdentity();
    return;
  }

  // Buck2 is not available; try running via nix (still uses the same exporter script).
  const nixBin = opts.nixBin || inherited.NIX_BIN || inherited.VBR_NIX_BIN || "nix";
  const nixRun = await runCommand(
    nixBin,
    ["run", "--accept-flake-config", `${repoRoot}#zx-wrapper`, "--", exportScript, ...exporterArgs],
    { cwd: workspaceRoot, env: passEnv, stdio: "inherit" },
  );
  if (nixRun.exitCode !== 0) {
    throw new Error(`nix run zx-wrapper failed while exporting graph (exit ${nixRun.exitCode})`);
  }
  await fsp.access(graphPath);
  if (!(await isJsonFile(graphPath, true))) {
    throw new Error(`export-graph produced invalid JSON at ${graphPath}`);
  }
  await publishGraphIdentity();
}

export async function reconcileGeneratedGraph(opts: GraphWriteOptions = {}): Promise<void> {
  await writeGeneratedGraph(opts, true);
}

export async function materializeSelectedGraph(opts: GraphWriteOptions): Promise<void> {
  const inherited = opts.env || process.env;
  const workspaceRoot = (
    opts.workspaceRoot ||
    inherited.WORKSPACE_ROOT ||
    inherited.BUCK_TEST_SRC ||
    process.cwd()
  ).trim();
  await requireGeneratedGraph({
    graphPath: opts.graphPath || path.join(workspaceRoot, DEFAULT_GRAPH_PATH),
    target: opts.target || inherited.BUCK_TARGET,
  });
}
