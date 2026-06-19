#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node nix build phases only relink node_modules when target differs", async () => {
  const webapp = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/node-webapp.nix",
    "utf8",
  );
  if (
    !webapp.includes(
      'if [ -L node_modules ] && [ "$(readlink node_modules)" = "$NM_TARGET" ]; then',
    )
  ) {
    throw new Error("node-webapp.nix must preserve node_modules symlink when already correct");
  }
  if (!webapp.includes("rm -rf node_modules")) {
    throw new Error("node-webapp.nix must replace node_modules only when target differs");
  }
  if (
    !webapp.includes(
      'if wr != "" then (builtins.path { path = builtins.toPath wr; name = "repo"; filter = filterRepo (builtins.toPath wr); }) else repoSnapshot;',
    )
  ) {
    throw new Error("node-webapp.nix must use WORKSPACE_ROOT-aware filtered repo snapshot");
  }

  const nodeTest = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/node-test-buildPhase.sh",
    "utf8",
  );
  if (
    !nodeTest.includes(
      'if [ -L node_modules ] && [ "$(readlink node_modules)" = "$NM_TARGET" ]; then',
    )
  ) {
    throw new Error("node-test buildPhase must preserve node_modules symlink when already correct");
  }
  if (!nodeTest.includes("rm -rf node_modules")) {
    throw new Error("node-test buildPhase must replace node_modules only when target differs");
  }
});
