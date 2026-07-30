import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { exactDescendantCommandPids } from "../lib/process-tree";
import { parsePublicBuildOutPath } from "../lib/test-helpers/public-build";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";
import { readPinnedSubmoduleConsumerLock } from "./rust.tauri-submodule-lock.fixture";

const execFileAsync = promisify(execFile);
type SourceMode = "flake" | "submodule";

async function processRows() {
  const result = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="]);
  return result.stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4],
    }));
}

async function activateSubmodule(
  consumer: string,
  source: string,
  workspaceFlake: string,
  $: typeof globalThis.$,
): Promise<void> {
  const pinnedConsumerLock = await readPinnedSubmoduleConsumerLock(workspaceFlake);
  await $({
    cwd: consumer,
    env: {
      ...process.env,
      GIT_ALLOW_PROTOCOL: "file",
      WORKSPACE_ROOT: consumer,
      VBR_NIX_CACHE_POLICY: "off",
    },
    stdio: "pipe",
  })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- use-submodule --workspace-root ${consumer} --url file://${source} --trust-url --no-direnv`;
  await fsp.writeFile(path.join(workspaceFlake, "flake.lock"), pinnedConsumerLock);
  assert.equal(
    await fsp.readFile(path.join(workspaceFlake, "flake.lock"), "utf8"),
    pinnedConsumerLock,
    "submodule activation did not restore the reviewed consumer lock",
  );
  assert.match(
    await fsp.readFile(path.join(consumer, ".gitmodules"), "utf8"),
    /file:\/\/\/nix\/store\//,
  );
  assert.equal(
    await fsp.realpath(path.join(consumer, ".viberoots", "current")),
    path.join(consumer, "viberoots"),
  );
  assert.match(
    await fsp.readFile(path.join(workspaceFlake, "flake.nix"), "utf8"),
    /path:\.\/viberoots-flake-input/,
  );
  await $({
    cwd: consumer,
    env: {
      ...commandEnv(consumer),
      GIT_ALLOW_PROTOCOL: "file",
      VBR_NIX_CACHE_POLICY: "off",
    },
  })`viberoots init-consumer --mode submodule --workspace-root ${consumer} --source viberoots --no-direnv`;
}

async function stopProduction(childPid: number): Promise<void> {
  try {
    process.kill(-childPid, "SIGTERM");
  } catch {
    // The child may already have completed its own cleanup.
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await processRows()).some((row) => row.pgid === childPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    process.kill(-childPid, "SIGKILL");
  } catch {
    // Nothing remains to terminate.
  }
  assert.equal(
    (await processRows()).some((row) => row.pgid === childPid),
    false,
    "Tauri production process group survived cleanup",
  );
}

