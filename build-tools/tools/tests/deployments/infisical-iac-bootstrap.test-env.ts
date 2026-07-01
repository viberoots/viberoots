import * as fs from "node:fs";
import * as path from "node:path";

export async function withTempWorkspace<T>(
  dir: string,
  run: () => Promise<T>,
  opts: { configPath?: string; clearConfig?: boolean } = {},
) {
  const cwd = process.cwd();
  const old = {
    config: process.env.SPRINKLEREF_CONFIG,
    workspaceRoot: process.env.WORKSPACE_ROOT,
    devshellRoot: process.env._VIBEROOTS_DEVSHELL_ROOT,
    liveRoot: process.env.LIVE_ROOT,
    viberootsRoot: process.env.VIBEROOTS_ROOT,
    viberootsSourceRoot: process.env.VIBEROOTS_SOURCE_ROOT,
    viberootsFlakeInputRoot: process.env.VIBEROOTS_FLAKE_INPUT_ROOT,
  };
  process.chdir(dir);
  process.env.WORKSPACE_ROOT = dir;
  process.env._VIBEROOTS_DEVSHELL_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  const sourceRoot = resolveSourceRoot(cwd);
  process.env.VIBEROOTS_ROOT = sourceRoot;
  process.env.VIBEROOTS_SOURCE_ROOT = sourceRoot;
  process.env.VIBEROOTS_FLAKE_INPUT_ROOT = sourceRoot;
  if (opts.clearConfig) delete process.env.SPRINKLEREF_CONFIG;
  if (opts.configPath) process.env.SPRINKLEREF_CONFIG = opts.configPath;
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    restoreEnv("SPRINKLEREF_CONFIG", old.config);
    restoreEnv("WORKSPACE_ROOT", old.workspaceRoot);
    restoreEnv("_VIBEROOTS_DEVSHELL_ROOT", old.devshellRoot);
    restoreEnv("LIVE_ROOT", old.liveRoot);
    restoreEnv("VIBEROOTS_ROOT", old.viberootsRoot);
    restoreEnv("VIBEROOTS_SOURCE_ROOT", old.viberootsSourceRoot);
    restoreEnv("VIBEROOTS_FLAKE_INPUT_ROOT", old.viberootsFlakeInputRoot);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function resolveSourceRoot(cwd: string) {
  for (const candidate of [
    process.env.VIBEROOTS_SOURCE_ROOT,
    process.env.VIBEROOTS_ROOT,
    path.join(cwd, "viberoots"),
    cwd,
  ]) {
    if (
      candidate &&
      fs.existsSync(path.join(candidate, "build-tools", "tools", "dev", "zx-init.mjs"))
    ) {
      return candidate;
    }
  }
  throw new Error("could not resolve viberoots source root for temp workspace");
}
