#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { repairSnapshotViberootsInput } from "../../dev/filtered-flake-viberoots-input";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";

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
    "flake.nix",
    '{ inputs.viberoots.url = "path:/tmp/random-live-source"; outputs = _: {}; }\n',
  );
  await write(
    root,
    "flake.lock",
    `${JSON.stringify({ nodes: { viberoots: { locked: {}, original: {} } } })}\n`,
  );
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
  const env = buildCanonicalArtifactEnvironment(process.cwd(), {
    artifactToolsRoot: canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
  });
  const storePath = await repairSnapshotViberootsInput({ snapDir: root, flakeDir, env });
  await assert.rejects(fsp.access(path.join(flakeDir, "viberoots-flake-input")), {
    code: "ENOENT",
  });
  assert.match(
    await fsp.readFile(path.join(flakeDir, "flake.nix"), "utf8"),
    new RegExp(`path:${storePath}`),
  );
  assert.match(
    await fsp.readFile(path.join(root, "flake.nix"), "utf8"),
    new RegExp(`path:${storePath}`),
  );
  const rootLock = JSON.parse(await fsp.readFile(path.join(root, "flake.lock"), "utf8"));
  assert.equal(rootLock.nodes.viberoots.locked.path, storePath);
  assert.equal(rootLock.nodes.viberoots.original.path, storePath);
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
  const remote = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-input-identity-remote-"));
  try {
    const firstStorePath = await makeConsumerSnapshot(first);
    const firstRegistration = await registrationTime(firstStorePath);
    assert.ok(firstRegistration > 0);

    const secondStorePath = await makeConsumerSnapshot(second);
    const secondRegistration = await registrationTime(secondStorePath);
    assert.equal(secondStorePath, firstStorePath);
    assert.equal(secondRegistration, firstRegistration);
    await fsp.access(path.join(secondStorePath, "build-tools", "untracked-sentinel.ts"));

    for (const prefix of ["", ".viberoots/workspace/"]) {
      await write(
        remote,
        `${prefix}flake.nix`,
        '{ inputs.viberoots.url = "git+file:///tmp/random-live-source"; outputs = _: {}; }\n',
      );
      await write(
        remote,
        `${prefix}flake.lock`,
        `${JSON.stringify({ nodes: { viberoots: { locked: {}, original: {} } } })}\n`,
      );
    }
    let materializedInput = "";
    const remoteStorePath = await repairSnapshotViberootsInput(
      {
        snapDir: remote,
        flakeDir: path.join(remote, ".viberoots", "workspace"),
        immutableInputRoot: firstStorePath,
        env: { ...process.env, VIBEROOTS_ROOT: "/tmp/hostile-live-root" },
      },
      {
        materializeInput: async (inputPath) => {
          materializedInput = inputPath;
          return {
            storePath: firstStorePath,
            locked: { narHash: "sha256-test", path: firstStorePath, type: "path" },
          };
        },
      },
    );
    assert.equal(materializedInput, firstStorePath);
    assert.equal(remoteStorePath, firstStorePath);
    for (const prefix of ["", ".viberoots/workspace/"]) {
      assert.doesNotMatch(
        await fsp.readFile(path.join(remote, `${prefix}flake.nix`), "utf8"),
        /tmp/,
      );
      const lock = JSON.parse(await fsp.readFile(path.join(remote, `${prefix}flake.lock`), "utf8"));
      assert.equal(lock.nodes.viberoots.locked.path, firstStorePath);
      assert.equal(lock.nodes.viberoots.original.path, firstStorePath);
    }
    await assert.rejects(
      repairSnapshotViberootsInput({
        snapDir: remote,
        flakeDir: remote,
        immutableInputRoot: "/tmp/not-an-immutable-source",
        env: process.env,
      }),
      /declared viberoots input is not an immutable Nix-store source/,
    );
  } finally {
    await fsp.rm(first, { recursive: true, force: true });
    await fsp.rm(second, { recursive: true, force: true });
    await fsp.rm(remote, { recursive: true, force: true });
  }
});
