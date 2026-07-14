#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { repairGeneratedWorkspaceLock } from "../../lib/workspace-lock-repair";
import { lock, withWorkspace, writeLock } from "./workspace-lock-repair.test-helpers";

test("workspace lock repair keeps generated filtered input references stable", async () => {
  await withWorkspace("vbr-filtered-input-lock", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const filtered = path.join(generated, "viberoots-flake-input");
    await fsp.mkdir(path.join(filtered, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(filtered, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(path.join(filtered, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:./viberoots-flake-input"; outputs = _: {}; }\n`,
      "utf8",
    );
    const current = lock(workspace, "sha256-old");
    current.nodes.viberoots.locked.path = filtered;
    current.nodes.viberoots.original.path = filtered;
    const candidate = lock(workspace, "sha256-old");
    candidate.nodes.viberoots.locked.path = filtered;
    candidate.nodes.viberoots.original.path = "./viberoots-flake-input";
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT = filtered;
    await writeLock(lockFile, current);

    let metadataCalls = 0;

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: {
        execFile: async () => {
          metadataCalls += 1;
          return {
            stdout: JSON.stringify({ locks: candidate }),
            stderr: "",
          };
        },
      },
    });

    assert.equal(metadataCalls, 1, "stale absolute input must still run metadata repair");
    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    assert.match(
      await fsp.readFile(path.join(generated, "flake.nix"), "utf8"),
      /viberoots\.url = "path:\.\/viberoots-flake-input";/,
    );
    const repaired = JSON.parse(await fsp.readFile(lockFile, "utf8"));
    assert.equal(repaired.nodes.viberoots.locked.path, "./viberoots-flake-input");
    assert.equal(repaired.nodes.viberoots.locked.narHash, undefined);
    assert.equal(repaired.nodes.viberoots.original.path, "./viberoots-flake-input");
    assert.deepEqual(repaired.nodes.viberoots.parent, []);
    await fsp.stat(path.join(filtered, ".source-fingerprint"));
  });
});

test("workspace lock repair skips metadata for a normalized filtered input", async () => {
  await withWorkspace("vbr-filtered-input-fresh", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const filtered = path.join(generated, "viberoots-flake-input");
    await fsp.mkdir(path.join(filtered, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(filtered, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(path.join(filtered, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:./viberoots-flake-input"; outputs = _: {}; }\n`,
      "utf8",
    );
    const current = lock(workspace, "sha256-unused");
    current.nodes.viberoots.locked = {
      type: "path",
      path: "./viberoots-flake-input",
    };
    current.nodes.viberoots.original = {
      type: "path",
      path: "./viberoots-flake-input",
    };
    current.nodes.viberoots.parent = [];
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT = filtered;
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: {
        execFile: async () => {
          throw new Error("metadata should not run for normalized filtered input");
        },
      },
    });

    assert.deepEqual(result, { status: "fresh" });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), current);
  });
});
