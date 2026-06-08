import * as fsp from "node:fs/promises";
import path from "node:path";
import { parseDevBuildArgs } from "./args";
import { runBuckCommand } from "./buck";
import { cleanDevBuildWorkspace, refreshGlueAndExportGraph } from "./glue";
import { restoreFlakeLock } from "./git";
import { runHousekeeping } from "./housekeeping";
import { createIsolation } from "./isolation";
import { materializePureGraphIfEnabled } from "./materialize-pure";
import { maybePrintImpureMaterializedBins, exportGraphImpure } from "./materialize-impure";
import { shouldMaterializeByDefault } from "./materialize-policy";
import { ensureBuckPreludeConfig } from "./prelude";
import { ensureDevBuildStoreSpace } from "./safety-rails";
import { runStartupCheck } from "./startup";
import { normalizeDevBuildTargetArgs } from "./target-args";
import { maybeAutoImpureFromUntrackedFiles } from "./untracked";
import { pruneDeadDevBuildIsolationDirs } from "../clean-temp-outs-lib";
import { registerBuckIsolationSync } from "../verify/owned-process-state";
import { applyNixCacheHealthPolicy } from "../verify/nix-cache-health";
import { getArgvTokens } from "../../lib/cli";
import { findRepoRoot } from "../../lib/repo";

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
  const isCI = process.env.CI === "true";
  const graphPath = path.join(root, "build-tools", "tools", "buck", "graph.json");
  const graphExistedBefore = await fsp
    .access(graphPath)
    .then(() => true)
    .catch(() => false);

  try {
    process.chdir(root);
  } catch {}

  await applyNixCacheHealthPolicy(root);

  const removedDeadDevBuildIsos = await pruneDeadDevBuildIsolationDirs(root).catch(() => []);
  if (removedDeadDevBuildIsos.length > 0) {
    console.warn(
      `[dev-build] pruned dead buck-out/devbuild-* dirs before startup: ${removedDeadDevBuildIsos.join(", ")}`,
    );
  }

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

  const iso = createIsolation({
    reuseDaemon: useFreshIsolationForMissingPatchDirs ? false : undefined,
  });
  const stateFile = String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (stateFile && iso.buckIsolation) {
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

  await runStartupCheck(root);
  await ensureDevBuildStoreSpace({
    subcmd: parsed.subcmd,
    restArgs: parsed.restArgs,
  });

  if (parsed.materialize && !materialize) {
    console.log(`[dev-build] fast-path: skipping glue/materialize (${materializeDecision.reason})`);
  }

  if (materialize) {
    await ensureBuckPreludeConfig(root);
  }

  await cleanDevBuildWorkspace(root);

  let exportedGraphDuringMaterialize = false;
  if (!isCI && materialize) {
    await refreshGlueAndExportGraph(root);
    exportedGraphDuringMaterialize = true;
    if (materializeReason === "prebuild-guard-stale") {
      const afterRefreshDecision = await shouldMaterializeByDefault({
        root,
        requestedMaterialize: parsed.materialize,
        isCI,
      });
      if (!afterRefreshDecision.materialize) {
        materialize = false;
        materializeReason = "prebuild-fresh-after-refresh";
        console.log("[dev-build] fast-path: skipping pure materialization after glue refresh");
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
    console.log("[dev-build] fast-path: reusing freshly exported graph for impure build");
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

  await restoreFlakeLock(root);
  await runHousekeeping({ isCI, root });
}
