import { ensureBuckReaperStarted } from "../buck-reaper";
import { timeAsync } from "../timing";
import { withAsyncCleanup } from "../async-cleanup";
import { cleanupSeededTemp } from "./cleanup";
import type { RunInTempCallback, SeededTempSetup } from "./contracts";
import { prepareOptionalDevEnv } from "./dev-env";
import { withTempProcessEnv } from "./process-env";
import { buildSeededRuntimeEnv } from "./runtime-env";
import { registerTempCommandEnvironment } from "./dependency-reconcile";

export async function runPreparedSeededTemp<T>(
  setup: SeededTempSetup,
  fn: RunInTempCallback<T>,
): Promise<T> {
  let consumerSnapshot: Awaited<ReturnType<typeof prepareOptionalDevEnv>>["consumerSnapshot"] =
    null;
  let tempPnpmStateRoot: string | null = null;
  let cleanupCommand: any = null;
  return await withAsyncCleanup(
    async () => {
      const devEnv = await prepareOptionalDevEnv(setup);
      consumerSnapshot = devEnv.consumerSnapshot;
      const runtime = await buildSeededRuntimeEnv(setup, devEnv.envOut);
      tempPnpmStateRoot = runtime.tempPnpmStateRoot;
      cleanupCommand = $({ cwd: setup.tmp, env: runtime.exportEnv });
      registerTempCommandEnvironment(cleanupCommand, setup.tmp, runtime.exportEnv);
      await timeAsync(
        "buck-daemon-reaper setup",
        async () => await ensureBuckReaperStarted(setup.tmp, cleanupCommand),
      );
      return await timeAsync(
        "runInTemp testBody",
        async () =>
          await withTempProcessEnv(
            runtime.exportEnv,
            async () => await fn(setup.tmp, cleanupCommand),
          ),
      );
    },
    async () =>
      await cleanupSeededTemp({
        setup,
        cleanupCommand,
        consumerSnapshot,
        tempPnpmStateRoot,
      }),
  );
}
