#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writePostCloneWorkspaceLock } from "../../lib/post-clone-workspace-lock";
import { findRepoRoot } from "../../lib/repo";
import { envWithResolvedNixBin, resolveToolPathSync } from "../../lib/tool-paths";
import { workspaceFlakeInputs } from "../../lib/workspace-flake-inputs";
import { execManaged } from "./test-helpers/managed-exec";

function generatedWorkspaceFlake(viberoots: string): string {
  return `{
${workspaceFlakeInputs(`path:${viberoots}`)}

  outputs = inputs: { proof = builtins.concatStringsSep "," (builtins.attrNames inputs); };
}
`;
}

test("cold post-clone lock evaluates offline solely from preserved immutable nodes", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "post-clone-lock-cold-"));
  t.after(async () => await fsp.rm(root, { recursive: true, force: true }));
  const repoRoot = await findRepoRoot(process.cwd());
  const nixEnv = envWithResolvedNixBin({
    ...process.env,
    NIX_CONFIG:
      "experimental-features = nix-command flakes\nsubstituters =\nbuilders =\nconnect-timeout = 1",
  });
  const nix = resolveToolPathSync("nix", nixEnv);
  const authoritativeText = await fsp.readFile(path.join(repoRoot, "flake.lock"), "utf8");
  const authoritative = JSON.parse(authoritativeText);
  const viberootsNode = authoritative.nodes[authoritative.nodes.root.inputs.viberoots];
  const blockedNetworkEnv = {
    ...nixEnv,
    http_proxy: "http://127.0.0.1:9",
    https_proxy: "http://127.0.0.1:9",
    all_proxy: "http://127.0.0.1:9",
    no_proxy: "",
  };
  await fsp.writeFile(path.join(root, "flake.lock"), authoritativeText, "utf8");
  const workspace = path.join(root, ".viberoots", "workspace");
  const filteredInput = path.join(workspace, "viberoots-flake-input");
  await fsp.mkdir(filteredInput, { recursive: true });
  await fsp.copyFile(
    path.join(repoRoot, "viberoots", "flake.nix"),
    path.join(filteredInput, "flake.nix"),
  );
  const workspaceFlake = generatedWorkspaceFlake("./viberoots-flake-input");
  assert.match(workspaceFlake, /gomod2nix\.url = "github:nix-community\/gomod2nix";/);
  assert.doesNotMatch(
    workspaceFlake,
    new RegExp(`path:${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  await fsp.writeFile(path.join(workspace, "flake.nix"), workspaceFlake, "utf8");

  await writePostCloneWorkspaceLock({
    workspaceRoot: root,
    localInputPath: "./viberoots-flake-input",
  });
  const lockFile = path.join(workspace, "flake.lock");
  const derivedText = await fsp.readFile(lockFile, "utf8");
  const derived = JSON.parse(derivedText);
  for (const [name, node] of Object.entries(authoritative.nodes)) {
    if (node !== viberootsNode) assert.deepEqual(derived.nodes[name], node);
  }
  const { stdout } = await execManaged(
    nix,
    [
      "eval",
      "--offline",
      "--no-use-registries",
      "--no-write-lock-file",
      "--raw",
      `path:${workspace}#proof`,
    ],
    { cwd: root, env: blockedNetworkEnv },
  );
  assert.match(stdout, /buck2,.*gomod2nix,.*nixpkgs,.*nixpkgs_23_11,.*viberoots/);
  assert.equal(await fsp.readFile(lockFile, "utf8"), derivedText);
});
