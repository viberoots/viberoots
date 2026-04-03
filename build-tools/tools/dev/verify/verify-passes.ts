import * as fsp from "node:fs/promises";
import path from "node:path";
import { spawnVerifyBuck2Tests } from "./buck2-test.ts";
import { startVerifySafetyRails } from "./safety-rails.ts";
import {
  assertVerifyTargetPlanNotEmpty,
  resolveVerifyTargetPlan,
  summarizeVerifyTargetPlan,
} from "./target-passes.ts";

async function appendVerifyPassLog(file: string | null, line: string): Promise<void> {
  if (!file) return;
  await fsp.appendFile(file, `${line}\n`, "utf8").catch(() => {});
}

export async function runVerifyBuckPasses(opts: {
  root: string;
  iso: string;
  logFile: string | null;
  console: "auto" | "super" | "simple";
  targets: string[];
  zxNodeModulesOut: string;
  analysisDir: string;
  onPgid: (pgid: number) => void;
}): Promise<number> {
  const plan = resolveVerifyTargetPlan({ root: opts.root, iso: opts.iso, targets: opts.targets });
  try {
    assertVerifyTargetPlanNotEmpty({ requestedTargets: opts.targets, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    await appendVerifyPassLog(opts.logFile, `[verify] target resolution failed: ${message}`);
    return 2;
  }
  const passes = plan.passes;
  const expanded = summarizeVerifyTargetPlan(plan);
  await appendVerifyPassLog(
    opts.logFile,
    `[verify] expanded targets: concrete=${expanded.expandedTargetCount} pass_count=${expanded.passCount} isolated_passes=${expanded.isolatedPassCount} isolated_targets=${expanded.isolatedTargetCount} shared_targets=${expanded.sharedTargetCount}`,
  );
  if (passes.length !== 1 || passes[0]?.name !== "shared") {
    await appendVerifyPassLog(
      opts.logFile,
      `[verify] target passes: ${passes.map((pass) => `${pass.name}=${pass.targets.join(",")}`).join(" ")}`,
    );
  }

  for (const [index, pass] of passes.entries()) {
    await appendVerifyPassLog(
      opts.logFile,
      `[verify] target pass begin name=${pass.name} index=${index + 1}/${passes.length} targets=${pass.targets.join(" ")}`,
    );
    const spawned = spawnVerifyBuck2Tests({
      root: opts.root,
      iso: opts.iso,
      logFile: opts.logFile,
      console: opts.console,
      targets: pass.targets,
      zxNodeModulesOut: opts.zxNodeModulesOut,
      threadsOverride: pass.threadsOverride,
      passName: pass.name,
    });
    opts.onPgid(spawned.pgid);
    const rails = await startVerifySafetyRails({
      root: opts.root,
      analysisDir: path.join(opts.analysisDir, `pass-${index + 1}`),
      processGroupIdToKill: spawned.pgid,
      onTrigger: async (reason) =>
        appendVerifyPassLog(
          opts.logFile,
          reason.startsWith("[notice] ")
            ? `[verify] safety-rails notice: ${reason.slice(9)}`
            : `[verify] safety-rails stop: ${reason}`,
        ),
    });
    const status = await spawned.wait();
    rails.stop();
    await appendVerifyPassLog(
      opts.logFile,
      `[verify] target pass end name=${pass.name} index=${index + 1}/${passes.length} status=${status}`,
    );
    if (status !== 0) return status;
  }

  return 0;
}
