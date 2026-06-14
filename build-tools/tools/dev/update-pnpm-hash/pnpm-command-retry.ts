type RetryOpts = {
  attempts?: number;
  delayMs?: number;
  log?: (message: string) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runPnpmCommandWithRetry(
  command: string,
  run: () => Promise<void>,
  opts: RetryOpts = {},
): Promise<void> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = Math.max(0, opts.delayMs ?? 15_000);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      opts.log?.(`[lockfile] pnpm ${command} failed; retrying (${attempt + 1}/${attempts})`);
      await sleep(delayMs);
    }
  }
}
