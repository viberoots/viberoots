#!/usr/bin/env zx-wrapper
type SecretRuntime = { enterStep(step: "smoke"): Promise<Record<string, string>> };

export async function evaluateMobileStoreReleaseHealth(opts: {
  secretRuntime: SecretRuntime;
  smokeMode: { mode: "blocking" | "nonblocking" | "omitted" };
  assertHealthy: () => void;
}) {
  if (opts.smokeMode.mode === "omitted") {
    return { smokeOutcome: "omitted_by_exception" as const };
  }
  try {
    await opts.secretRuntime.enterStep("smoke");
    opts.assertHealthy();
    return { smokeOutcome: "passed" as const };
  } catch (error) {
    if (opts.smokeMode.mode !== "nonblocking") throw error;
    return {
      smokeOutcome: "failed_nonblocking" as const,
      smokeError: error instanceof Error ? error.message : String(error),
    };
  }
}
