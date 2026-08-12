import * as fsp from "node:fs/promises";
import path from "node:path";
import { parsePublicBuildOutPath } from "../lib/test-helpers/public-build";
import { timeDiagnosticAsync } from "../lib/test-helpers/timing";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";

export type TauriConsumerFixture = {
  consumer: string;
  sourcePath: string;
  authoringEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  artifactEnv: (extra?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

export type TauriDerivationIdentity = {
  drvPath: string;
  outPath: string;
};

export async function inspectTauriDerivationIdentity(
  consumer: string,
  env: NodeJS.ProcessEnv,
  target: string,
  $: typeof globalThis.$,
): Promise<TauriDerivationIdentity> {
  const result = await $({ cwd: consumer, env, stdio: "pipe" })`${[
    "build-selected",
    `--artifact-workspace-root=${consumer}`,
    "--target",
    target,
    "--source=path",
    "--print-derivation-identity",
  ]}`;
  const line = String(result.stdout || "")
    .trim()
    .split("\n")
    .findLast((candidate) => candidate.startsWith("{"));
  const identity = JSON.parse(line || "{}") as TauriDerivationIdentity;
  if (
    !/^\/nix\/store\/[a-z0-9]{32}-[^/]+\.drv$/.test(identity.drvPath) ||
    !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/.test(identity.outPath)
  ) {
    throw new Error(`invalid Tauri derivation identity for ${target}`);
  }
  console.log(
    `[tauri-derivation-identity] target=${target} drv=${identity.drvPath} out=${identity.outPath}`,
  );
  return identity;
}

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
  const source = await timeDiagnosticAsync(
    "tauri composition remote source preparation",
    async () => makeRemoteSource(tmp, $),
  );
  const consumer = await timeDiagnosticAsync("tauri composition consumer preparation", async () =>
    makeConsumer(tmp, "tauri-composition-consumer", source, $),
  );
  const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
  await timeDiagnosticAsync("tauri composition workspace initialization", async () => {
    await $({
      cwd: consumer,
      env: { ...process.env, WORKSPACE_ROOT: consumer },
      stdio: "pipe",
    })`nix run --option eval-cache false --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
  });
  const sourcePath = await fsp.realpath(path.join(consumer, ".viberoots", "current"));
  await timeDiagnosticAsync("tauri composition project copy", async () => {
    for (const relative of [
      "projects/apps/tauri-composition-app",
      "projects/libs/tauri-composition-providers",
    ]) {
      await fsp.mkdir(path.dirname(path.join(consumer, relative)), { recursive: true });
      await fsp.cp(path.join(sourceRoot, relative), path.join(consumer, relative), {
        recursive: true,
      });
    }
  });
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
  await timeDiagnosticAsync("tauri composition Git fixture commit", async () => {
    await $({ cwd: consumer, env: authoringEnv() })`git config user.email test@example.com`;
    await $({ cwd: consumer, env: authoringEnv() })`git config user.name test`;
    await $({ cwd: consumer, env: authoringEnv() })`git add projects`;
    await $({ cwd: consumer, env: authoringEnv() })`git commit -m tauri-composition-fixture`;
  });
  await timeDiagnosticAsync("tauri composition workspace update", async () => {
    await $({
      cwd: consumer,
      env: authoringEnv({ TEST_TIMING: "1" }),
      stdio: "inherit",
    })`u`;
  });
  await timeDiagnosticAsync("tauri composition workspace install", async () => {
    await $({
      cwd: consumer,
      env: authoringEnv(),
      stdio: "inherit",
    })`i --without-secrets`;
  });
  return { consumer, sourcePath, authoringEnv, artifactEnv };
}
