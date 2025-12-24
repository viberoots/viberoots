import "zx/globals";
import { parseDevBuildArgs } from "./args.ts";
import { runBuckCommand } from "./buck.ts";
import { cleanDevBuildWorkspace, refreshGlueAndExportGraph } from "./glue.ts";
import { restoreFlakeLock } from "./git.ts";
import { runHousekeeping } from "./housekeeping.ts";
import { createIsolation } from "./isolation.ts";
import { materializePureGraphIfEnabled } from "./materialize-pure.ts";
import { maybePrintImpureMaterializedBins, exportGraphImpure } from "./materialize-impure.ts";
import { repoRoot } from "./paths.ts";
import { ensureBuckPreludeConfig } from "./prelude.ts";
import { runStartupCheck } from "./startup.ts";
import { maybeAutoImpureFromUntrackedFiles } from "./untracked.ts";
import { getArgvTokens } from "../../lib/cli.ts";

export async function runDevBuild(): Promise<void> {
  const root = repoRoot();
  const isCI = process.env.CI === "true";

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

  try {
    process.chdir(root);
  } catch {}

  const parsed = parseDevBuildArgs(getArgvTokens());
  const auto = await maybeAutoImpureFromUntrackedFiles({
    isCI,
    root,
    impure: parsed.impure,
  });
  const impure = auto.impure || parsed.impure;

  await runStartupCheck(root);

  if (parsed.materialize) {
    await ensureBuckPreludeConfig(root);
  }

  await cleanDevBuildWorkspace(root);

  if (!isCI && parsed.materialize) {
    await refreshGlueAndExportGraph(root);
  }

  await materializePureGraphIfEnabled({
    isCI,
    root,
    materialize: parsed.materialize,
    impure,
    restArgs: parsed.restArgs,
  });

  if (impure) {
    await exportGraphImpure(root);
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
