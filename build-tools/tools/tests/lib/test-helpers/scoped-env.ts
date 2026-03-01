type EnvValue = string | undefined;

export async function withScopedEnv<T>(
  entries: Record<string, EnvValue>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, EnvValue> = {};
  for (const [k, v] of Object.entries(entries)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
