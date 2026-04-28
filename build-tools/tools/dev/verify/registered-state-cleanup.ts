import { cleanupRegisteredTempRepos } from "./buck-orphan-cleanup";
import { cleanupRegisteredVerifyProcesses } from "./owned-process-state";
import { appendVerifyLogLine } from "./process-control";
import { cleanupCurrentVerifyEnvProcesses } from "./verify-owned-orphan-cleanup";

export function createRegisteredStateCleaner(opts: { stateFile: string; logFile: string | null }) {
  let cleanupPromise: Promise<void> | null = null;
  return async (): Promise<void> => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        try {
          const envProcRes = await cleanupCurrentVerifyEnvProcesses({
            stateFile: opts.stateFile,
            logFile: opts.logFile,
            log: async (line) => await appendVerifyLogLine(opts.logFile, line),
            maxKills: 200,
          });
          await appendVerifyLogLine(
            opts.logFile,
            `[verify] env-process cleanup: scanned=${envProcRes.scanned} killed=${envProcRes.killed}`,
          );
          const res = await cleanupRegisteredTempRepos({
            stateFile: opts.stateFile,
            log: async (line) => await appendVerifyLogLine(opts.logFile, line),
            maxKills: 200,
            removeRoots: true,
          });
          await appendVerifyLogLine(
            opts.logFile,
            `[verify] temp-repo buck cleanup: roots=${res.roots} killed=${res.killed}`,
          );
          const procRes = await cleanupRegisteredVerifyProcesses({
            stateFile: opts.stateFile,
            log: async (line) => await appendVerifyLogLine(opts.logFile, line),
            maxKills: 200,
          });
          await appendVerifyLogLine(
            opts.logFile,
            `[verify] owned-process cleanup: registered=${procRes.processes} killed=${procRes.killed}`,
          );
        } catch {}
      })();
    }
    await cleanupPromise;
  };
}
