#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readTool(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(`viberoots/build-tools/tools/${rel}`), "utf8");
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(file: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await fsp.readFile(file, "utf8").catch(() => "");
    if (last.trim()) return last.trim();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${file}; last=${last}`);
}

async function waitForDead(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected pid ${pid} to exit`);
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for child exit")),
      timeoutMs,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test("run-runnable child commands are isolated and terminated as a process group", async () => {
  const source = await readTool("dev/run-runnable-core.ts");
  assert.match(source, /detached:\s*true/);
  assert.match(source, /process\.kill\(-child\.pid,\s*signal\)/);
  assert.match(source, /process\.once\("SIGINT",\s*\(\)\s*=>\s*forwardSignal\("SIGINT"\)\)/);
  assert.match(source, /process\.once\("SIGTERM",\s*\(\)\s*=>\s*forwardSignal\("SIGTERM"\)\)/);
  assert.match(source, /process\.once\("SIGHUP",\s*\(\)\s*=>\s*forwardSignal\("SIGHUP"\)\)/);
  assert.match(source, /signalChildGroup\(child,\s*"SIGKILL"\)/);
});

test("dev-with-wasm-watch cleans up child groups on shell teardown", async () => {
  const source = await readTool("dev/dev-with-wasm-watch.ts");
  assert.match(source, /process\.once\("SIGINT",\s*\(\)\s*=>\s*stopAll\("SIGINT"\)\)/);
  assert.match(source, /process\.once\("SIGTERM",\s*\(\)\s*=>\s*stopAll\("SIGTERM"\)\)/);
  assert.match(source, /process\.once\("SIGHUP",\s*\(\)\s*=>\s*stopAll\("SIGHUP"\)\)/);
  assert.match(source, /process\.once\("exit",[\s\S]*killGroup\(vite,\s*"SIGTERM"\)/);
  assert.match(
    source,
    /await waitForInitialWasmSync[\s\S]*catch \(error\)[\s\S]*stopAll\("SIGTERM"\)/,
  );
  assert.match(source, /if \(vite\) killGroup\(vite,\s*signal\)/);
});

test("run-runnable runCommand reaps child process group on SIGTERM", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "run-command-cleanup-"));
  const grandchildPidFile = path.join(tmp, "grandchild.pid");
  const helper = path.join(tmp, "helper.mjs");
  const runRunnableCore = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/run-runnable-core.ts",
  );
  await fsp.writeFile(
    helper,
    [
      `import { runCommand } from ${JSON.stringify(pathToFileURL(runRunnableCore).href)};`,
      `const pidFile = ${JSON.stringify(grandchildPidFile)};`,
      "const script = `node -e \"require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)\" ${pidFile} & wait`;",
      "const code = await runCommand(['bash', '--noprofile', '--norc', '-lc', script], [], process.cwd());",
      "process.exit(code);",
      "",
    ].join("\n"),
    "utf8",
  );
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--experimental-top-level-await",
      "--disable-warning=ExperimentalWarning",
      "--import",
      viberootsSourcePath("viberoots/build-tools/tools/dev/zx-init.mjs"),
      helper,
    ],
    { cwd: tmp, stdio: "ignore" },
  );
  try {
    const grandchildPid = Number(await waitForFile(grandchildPidFile, 10_000));
    assert.ok(pidAlive(grandchildPid), `expected grandchild ${grandchildPid} to be alive`);
    child.kill("SIGTERM");
    await waitForExit(child, 10_000);
    await waitForDead(grandchildPid, 10_000);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
