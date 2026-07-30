import * as fsp from "node:fs/promises";
import path from "node:path";
import { parsePublicBuildOutPath } from "../lib/test-helpers/public-build";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";

export type TauriConsumerFixture = {
  consumer: string;
  sourcePath: string;
  authoringEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  artifactEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

export async function buildTauriOutPath(
  consumer: string,
  env: NodeJS.ProcessEnv,
  target: string,
  $: typeof globalThis.$,
): Promise<string> {
  const result = await $({ cwd: consumer, env, stdio: "pipe" })`b ${target} --show-output`;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return parsePublicBuildOutPath(`${stdout}\n${stderr}`, target, consumer);
}

export async function makeTauriCompositionConsumer(
  tmp: string,
  sourceRoot: string,
  $: typeof globalThis.$,
): Promise<TauriConsumerFixture> {
  const source = await makeRemoteSource(tmp, $);
  const consumer = await makeConsumer(tmp, "tauri-composition-consumer", source, $);
  const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
  for (let attempt = 0; attempt < 2; attempt++) {
    await $({
      cwd: consumer,
      env: { ...process.env, WORKSPACE_ROOT: consumer, VBR_NIX_CACHE_POLICY: "off" },
      stdio: "pipe",
    })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
  }
  const sourcePath = await fsp.realpath(path.join(consumer, ".viberoots", "current"));
  for (const relative of [
    "projects/apps/tauri-composition-app",
    "projects/libs/tauri-composition-providers",
  ]) {
    await fsp.mkdir(path.dirname(path.join(consumer, relative)), { recursive: true });
    await fsp.cp(path.join(sourceRoot, relative), path.join(consumer, relative), {
      recursive: true,
    });
  }
  const baseEnv = (extra: NodeJS.ProcessEnv = {}) => ({
    ...commandEnv(consumer, extra),
    VBR_NIX_CACHE_POLICY: "auto",
  });
  const authoringEnv = (extra: NodeJS.ProcessEnv = {}) => ({
    ...baseEnv(extra),
    VIBEROOTS_FLAKE_INPUT_ROOT: sourcePath,
  });
  const artifactEnv = (extra: NodeJS.ProcessEnv = {}) => {
    const env = baseEnv(extra);
    delete env.VIBEROOTS_FLAKE_INPUT_ROOT;
    return env;
  };
  await $({ cwd: consumer, env: authoringEnv() })`git config user.email test@example.com`;
  await $({ cwd: consumer, env: authoringEnv() })`git config user.name test`;
  await $({ cwd: consumer, env: authoringEnv() })`git add projects`;
  await $({ cwd: consumer, env: authoringEnv() })`git commit -m tauri-composition-fixture`;
  await $({ cwd: consumer, env: authoringEnv(), stdio: "inherit" })`u`;
  await $({
    cwd: consumer,
    env: authoringEnv(),
    stdio: "inherit",
  })`i --without-secrets`;
  return { consumer, sourcePath, authoringEnv, artifactEnv };
}
