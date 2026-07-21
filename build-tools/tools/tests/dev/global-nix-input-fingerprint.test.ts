#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { globalNixInputFingerprint } from "../../dev/global-nix-input-fingerprint";

test("global Nix input fingerprint tracks every canonical action authority", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "global-nix-input-fingerprint-"));
  try {
    const activeTools = path.join(root, ".viberoots", "current", "build-tools", "tools");
    await fsp.mkdir(path.join(activeTools, "dev"), { recursive: true });
    await fsp.mkdir(path.join(activeTools, "nix"), { recursive: true });
    await fsp.writeFile(path.join(activeTools, "dev", "zx-init.mjs"), "// active source\n");

    const inputs = [
      ".viberoots/workspace/buck/graph.json",
      ".viberoots/workspace/flake.lock",
      ".viberoots/workspace/flake.nix",
      ".viberoots/workspace/nixpkgs-source-registry-extension.nix",
      ".viberoots/workspace/TARGETS",
      "projects/config/node-modules.hashes.json",
      "projects/config/TARGETS",
      ".viberoots/current/build-tools/tools/nix/nixpkgs-source-registry.nix",
    ];
    let previous = await globalNixInputFingerprint(root);
    for (const relative of inputs) {
      const file = path.join(root, relative);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, `${relative}\n`);
      const current = await globalNixInputFingerprint(root);
      assert.notEqual(current, previous, `${relative} must affect the global input fingerprint`);
      assert.equal(await globalNixInputFingerprint(root), current);
      previous = current;
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