export async function runTauriScaffoldLifecycle(
  tmp: string,
  mode: SourceMode,
  $: typeof globalThis.$,
): Promise<void> {
  const source = await makeRemoteSource(tmp, $);
  const consumer = await makeConsumer(tmp, `tauri-scaffold-${mode}`, source, $);
  const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
  let productionPid: number | undefined;
  try {
    if (mode === "submodule") await activateSubmodule(consumer, source, workspaceFlake, $);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await $({
        cwd: consumer,
        env: { ...process.env, WORKSPACE_ROOT: consumer, VBR_NIX_CACHE_POLICY: "off" },
        stdio: "pipe",
      })`nix run --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
    }
    if (mode === "submodule") {
      const filteredInput = path.join(workspaceFlake, "viberoots-flake-input");
      await fsp.access(path.join(filteredInput, ".source-fingerprint"));
      assert.equal(
        await fsp.readFile(path.join(filteredInput, "build-tools/tools/dev/viberoots.ts"), "utf8"),
        await fsp.readFile(
          path.join(consumer, "viberoots", "build-tools/tools/dev/viberoots.ts"),
          "utf8",
        ),
      );
      const sourcePrelude = await fsp.realpath(path.join(consumer, "viberoots", "prelude"));
      await fsp.rm(path.join(workspaceFlake, "prelude"), { recursive: true, force: true });
      await fsp.symlink(sourcePrelude, path.join(workspaceFlake, "prelude"));
      await fsp.access(path.join(workspaceFlake, "prelude", "prelude.bzl"));
      await fsp.rm(path.join(consumer, ".envrc"), { force: true });
    }
    const sourcePath = await fsp.realpath(path.join(consumer, ".viberoots", "current"));
    assert.equal(
      mode === "submodule"
        ? sourcePath === path.join(consumer, "viberoots")
        : sourcePath !== source,
      true,
      `${mode} source authority was not activated`,
    );
    const lifecycleEnv = (extra: NodeJS.ProcessEnv = {}) => ({
      ...commandEnv(consumer, extra),
      VBR_NIX_CACHE_POLICY: "auto",
    });
    await $({
      cwd: consumer,
      env: lifecycleEnv(),
    })`scaf new rust tauri-app tauri_demo --yes`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git config user.email test@example.com`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git config user.name test`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git add projects`;
    if (mode === "submodule") {
      await $({ cwd: consumer, env: lifecycleEnv() })`git add .gitmodules viberoots`;
    }
    await $({ cwd: consumer, env: lifecycleEnv() })`git commit -m tauri-scaffold`;
    const updateEnv =
      mode === "flake" ? lifecycleEnv({ VIBEROOTS_FLAKE_INPUT_ROOT: sourcePath }) : lifecycleEnv();
    await $({ cwd: consumer, env: updateEnv })`u`;
    const beforeInstall = await $({ cwd: consumer, env: lifecycleEnv(), stdio: "pipe" })`
      git diff --binary HEAD
    `;
    await $({ cwd: consumer, env: updateEnv })`i --without-secrets`;
    const afterInstall = await $({ cwd: consumer, env: lifecycleEnv(), stdio: "pipe" })`
      git diff --binary HEAD
    `;
    assert.equal(
      String(afterInstall.stdout),
      String(beforeInstall.stdout),
      "i changed tracked bytes",
    );

    const target = "//projects/apps/tauri_demo:tauri_demo";
    const built = await $({
      cwd: consumer,
      env: lifecycleEnv(),
      stdio: "pipe",
    })`b ${target} --show-output`;
    const outPath = parsePublicBuildOutPath(
      `${String(built.stdout)}\n${String(built.stderr)}`,
      target,
      consumer,
    );
    const testQuery = await $({
      cwd: consumer,
      env: lifecycleEnv(),
      stdio: "pipe",
    })`buck2 cquery --target-platforms prelude//platforms:default --json --output-attribute default_features //projects/apps/tauri_demo:tauri_demo-test`;
    const testNodes = Object.values(
      JSON.parse(String(testQuery.stdout)) as Record<string, { default_features?: boolean }>,
    );
    assert.equal(
      testNodes.length === 1 && testNodes[0]?.default_features === false,
      true,
      "generated Tauri test did not export default_features=False",
    );
    try {
      await $({
        cwd: consumer,
        env: lifecycleEnv(),
      })`v //projects/apps/tauri_demo:tauri_demo-test`;
    } catch (error) {
      const verifyLogDir = path.join(consumer, ".viberoots", "workspace", "buck", "verify-logs");
      const logs = await fsp.readdir(verifyLogDir).catch(() => []);
      const candidates = await Promise.all(
        logs.map(async (name) => ({
          name,
          mtime: (await fsp.stat(path.join(verifyLogDir, name))).mtimeMs,
        })),
      );
      const latest = candidates.sort((a, b) => b.mtime - a.mtime)[0];
      if (latest) {
        const text = await fsp.readFile(path.join(verifyLogDir, latest.name), "utf8");
        console.error(`[tauri-lifecycle] nested verify log ${latest.name}\n${text}`);
      }
      throw error;
    }
    const manifest = JSON.parse(
      await fsp.readFile(
        path.join(outPath, "share/viberoots-tauri/artifact-manifest.json"),
        "utf8",
      ),
    );
    const appExecutable = String(manifest.appExecutable || "");
    await fsp.access(appExecutable);
    const child = spawn("p", [target], {
      cwd: consumer,
      env: lifecycleEnv(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    productionPid = child.pid;
    const deadline = Date.now() + 120_000;
    let exactPids: number[] = [];
    while (child.pid && Date.now() < deadline) {
      exactPids = exactDescendantCommandPids(await processRows(), child.pid, appExecutable);
      if (exactPids.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(exactPids.length > 0, "`p` did not launch the exact packaged Tauri executable");
  } finally {
    if (productionPid) await stopProduction(productionPid);
    await killBuckDaemonsForRepo(tmp, $);
  }
}
