#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";
import { inventoryBundleSource } from "../../dev/evaluation-bundle-manifest";
import { resolveToolPathSync } from "../../lib/tool-paths";

async function fixture(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, "projects", "app"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(root, "flake.lock"), "{}\n");
  await fsp.writeFile(path.join(root, "projects", "app", "main.ts"), "export const n = 1;\n");
  await fsp.writeFile(path.join(root, ".viberoots", "workspace", "buck", "graph.json"), "[]\n");
}

async function tempBundleDirs(tmp: string): Promise<string[]> {
  const parent =
    process.platform === "darwin" ? path.join(tmp, "vbr-evaluation-bundle.noindex") : tmp;
  return (await fsp.readdir(parent).catch(() => [] as string[])).filter((name) =>
    name.startsWith("vbr-evaluation-bundle-"),
  );
}

test("bundle manifests are identical for CoW and full-copy construction", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-parity-"));
  const captures: string[] = [];
  await fixture(root);
  const register = async (bundleRoot: string) => {
    const files = await inventoryBundleSource(bundleRoot);
    captures.push(JSON.stringify(files));
    return "/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle";
  };
  try {
    const none = await materializeEvaluationBundle(
      { stagedSource: root, attr: "graph-generator", classification: "hermetic" },
      { register, copyMode: "none" },
    );
    const cow = await materializeEvaluationBundle(
      { stagedSource: root, attr: "graph-generator", classification: "hermetic" },
      { register, copyMode: "try" },
    );
    assert.equal(cow.digest, none.digest);
    assert.equal(captures[1], captures[0]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("bundle construction rejects external symlinks and cleans failure roots", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-cleanup-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await fixture(root);
  await fsp.symlink("/etc/passwd", path.join(root, "projects", "app", "external"));
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle({
        stagedSource: root,
        attr: "graph-generator",
        classification: "hermetic",
      }),
      /external symlink: .*projects.*app.*external/,
    );
    assert.deepEqual(await tempBundleDirs(tmp), []);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("registration failure preserves its cause and cleans the owned root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-register-failure-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await fixture(root);
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle(
        { stagedSource: root, attr: "graph-generator", classification: "hermetic" },
        { register: async () => Promise.reject(new Error("registration timed out")) },
      ),
      /registration timed out/,
    );
    assert.deepEqual(await tempBundleDirs(tmp), []);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle construction rejects unsupported filesystem entries", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-unsupported-"));
  await fixture(root);
  const fifo = path.join(root, "projects", "app", "pipe");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveToolPathSync("mkfifo"), [fifo], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => (code === 0 ? resolve() : reject(new Error(`mkfifo ${code}`))));
  });
  try {
    await assert.rejects(inventoryBundleSource(root), /unsupported entry: projects\/app\/pipe/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("SIGTERM waits for construction and removes the owned root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-interrupt-"));
  const root = path.join(tmp, "source");
  await fixture(root);
  const fixturePath = fileURLToPath(
    new URL("./evaluation-bundle-interrupt.fixture.ts", import.meta.url),
  );
  const zxInit = fileURLToPath(new URL("../../dev/zx-init.mjs", import.meta.url));
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", zxInit, fixturePath, root],
      { env: { ...process.env, NODE_OPTIONS: "", TMPDIR: tmp }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("registration-ready")) child.kill("SIGTERM");
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
  try {
    assert.equal(result.code, 0);
    assert.match(result.stderr, /evaluation bundle interrupted by SIGTERM/);
    assert.deepEqual(await tempBundleDirs(tmp), []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle cleanup fails closed when ownership becomes ambiguous", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-owner-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await fixture(root);
  process.env.TMPDIR = tmp;
  try {
    const primary = new Error("registration failed");
    await assert.rejects(
      materializeEvaluationBundle(
        { stagedSource: root, attr: "graph-generator", classification: "hermetic" },
        {
          register: async (bundleRoot) => {
            const marker = path.join(
              path.dirname(bundleRoot),
              ".viberoots-evaluation-bundle-owner",
            );
            await fsp.writeFile(marker, "different owner\n");
            throw primary;
          },
        },
      ),
      (error) =>
        error === primary &&
        primary.cause instanceof Error &&
        /cleanup ownership is ambiguous/.test(primary.cause.message),
    );
    assert.equal((await tempBundleDirs(tmp)).length, 1);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
