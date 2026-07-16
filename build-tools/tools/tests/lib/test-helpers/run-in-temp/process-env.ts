let envMutationQueue: Promise<void> = Promise.resolve();
export async function withTempProcessEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prevGate = envMutationQueue;
  let releaseGate: (() => void) | null = null;
  envMutationQueue = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  await prevGate;
  const keys = Array.from(new Set(Object.keys(overrides)));
  const prev: Record<string, string | undefined> = {};
  for (const key of keys) prev[key] = process.env[key];
  for (const key of keys) {
    const next = overrides[key];
    if (typeof next === "string") process.env[key] = next;
    else delete process.env[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const val = prev[key];
      if (typeof val === "string") process.env[key] = val;
      else delete process.env[key];
    }
    releaseGate?.();
  }
}
