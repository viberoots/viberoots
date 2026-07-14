#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { repairSnapshotViberootsInput } from "../../dev/filtered-flake-viberoots-input";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

async function makeConsumerSnapshot(root: string): Promise<string> {
  await write(
    root,
    "viberoots/flake.nix",
    '{ outputs = _: { marker = "stable-filtered-input"; }; }\n',
  );
  await write(root, "viberoots/build-tools/untracked-sentinel.ts", "export const sentinel = 1;\n");
  const flakeDir = path.join(root, ".viberoots", "workspace");
  await write(
    root,
    ".viberoots/workspace/flake.nix",
    '{ inputs.viberoots.url = "path:./viberoots-flake-input"; outputs = _: {}; }\n',
  );
  await write(
    root,
    ".viberoots/workspace/flake.lock",
    `${JSON.stringify({ nodes: { viberoots: { locked: {}, original: {} } } })}\n`,
  );
  const storePath = await repairSnapshotViberootsInput({ snapDir: root, flakeDir });
  await assert.rejects(fsp.access(path.join(flakeDir, "viberoots-flake-input")), {
    code: "ENOENT",
  });
  assert.match(
    await fsp.readFile(path.join(flakeDir, "flake.nix"), "utf8"),
    new RegExp(`path:${storePath}`),
  );
  const lock = JSON.parse(await fsp.readFile(path.join(flakeDir, "flake.lock"), "utf8"));
  assert.equal(lock.nodes.viberoots.locked.path, storePath);
  assert.equal(lock.nodes.viberoots.original.path, storePath);
  return storePath;
}

async function registrationTime(storePath: string): Promise<number> {
  const nixEnv = envWithResolvedNixBin(process.env);
  const nixBin = resolveToolPathSync("nix", nixEnv);
  const result = await $({
    env: nixEnv,
    stdio: "pipe",
  })`${nixBin} path-info --json-format 1 --json ${storePath}`;
  const info = JSON.parse(String(result.stdout || "{}"))[storePath];
  return Number(info?.registrationTime || 0);
}

test("independent consumer snapshots reuse one filtered viberoots store source", async () => {
  const first = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-input-identity-a-"));
  const second = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-input-identity-b-"));
  try {
    const firstStorePath = await makeConsumerSnapshot(first);
    const firstRegistration = await registrationTime(firstStorePath);
    assert.ok(firstRegistration > 0);

    const secondStorePath = await makeConsumerSnapshot(second);
    const secondRegistration = await registrationTime(secondStorePath);
    assert.equal(secondStorePath, firstStorePath);
    assert.equal(secondRegistration, firstRegistration);
    await fsp.access(path.join(secondStorePath, "build-tools", "untracked-sentinel.ts"));
  } finally {
    await fsp.rm(first, { recursive: true, force: true });
    await fsp.rm(second, { recursive: true, force: true });
  }
});
