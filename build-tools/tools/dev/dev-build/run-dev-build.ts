import * as fsp from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseDevBuildArgs } from "./args";
import { runBuckCommand } from "./buck";
import { cleanDevBuildWorkspace, refreshGlueAndExportGraph } from "./glue";
import { captureFlakeLockSnapshot, restoreFlakeLock } from "./git";
import { runHousekeeping } from "./housekeeping";
import { createIsolation, type Isolation } from "./isolation";
import { materializePureGraphIfEnabled } from "./materialize-pure";
import { maybePrintImpureMaterializedBins, exportGraphImpure } from "./materialize-impure";
import { shouldMaterializeByDefault } from "./materialize-policy";
import { ensureBuckPreludeConfig } from "./prelude";
import { cleanupDevBuildRootBuckOut } from "./root-buck-out-cleanup";
import { ensureDevBuildStoreSpace } from "./safety-rails";
import { runStartupCheck } from "./startup";
import { normalizeDevBuildTargetArgs } from "./target-args";
import { maybeAutoImpureFromUntrackedFiles } from "./untracked";
import { pruneDeadDevBuildIsolationDirs } from "../clean-temp-outs-lib";
import { registerBuckIsolationSync } from "../verify/owned-process-state";
import { applyNixCacheHealthPolicy } from "../verify/nix-cache-health";
import { getArgvTokens } from "../../lib/cli";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { findRepoRoot } from "../../lib/repo";
import { resolveToolPathSync } from "../../lib/tool-paths";

export async function missingOptionalPatchDirsForFreshIsolation(opts: {
  root: string;
  subcmd: string;
  restArgs: string[];
}): Promise<string[]> {
  if (opts.subcmd !== "build") return [];
  if (!opts.restArgs.some((t) => String(t || "").trim() === "//...")) return [];

  const patchRoot = path.join(opts.root, "patches");
  const patchRootExists = await fsp
    .stat(patchRoot)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!patchRootExists) return [];

  const optionalPatchDirs = ["cpp", "go", "node", "python", "rust"] as const;
  const missing: string[] = [];
  for (const d of optionalPatchDirs) {
    const exists = await fsp
      .stat(path.join(patchRoot, d))
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists) missing.push(d);
  }
  return missing;
}

