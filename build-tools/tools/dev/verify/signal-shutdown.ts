import process from "node:process";

function signalExitCode(sig: NodeJS.Signals): number {
  return sig === "SIGINT" ? 130 : 143;
}

export function installVerifySignalHandlers(
  requestShutdown: (sig: NodeJS.Signals) => Promise<void>,
): void {
  let forceExitTimer: ReturnType<typeof setTimeout> | null = null;
  const signalHandler = (sig: NodeJS.Signals) => {
    const exitCode = signalExitCode(sig);
    forceExitTimer ??= setTimeout(() => {
      process.stderr.write(`[verify] forcing exit after ${sig} cleanup timeout\n`);
      process.exit(exitCode);
    }, 30_000);
    void requestShutdown(sig).finally(() => {
      if (forceExitTimer) {
        clearTimeout(forceExitTimer);
        forceExitTimer = null;
      }
      process.exit(exitCode);
    });
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    try {
      process.once(sig, () => signalHandler(sig));
    } catch {}
  }
}
