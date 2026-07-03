#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { workspaceFlakeRef } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function writeFile(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

async function runInNixTemp(name: string, fn: (tmp: string) => Promise<void>): Promise<void> {
  const root = path.resolve("buck-out/tmp", name);
  await fsp.mkdir(root, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(root, "case-"));
  try {
    await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

test("viberoots Nix fixture receives workspaceSrc outside viberoots source", async () => {
  await runInNixTemp("viberoots-nix-split", async (tmp) => {
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
    })`nix eval --json --accept-flake-config ${`path:${await workspaceFlakeRef(tmp)}#probe`}`;
    const probe = JSON.parse(String(result.stdout || "{}"));
    assert.equal(probe.splitRoots, true);
    assert.equal(probe.workspaceHasMarker, true);
    assert.equal(probe.viberootsHasOwnMarker, true);
    assert.equal(probe.workspaceHasOwnMarker, false);
    assert.notEqual(probe.workspacePath, probe.viberootsPath);
  });
});

test("real viberoots mkWorkspace exposes metadata for external workspace source", async () => {
  await runInNixTemp("viberoots-real-mkworkspace", async (tmp) => {
    const viberootsRoot = viberootsSourcePath(".");
    await writeFile(path.join(tmp, "workspace-marker"), "workspace\n");

    const result = await $({
      cwd: viberootsRoot,
      stdio: "pipe",
    })`nix eval --json --accept-flake-config ${`path:${viberootsRoot}#lib.mkWorkspace`} --apply ${`mk: (mk { workspaceSrc = ${tmp}; viberootsInput = { outPath = ./.; }; workspaceName = "external-probe"; }).lib`}`;
    const probe = JSON.parse(String(result.stdout || "{}"));
    assert.equal(probe.workspaceName, "external-probe");
    assert.equal(probe.version, "0.0.0-dev");
    assert.equal(probe.releaseTag, "v0.0.0-dev");
    assert.equal(probe.viberootsSourcePath, viberootsRoot);
  });
});
