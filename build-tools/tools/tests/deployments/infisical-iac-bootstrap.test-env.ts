export async function withTempWorkspace<T>(
  dir: string,
  run: () => Promise<T>,
  opts: { configPath?: string; clearConfig?: boolean } = {},
) {
  const cwd = process.cwd();
  const old = {
    config: process.env.SPRINKLEREF_CONFIG,
    workspaceRoot: process.env.WORKSPACE_ROOT,
    liveRoot: process.env.LIVE_ROOT,
  };
  process.chdir(dir);
  process.env.WORKSPACE_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  if (opts.clearConfig) delete process.env.SPRINKLEREF_CONFIG;
  if (opts.configPath) process.env.SPRINKLEREF_CONFIG = opts.configPath;
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    restoreEnv("SPRINKLEREF_CONFIG", old.config);
    restoreEnv("WORKSPACE_ROOT", old.workspaceRoot);
    restoreEnv("LIVE_ROOT", old.liveRoot);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