export async function runDevBuild(): Promise<void> {
  const invocationCwd = process.cwd();
  const root = await findRepoRoot(invocationCwd);
  const verbose = isVbrVerbose();
  const ui = createCommandUi({ verbose });
  const isCI = process.env.CI === "true";
  const graphPath = path.join(root, DEFAULT_GRAPH_PATH);
  const graphExistedBefore = await fsp
    .access(graphPath)
    .then(() => true)
    .catch(() => false);
  const flakeLockSnapshot = await captureFlakeLockSnapshot(root);

  let iso: Isolation | null = null;
  try {
    process.chdir(root);
  } catch {}

  await applyNixCacheHealthPolicy(root);

  const removedDeadDevBuildIsos = await pruneDeadDevBuildIsolationDirs(root).catch(() => []);
  if (verbose && removedDeadDevBuildIsos.length > 0) {
    console.warn(
      `[dev-build] pruned dead buck-out/devbuild-* dirs before startup: ${removedDeadDevBuildIsos.join(", ")}`,
    );
  }
  const removedRootBuckOut = await cleanupDevBuildRootBuckOut(root).catch(() => []);
  if (verbose && removedRootBuckOut.length > 0) {
    console.warn(
      `[dev-build] pruned dev-build root buck-out entries before startup: ${removedRootBuckOut.join(", ")}`,
    );
  }

  try {
    const parsed0 = parseDevBuildArgs(getArgvTokens());
    const parsed = {
      ...parsed0,
      restArgs: await normalizeDevBuildTargetArgs({
        workspaceRoot: root,
        baseDir: invocationCwd,
        subcmd: parsed0.subcmd,
        args: parsed0.restArgs,
      }),
    };
    if (!verbose) {
      ui.heading("viberoots build");
      ui.step("target", `${parsed.subcmd} ${parsed.restArgs.join(" ")}`);
    }
    const missingOptionalPatchDirs = await missingOptionalPatchDirsForFreshIsolation({
      root,
      subcmd: parsed.subcmd,
      restArgs: parsed.restArgs,
    });
    const useFreshIsolationForMissingPatchDirs = missingOptionalPatchDirs.length > 0;
    if (useFreshIsolationForMissingPatchDirs) {
      console.warn(
        `[dev-build] using fresh buck isolation for full recursive build; missing optional patch dirs: ${missingOptionalPatchDirs.join(", ")}`,
      );
    }

    iso = createIsolation({
      reuseDaemon: useFreshIsolationForMissingPatchDirs ? false : undefined,
    });
    const stateFile = String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
    if (stateFile && iso.buckIsolation && iso.registerForCleanup) {
      registerBuckIsolationSync({
        stateFile,
        iso: iso.buckIsolation,
        repoRoot: root,
        ownerPid: process.pid,
        kind: "dev-build",
      });
    }
    iso.attachSignalHandlers();
    iso.attachExitHandlers();
    await iso.startWatchdog(root);

    process.once("uncaughtException", async (err) => {
      try {
        await iso.killIsolationIfOwned();
      } catch {}
      console.error(err);
      process.exit(1);
    });

    const auto = await maybeAutoImpureFromUntrackedFiles({
      isCI,
      root,
      impure: parsed.impure,
      subcmd: parsed.subcmd,
      restArgs: parsed.restArgs,
    });
    const impure = auto.impure || parsed.impure;
    const materializeDecision = await shouldMaterializeByDefault({
      root,
      requestedMaterialize: parsed.materialize,
      isCI,
    });
    let materialize = materializeDecision.materialize;
    let materializeReason = materializeDecision.reason;

    const buckConfigChanged = await ensureBuckPreludeConfig(root);
    if (buckConfigChanged) {
      const buck2Path = resolveToolPathSync("buck2");
      spawnSync(buck2Path, [...iso.isolationFlags, "kill"], {
        cwd: root,
        env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
        stdio: "ignore",
        timeout: 10_000,
      });
      if (verbose) {
        console.warn("[dev-build] restarted Buck daemon after generated .buckconfig repair");
      }
    }
    await runStartupCheck(root);
    await ensureDevBuildStoreSpace({
      subcmd: parsed.subcmd,
      restArgs: parsed.restArgs,
    });

    if (parsed.materialize && !materialize && verbose) {
      console.log(
        `[dev-build] fast-path: skipping glue/materialize (${materializeDecision.reason})`,
      );
    } else if (parsed.materialize && !materialize) {
      ui.ok("prebuild", materializeDecision.reason);
    }

    await cleanDevBuildWorkspace(root);

    let exportedGraphDuringMaterialize = false;
    if (!isCI && materialize) {
      delete process.env.DEVBUILD_EMPTY_GRAPH;
      await refreshGlueAndExportGraph(root);
      exportedGraphDuringMaterialize = true;
      if (String(process.env.DEVBUILD_EMPTY_GRAPH || "").trim() === "1") {
        materialize = false;
        materializeReason = "empty-bootstrap-graph";
        if (verbose) console.log("[dev-build] fast-path: skipping materialization for empty graph");
        else ui.ok("prebuild", "empty graph");
      }
      if (materializeReason === "prebuild-guard-stale") {
        const afterRefreshDecision = await shouldMaterializeByDefault({
          root,
          requestedMaterialize: parsed.materialize,
          isCI,
        });
        if (!afterRefreshDecision.materialize) {
          materialize = false;
          materializeReason = "prebuild-fresh-after-refresh";
          if (verbose)
            console.log("[dev-build] fast-path: skipping pure materialization after glue refresh");
          else ui.ok("prebuild", "fresh after glue refresh");
        } else {
          materializeReason = afterRefreshDecision.reason;
        }
      }
    }

    await materializePureGraphIfEnabled({
      isCI,
      root,
      materialize,
      impure,
      restArgs: parsed.restArgs,
    });

    if (materialize && impure && !exportedGraphDuringMaterialize) {
      await exportGraphImpure(root);
    } else if (materialize && impure && exportedGraphDuringMaterialize) {
      if (verbose)
        console.log("[dev-build] fast-path: reusing freshly exported graph for impure build");
      else ui.ok("graph", "reusing fresh export");
    }

    await runBuckCommand({
      root,
      subcmd: parsed.subcmd,
      restArgs: parsed.restArgs,
      isolationFlags: iso.isolationFlags,
    });

    // `--no-materialize` is a strict no-glue path. If the build side-effects an
    // ephemeral graph file during first-run bootstrap, remove that transient output.
    if (!materialize && !graphExistedBefore) {
      await fsp.rm(graphPath, { force: true }).catch(() => {});
    }

    await maybePrintImpureMaterializedBins({
      root,
      impure,
      subcmd: parsed.subcmd,
      restArgs: parsed.restArgs,
    });

    await restoreFlakeLock(root, flakeLockSnapshot);
    await runHousekeeping({ isCI, root });
  } finally {
    if (iso) {
      await iso.killIsolationIfOwned().catch(() => {});
    }
    const removed = await cleanupDevBuildRootBuckOut(root).catch(() => []);
    if (verbose && removed.length > 0) {
      console.warn(`[dev-build] final root buck-out cleanup: removed=${removed.join(",")}`);
    }
  }
}
