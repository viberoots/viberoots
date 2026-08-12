import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { exactDescendantCommandPids, processTreeRows } from "../lib/process-tree";
import { parsePublicBuildOutPath } from "../lib/test-helpers/public-build";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { timeDiagnosticAsync } from "../lib/test-helpers/timing";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { makeConsumer, makeRemoteSource } from "../viberoots/remote-consumer-fixture-helpers";
import { inspectTauriDerivationIdentity } from "./rust.tauri-consumer-fixture";
import { activateTauriSubmodule } from "./rust.tauri-scaffold-lifecycle-activation";
import { stopTauriProduction } from "./rust.tauri-scaffold-lifecycle-process";

type SourceMode = "flake" | "submodule";
const MAX_LAUNCH_OUTPUT_CHARS = 64 * 1024;

function appendBoundedOutput(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.length <= MAX_LAUNCH_OUTPUT_CHARS ? next : next.slice(-MAX_LAUNCH_OUTPUT_CHARS);
}

export async function runTauriScaffoldLifecycle(
  tmp: string,
  mode: SourceMode,
  $: typeof globalThis.$,
): Promise<void> {
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> =>
    await timeDiagnosticAsync(`tauri lifecycle ${mode} ${name}`, fn);
  const source = await phase(
    "remote source preparation",
    async () => await makeRemoteSource(tmp, $),
  );
  const consumer = await phase(
    "consumer preparation",
    async () => await makeConsumer(tmp, `tauri-scaffold-${mode}`, source, $),
  );
  const workspaceFlake = path.join(consumer, ".viberoots", "workspace");
  let productionPid: number | undefined;
  try {
    if (mode === "submodule") {
      await phase(
        "submodule activation",
        async () => await activateTauriSubmodule(consumer, source, workspaceFlake, $),
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await phase(`workspace initialization ${attempt + 1}`, async () => {
        await $({
          cwd: consumer,
          env: { ...process.env, WORKSPACE_ROOT: consumer },
          stdio: "pipe",
        })`nix run --option eval-cache false --accept-flake-config path:${workspaceFlake}#viberoots -- init-workspace`;
      });
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
    const lifecycleEnv = (extra: NodeJS.ProcessEnv = {}) => commandEnv(consumer, extra);
    await phase("scaffold generation", async () => {
      await $({
        cwd: consumer,
        env: lifecycleEnv(),
      })`scaf new rust tauri-app tauri_demo --yes`;
    });
    await $({ cwd: consumer, env: lifecycleEnv() })`git config user.email test@example.com`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git config user.name test`;
    await $({ cwd: consumer, env: lifecycleEnv() })`git add projects`;
    if (mode === "submodule") {
      await $({ cwd: consumer, env: lifecycleEnv() })`git add .gitmodules viberoots`;
    }
    await $({ cwd: consumer, env: lifecycleEnv() })`git commit -m tauri-scaffold`;
    const updateEnv = lifecycleEnv({
      TEST_TIMING: "1",
      ...(mode === "flake" ? { VIBEROOTS_FLAKE_INPUT_ROOT: sourcePath } : {}),
    });
    await phase("workspace update", async () => {
      await $({ cwd: consumer, env: updateEnv })`u`;
    });
    const beforeInstall = await $({ cwd: consumer, env: lifecycleEnv(), stdio: "pipe" })`
      git diff --binary HEAD
    `;
    await phase("workspace install", async () => {
      await $({ cwd: consumer, env: updateEnv })`i --without-secrets`;
    });
    const afterInstall = await $({ cwd: consumer, env: lifecycleEnv(), stdio: "pipe" })`
      git diff --binary HEAD
    `;
    assert.equal(
      String(afterInstall.stdout),
      String(beforeInstall.stdout),
      "i changed tracked bytes",
    );

    const target = "//projects/apps/tauri_demo:tauri_demo";
    await phase(
      "Tauri derivation identity",
      async () => await inspectTauriDerivationIdentity(consumer, lifecycleEnv(), target, $),
    );
    const built = await phase(
      "Tauri build",
      async () =>
        await $({
          cwd: consumer,
          env: lifecycleEnv(),
          stdio: "pipe",
        })`b ${target} --show-output`,
    );
    const outPath = parsePublicBuildOutPath(
      `${String(built.stdout)}\n${String(built.stderr)}`,
      target,
      consumer,
    );
    const testQuery = await phase(
      "generated target query",
      async () =>
        await $({
          cwd: consumer,
          env: lifecycleEnv(),
          stdio: "pipe",
        })`buck2 --isolation-dir tauri-scaffold-contract.noindex cquery --target-platforms prelude//platforms:default --json --output-attribute default_features //projects/apps/tauri_demo:tauri_demo-test`,
    );
    const testNodes = Object.values(
      JSON.parse(String(testQuery.stdout)) as Record<string, { default_features?: boolean }>,
    );
    assert.equal(
      testNodes.length === 1 && testNodes[0]?.default_features === false,
      true,
      "generated Tauri test did not export default_features=False",
    );
    try {
      await phase("nested verify", async () => {
        await $({
          cwd: consumer,
          // This nested verify runs one generated target that cannot create runInTemp fixtures.
          // The outer verify already prepared its shared seed; staging another complete seed here
          // only multiplies repository cloning and Git metadata work under suite fan-out.
          env: lifecycleEnv(),
        })`v --seed-mode=never //projects/apps/tauri_demo:tauri_demo-test`;
      });
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
    await phase("production launch", async () => {
      let launchOutput = "";
      let exited:
        | {
            code: number | null;
            signal: NodeJS.Signals | null;
          }
        | undefined;
      const child = spawn("p", [target], {
        cwd: consumer,
        env: lifecycleEnv(),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk) => {
        launchOutput = appendBoundedOutput(launchOutput, chunk);
      });
      child.stderr?.on("data", (chunk) => {
        launchOutput = appendBoundedOutput(launchOutput, chunk);
      });
      child.once("exit", (code, signal) => {
        exited = { code, signal };
      });
      productionPid = child.pid;
      const deadline = Date.now() + 120_000;
      let exactPids: number[] = [];
      while (child.pid && Date.now() < deadline) {
        exactPids = exactDescendantCommandPids(await processTreeRows(), child.pid, appExecutable);
        if (exactPids.length > 0) break;
        if (exited) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.ok(
        exactPids.length > 0,
        [
          "`p` did not launch the exact packaged Tauri executable",
          `appExecutable=${appExecutable}`,
          exited ? `p exited code=${exited.code} signal=${exited.signal}` : "p still running",
          launchOutput.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
  } finally {
    await phase("cleanup", async () => {
      if (productionPid) await stopTauriProduction(productionPid);
      await killBuckDaemonsForRepo(tmp, $);
    });
  }
}
