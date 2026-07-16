import os from "node:os";
import { preflightConfiguredSeedForTempRepo } from "./seed-store";
import { timeAsync } from "./timing";
import { mktemp } from "./tmp";
import type { RunInTempCallback, RunInTempOptions, TempAllocation } from "./run-in-temp/contracts";
import { prepareSeededTemp } from "./run-in-temp/seeded-setup";
import { runPreparedSeededTemp } from "./run-in-temp/seeded-runner";
import { runScratchTemp } from "./run-in-temp/scratch-runner";
import { resolveTestHome } from "./run-in-temp/test-roots";
import "./worker-init";

export { workspaceFlakeRef } from "./run-in-temp/filtered-inputs";
export { reconcileTempDependencyInputs } from "./run-in-temp/dependency-reconcile";

async function allocateTemp(name: string): Promise<TempAllocation> {
  const realHome = String(process.env.HOME || os.homedir() || "").trim();
  const tmp = await mktemp(name + "-");
  if (String(process.env.TEST_EARLY_TMP_STDOUT || "").trim() === "1") {
    try {
      console.log(`TMP ${tmp}`);
    } catch {}
  }
  const { home, removeOnExit: removeHome } = await timeAsync(
    "runInTemp resolveTestHome",
    async () => await resolveTestHome(),
  );
  return { home, realHome, removeHome, tmp };
}

export async function runInTemp<T>(
  name: string,
  fn: RunInTempCallback<T>,
  opts?: RunInTempOptions,
): Promise<T> {
  const scratch = opts?.workspace === "scratch";
  if (!scratch) await preflightConfiguredSeedForTempRepo();
  const allocation = await allocateTemp(name);
  if (scratch) return await runScratchTemp(allocation, fn);
  const setup = await prepareSeededTemp(allocation, opts);
  return await runPreparedSeededTemp(setup, fn);
}

export async function runInScratchTemp<T>(name: string, fn: RunInTempCallback<T>): Promise<T> {
  return await runInTemp(name, fn, { workspace: "scratch", git: false });
}
