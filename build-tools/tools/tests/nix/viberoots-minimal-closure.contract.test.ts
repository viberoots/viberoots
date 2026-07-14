#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("minimal shell closure leaves node_modules on explicit materialization attrs", async () => {
  const context = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/per-system-context.nix"),
    "utf8",
  );
  const packages = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/packages/default.nix"),
    "utf8",
  );
  const nodeMods = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/packages/node-mods.nix"),
    "utf8",
  );
  assert.doesNotMatch(context, /devshell = import[\s\S]*inherit[^;]*viberootsNodeModules/);
  assert.doesNotMatch(packages, /viberootsCommand = import[\s\S]*viberootsNodeModules/);
  assert.match(nodeMods, /node-modules\s*=/);
  assert.match(nodeMods, /nodeMods\.mkNodeModules/);
});

test("shell entry probes existing node_modules and install materializes only after metadata", async () => {
  const linker = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/devshell-link-node-modules.ts"),
    "utf8",
  );
  const install = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/install/deps-main.ts"),
    "utf8",
  );
  assert.doesNotMatch(linker, /nix\s+build|runManagedCommand|withResolvedFinalPnpmStore/);
  assert.match(linker, /if \(!outPath\) return;/);

  const metadataCommand = install.indexOf("const updateCmd =");
  const materializeCommand = install.indexOf('"tools/dev/install/link-node.ts"');
  assert.ok(metadataCommand >= 0, "expected install metadata command");
  assert.ok(materializeCommand >= 0, "expected explicit node_modules materializer");
  assert.ok(
    metadataCommand < materializeCommand,
    "install must validate committed metadata before explicit node_modules materialization",
  );
});
