#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { activateWorkspace } from "../../lib/workspace-activation";

async function workspace(prefix: string): Promise<string> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  await fsp.writeFile(
    path.join(root, "flake.nix"),
    '{ inputs.viberoots.url = "path:./viberoots"; outputs = _: {}; }\n',
    "utf8",
  );
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
  await fsp.mkdir(path.join(root, "viberoots"), { recursive: true });
  await fsp.writeFile(path.join(root, "viberoots", "flake.nix"), "{ outputs = _: {}; }\n");
  return root;
}

test("activateWorkspace keeps prior self dogfood current symlink before extraction", async () => {
  const root = await workspace("vbr-activate-self-current");
  try {
    await fsp.mkdir(path.join(root, ".viberoots"), { recursive: true });
    await fsp.symlink("..", path.join(root, ".viberoots", "current"));

    await activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } });

    assert.equal(await fsp.readlink(path.join(root, ".viberoots", "current")), "..");
    assert.equal(await fsp.realpath(path.join(root, ".viberoots/current")), root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("activateWorkspace points current at extracted local tool tree", async () => {
  const root = await workspace("vbr-activate-local-extracted");
  try {
    await fsp.mkdir(path.join(root, "viberoots", "build-tools"), { recursive: true });

    await activateWorkspace({ start: root, env: { WORKSPACE_ROOT: root } });

    assert.equal(await fsp.readlink(path.join(root, ".viberoots", "current")), "../viberoots");
    assert.equal(
      await fsp.realpath(path.join(root, ".viberoots/current")),
      path.join(root, "viberoots"),
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
