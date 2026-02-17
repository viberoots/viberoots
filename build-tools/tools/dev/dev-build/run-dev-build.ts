import "zx/globals";
import { parseDevBuildArgs } from "./args.ts";
import { runBuckCommand } from "./buck.ts";
import { cleanDevBuildWorkspace, refreshGlueAndExportGraph } from "./glue.ts";
import { restoreFlakeLock } from "./git.ts";
import { runHousekeeping } from "./housekeeping.ts";
import { createIsolation } from "./isolation.ts";
import { materializePureGraphIfEnabled } from "./materialize-pure.ts";
import { maybePrintImpureMaterializedBins, exportGraphImpure } from "./materialize-impure.ts";
import { shouldMaterializeByDefault } from "./materialize-policy.ts";
import { repoRoot } from "./paths.ts";
import { ensureBuckPreludeConfig } from "./prelude.ts";
import { runStartupCheck } from "./startup.ts";
import { maybeAutoImpureFromUntrackedFiles } from "./untracked.ts";
import { getArgvTokens } from "../../lib/cli.ts";

export async function runDevBuild(): Promise<void> {
  const root = repoRoot();
  const isCI = process.env.CI === "true";

  try {
    process.chdir(root);
  } catch {}

  const iso = createIsolation();
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

  const parsed = parseDevBuildArgs(getArgvTokens());
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
  const materialize = materializeDecision.materialize;

  await runStartupCheck(root);

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
  }

  await materializePureGraphIfEnabled({
    isCI,
    root,
    materialize,
    impure,
    restArgs: parsed.restArgs,
  });

  if (impure && !exportedGraphDuringMaterialize) {
    await exportGraphImpure(root);
  } else if (impure && exportedGraphDuringMaterialize) {
    console.log("[dev-build] fast-path: reusing freshly exported graph for impure build");
  }

  await runBuckCommand({
    root,
    subcmd: parsed.subcmd,
    restArgs: parsed.restArgs,
    isolationFlags: iso.isolationFlags,
  });

  await maybePrintImpureMaterializedBins({
    root,
    impure,
    subcmd: parsed.subcmd,
    restArgs: parsed.restArgs,
  });

  await restoreFlakeLock(root);
  await runHousekeeping({ isCI, root });
  process.exit(0);
}
