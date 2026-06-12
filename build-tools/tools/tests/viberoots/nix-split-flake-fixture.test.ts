#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";

async function writeFile(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

test("viberoots Nix fixture receives workspaceSrc outside viberoots source", async () => {
  await runInScratchTemp("viberoots-nix-split", async (tmp, $) => {
    await writeFile(path.join(tmp, "workspace-marker"), "workspace\n");
    await writeFile(path.join(tmp, "viberoots/own-source-marker"), "viberoots\n");
    await writeFile(
      path.join(tmp, "viberoots/flake.nix"),
      `{
  outputs = { self }: {
    lib.mkWorkspace = { workspaceSrc, viberootsInput ? self, ... }: {
      workspacePath = builtins.toString workspaceSrc;
      viberootsPath = builtins.toString viberootsInput.outPath;
      splitRoots = builtins.toString workspaceSrc != builtins.toString viberootsInput.outPath;
      workspaceHasMarker = builtins.pathExists (workspaceSrc + "/workspace-marker");
      viberootsHasOwnMarker = builtins.pathExists (viberootsInput.outPath + "/own-source-marker");
      workspaceHasOwnMarker = builtins.pathExists (workspaceSrc + "/own-source-marker");
    };
  };
}
`,
    );
    await writeFile(
      path.join(tmp, "flake.nix"),
      `{
  inputs.viberoots.url = "path:./viberoots";
  outputs = { self, viberoots }: {
    probe = viberoots.lib.mkWorkspace {
      workspaceSrc = ./.;
      viberootsInput = viberoots;
    };
  };
}
`,
    );
    await $({ cwd: tmp })`git init -q`;
    await $({
      cwd: tmp,
    })`git add flake.nix workspace-marker viberoots/flake.nix viberoots/own-source-marker`;

    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix eval --json --accept-flake-config ${`path:${tmp}#probe`}`;
    const probe = JSON.parse(String(result.stdout || "{}"));
    assert.equal(probe.splitRoots, true);
    assert.equal(probe.workspaceHasMarker, true);
    assert.equal(probe.viberootsHasOwnMarker, true);
    assert.equal(probe.workspaceHasOwnMarker, false);
    assert.notEqual(probe.workspacePath, probe.viberootsPath);
  });
});
