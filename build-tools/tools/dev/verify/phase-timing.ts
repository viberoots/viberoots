export type VerifyPhaseTimer = {
  setLogFile: (logFile: string | null) => Promise<void>;
  timedPhase: <T>(name: string, run: () => Promise<T>) => Promise<T>;
};

export function createVerifyPhaseTimer(opts: {
  appendLine: (logFile: string | null, line: string) => Promise<void>;
}): VerifyPhaseTimer {
  let phaseLogFile: string | null = null;
  const bufferedPhaseLines: string[] = [];

  const recordPhaseTiming = async (name: string, durationMs: number) => {
    const line = `[verify] phase name=${name} duration_ms=${durationMs}`;
    if (phaseLogFile) {
      await opts.appendLine(phaseLogFile, line);
    } else {
      bufferedPhaseLines.push(line);
    }
  };

  return {
    setLogFile: async (logFile: string | null) => {
      phaseLogFile = logFile;
      for (const line of bufferedPhaseLines.splice(0)) {
        await opts.appendLine(phaseLogFile, line);
      }
    },
    timedPhase: async <T>(name: string, run: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await run();
      } finally {
        await recordPhaseTiming(name, Date.now() - started);
      }
    },
  };
}
