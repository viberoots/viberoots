#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";
import { runCommand } from "../../dev/filtered-flake-command";
import { resolveToolPathSync } from "../../lib/tool-paths";

async function fixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(root, "flake.lock"), "{}\n");
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "buck", "graph.json"), "[]\n");
}

async function tempDirs(tmp: string, base: string, prefix: string): Promise<string[]> {
  const parent = process.platform === "darwin" ? path.join(tmp, `${base}.noindex`) : tmp;
  return (await fsp.readdir(parent).catch(() => [] as string[])).filter((name) =>
    name.startsWith(prefix),
  );
}

function processGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("SIGKILL owner death stops registration descendants and removes the owned root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-sigkill-"));
  const root = path.join(tmp, "source");
  await fixture(root);
  const fixturePath = fileURLToPath(
    new URL("./evaluation-bundle-interrupt.fixture.ts", import.meta.url),
  );
  const zxInit = fileURLToPath(new URL("../../dev/zx-init.mjs", import.meta.url));
  let processGroupId = 0;
  const result = await new Promise<{ signal: NodeJS.Signals | null }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", zxInit, fixturePath, root, "sigkill"],
      { env: { ...process.env, NODE_OPTIONS: "", TMPDIR: tmp }, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/registration-ready:(\d+)/);
      if (!match) return;
      processGroupId = Number(match[1]);
      child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("close", (_code, signal) => resolve({ signal }));
  });
  try {
    assert.equal(result.signal, "SIGKILL");
    assert.ok(processGroupId > 0);
    await waitUntil(
      async () =>
        !processGroupAlive(processGroupId) &&
        (await tempDirs(tmp, "vbr-evaluation-bundle", "vbr-evaluation-bundle-")).length === 0,
      15_000,
    );
  } finally {
    if (processGroupId > 0 && processGroupAlive(processGroupId)) {
      try {
        process.kill(-processGroupId, "SIGKILL");
      } catch {}
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("registration timeout stops its process group and cleans capture and bundle roots", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-timeout-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  let processGroupId = 0;
  await fixture(root);
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle(
        { stagedSource: root, attr: "graph-generator", classification: "hermetic" },
        {
          register: async (_bundleRoot, recordProcessGroup) => {
            await runCommand({
              command: resolveToolPathSync("bash"),
              args: ["--noprofile", "--norc", "-c", "trap '' TERM; while :; do sleep 1; done"],
              timeoutMs: 100,
              killGraceMs: 100,
              onSpawn: (pid) => {
                processGroupId = pid;
                recordProcessGroup(pid);
              },
            });
            return "/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle";
          },
        },
      ),
      /timed out after 100ms/,
    );
    assert.ok(processGroupId > 0);
    assert.equal(processGroupAlive(processGroupId), false);
    assert.deepEqual(await tempDirs(tmp, "vbr-evaluation-bundle", "vbr-evaluation-bundle-"), []);
    assert.deepEqual(await tempDirs(tmp, "viberoots-command", "vbr-command-"), []);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("registration PGID-record failure awaits shutdown before preserving the primary error", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-record-failure-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  let processGroupId = 0;
  await fixture(root);
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle(
        { stagedSource: root, attr: "graph-generator", classification: "hermetic" },
        {
          register: async (_bundleRoot, recordProcessGroup) => {
            await runCommand({
              command: resolveToolPathSync("bash"),
              args: ["--noprofile", "--norc", "-c", "trap '' TERM; while :; do sleep 1; done"],
              killGraceMs: 100,
              onSpawn: (pid) => {
                processGroupId = pid;
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
                recordProcessGroup(-1);
              },
            });
            return "/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle";
          },
        },
      ),
      /invalid evaluation bundle process group: -1/,
    );
    assert.ok(processGroupId > 0);
    assert.equal(processGroupAlive(processGroupId), false);
    assert.deepEqual(await tempDirs(tmp, "vbr-evaluation-bundle", "vbr-evaluation-bundle-"), []);
    assert.deepEqual(await tempDirs(tmp, "viberoots-command", "vbr-command-"), []);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
