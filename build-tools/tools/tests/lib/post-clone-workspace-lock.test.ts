#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  derivePostCloneWorkspaceLock,
  writePostCloneWorkspaceLock,
} from "../../lib/post-clone-workspace-lock";
import { workspaceFlakeInputs } from "../../lib/workspace-flake-inputs";

const rootLock = {
  nodes: {
    root: {
      inputs: {
        buck2: "buck2",
        gomod2nix: "gomod2nix",
        nixpkgs: "nixpkgs",
        nixpkgs_23_11: "nixpkgs_23_11",
        viberoots: "viberoots",
      },
    },
    buck2: {
      locked: { narHash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", type: "github" },
    },
    gomod2nix: {
      inputs: { nixpkgs: ["nixpkgs"] },
      locked: { narHash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", type: "github" },
    },
    nixpkgs: {
      locked: { narHash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", type: "github" },
    },
    nixpkgs_23_11: {
      locked: { narHash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", type: "github" },
    },
    viberoots: {
      inputs: { buck2: ["buck2"], gomod2nix: ["gomod2nix"], nixpkgs: ["nixpkgs"] },
      locked: {
        narHash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        rev: "v",
        type: "git",
      },
      original: { rev: "v", type: "git", url: "https://example.invalid/viberoots" },
    },
  },
  root: "root",
  version: 7,
};

function workspaceFlake(localInputPath: string): string {
  return `{
${workspaceFlakeInputs(`path:${localInputPath}`)}

  outputs = inputs: { inherit inputs; };
}
`;
}

test("post-clone derives the workspace lock solely from committed authority", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "post-clone-lock-"));
  t.after(async () => await fsp.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, ".viberoots", "workspace");
  const input = path.join(workspace, "viberoots-flake-input");
  await fsp.mkdir(input, { recursive: true });
  await fsp.writeFile(path.join(root, "flake.lock"), JSON.stringify(rootLock));
  await fsp.writeFile(path.join(workspace, "flake.nix"), workspaceFlake("./viberoots-flake-input"));
  await fsp.writeFile(path.join(input, "flake.nix"), "{}\n");

  await writePostCloneWorkspaceLock({
    workspaceRoot: root,
    localInputPath: "./viberoots-flake-input",
  });
  const actual = JSON.parse(await fsp.readFile(path.join(workspace, "flake.lock"), "utf8"));
  for (const name of ["root", "buck2", "gomod2nix", "nixpkgs", "nixpkgs_23_11"]) {
    assert.deepEqual(actual.nodes[name], rootLock.nodes[name]);
  }
  assert.deepEqual(actual.nodes.viberoots, {
    inputs: rootLock.nodes.viberoots.inputs,
    locked: { path: "./viberoots-flake-input", type: "path" },
    original: { path: "./viberoots-flake-input", type: "path" },
    parent: [],
  });
  for (const invalid of [
    workspaceFlake("./viberoots-flake-input").replace(
      workspaceFlakeInputs("path:./viberoots-flake-input"),
      `/*\n${workspaceFlakeInputs("path:./viberoots-flake-input")}\n*/`,
    ),
    workspaceFlake("./viberoots-flake-input").replace("  inputs = {", "  prefixed.inputs = {"),
    workspaceFlake("./viberoots-flake-input").replace(
      workspaceFlakeInputs("path:./viberoots-flake-input"),
      `  nested = {\n${workspaceFlakeInputs("path:./viberoots-flake-input")}\n  };`,
    ),
    `{
  outputs = outer:
    let
${workspaceFlakeInputs("path:./viberoots-flake-input")}
    in inputs;
}
`,
    `${workspaceFlake("./viberoots-flake-input")}\n${workspaceFlakeInputs("path:./viberoots-flake-input")}\n`,
  ]) {
    await fsp.writeFile(path.join(workspace, "flake.nix"), invalid);
    await assert.rejects(
      writePostCloneWorkspaceLock({
        workspaceRoot: root,
        localInputPath: "./viberoots-flake-input",
      }),
      /canonical input block|direct top-level assignment/,
    );
  }
  assert.deepEqual(
    JSON.parse(await fsp.readFile(path.join(workspace, "flake.lock"), "utf8")),
    actual,
  );
});

test("post-clone lock derivation fails closed on missing topology or mutable paths", () => {
  const storeLock = derivePostCloneWorkspaceLock({
    rootLockText: JSON.stringify(rootLock),
    workspaceFlakeDir: "/workspace/.viberoots/workspace",
    localInputPath: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
  });
  assert.deepEqual(storeLock.nodes.viberoots.locked, {
    narHash: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    path: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
    type: "path",
  });
  assert.throws(
    () =>
      derivePostCloneWorkspaceLock({
        rootLockText: JSON.stringify({ ...rootLock, nodes: {} }),
        workspaceFlakeDir: "/workspace/.viberoots/workspace",
        localInputPath: "./viberoots-flake-input",
      }),
    /incompatible root topology/,
  );
  assert.throws(
    () =>
      derivePostCloneWorkspaceLock({
        rootLockText: JSON.stringify(rootLock),
        workspaceFlakeDir: "/workspace/.viberoots/workspace",
        localInputPath: "/tmp/live-checkout",
      }),
    /not canonical/,
  );
  for (const input of ["buck2", "gomod2nix", "nixpkgs", "nixpkgs_23_11"] as const) {
    const incompatible = structuredClone(rootLock);
    const nodeName = incompatible.nodes.root.inputs[input];
    (incompatible.nodes as Record<string, unknown>)[nodeName] = undefined;
    assert.throws(
      () =>
        derivePostCloneWorkspaceLock({
          rootLockText: JSON.stringify(incompatible),
          workspaceFlakeDir: "/workspace/.viberoots/workspace",
          localInputPath: "./viberoots-flake-input",
        }),
      new RegExp(`no locked ${input} input`),
    );
  }
  const incompatibleFollow = structuredClone(rootLock);
  incompatibleFollow.nodes.viberoots.inputs.nixpkgs = ["other"];
  assert.throws(
    () =>
      derivePostCloneWorkspaceLock({
        rootLockText: JSON.stringify(incompatibleFollow),
        workspaceFlakeDir: "/workspace/.viberoots/workspace",
        localInputPath: "./viberoots-flake-input",
      }),
    /incompatible viberoots nixpkgs follow/,
  );
});
