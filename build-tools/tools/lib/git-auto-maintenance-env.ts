type EnvLike = Record<string, string | undefined>;

const DISABLED_GIT_AUTO_MAINTENANCE_CONFIG: readonly [string, string][] = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
  ["gc.autoDetach", "false"],
];

function parseGitConfigCount(value: string | undefined): number {
  const count = Number(String(value ?? "").trim());
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

export function gitAutoMaintenanceDisabledEnvEntries(
  env: EnvLike = process.env,
): Record<string, string> {
  const start = parseGitConfigCount(env.GIT_CONFIG_COUNT);
  const out: Record<string, string> = {
    GIT_CONFIG_COUNT: String(start + DISABLED_GIT_AUTO_MAINTENANCE_CONFIG.length),
  };
  DISABLED_GIT_AUTO_MAINTENANCE_CONFIG.forEach(([key, value], index) => {
    const slot = start + index;
    out[`GIT_CONFIG_KEY_${slot}`] = key;
    out[`GIT_CONFIG_VALUE_${slot}`] = value;
  });
  return out;
}

export function withGitAutoMaintenanceDisabledEnv<T extends EnvLike>(env: T): T {
  return {
    ...env,
    ...gitAutoMaintenanceDisabledEnvEntries(env),
  };
}

export function gitAutoMaintenanceDisabledTestEnvArgs(env: EnvLike = process.env): string[] {
  const complete = withGitAutoMaintenanceDisabledEnv(env);
  const count = parseGitConfigCount(complete.GIT_CONFIG_COUNT);
  const entries: [string, string][] = [["GIT_CONFIG_COUNT", String(count)]];
  for (let slot = 0; slot < count; slot++) {
    for (const kind of ["KEY", "VALUE"] as const) {
      const key = `GIT_CONFIG_${kind}_${slot}`;
      const value = complete[key];
      if (typeof value === "string") entries.push([key, value]);
    }
  }
  return entries.flatMap(([key, value]) => ["--env", `${key}=${value}`]);
}
