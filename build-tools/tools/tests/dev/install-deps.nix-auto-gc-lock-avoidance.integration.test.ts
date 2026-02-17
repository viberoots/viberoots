#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install deps nix calls disable per-invocation auto-GC lock waits", async () => {
  const hashNix = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/nix.ts", "utf8");
  if (!hashNix.includes('"min-free"') || !hashNix.includes('"max-free"')) {
    throw new Error("update-pnpm-hash/nix.ts must disable min-free/max-free for nix build calls");
  }
  if (!hashNix.includes("activeNixGcPids()")) {
    throw new Error("update-pnpm-hash/nix.ts must detect active nix store gc and fail fast");
  }

  const depsMain = await fsp.readFile("build-tools/tools/dev/install/deps-main.ts", "utf8");
  if (!depsMain.includes("importer ${imp}: realizing+linking node_modules")) {
    throw new Error("deps-main.ts must delegate node_modules realization to link-node");
  }
  if (depsMain.includes("--print-build-logs")) {
    throw new Error("deps-main.ts must not run duplicate node-modules nix builds");
  }

  const linkNode = await fsp.readFile("build-tools/tools/dev/install/link-node.ts", "utf8");
  if (!linkNode.includes('"min-free"') || !linkNode.includes('"max-free"')) {
    throw new Error("link-node.ts nix builds must disable min-free/max-free");
  }
  if (!linkNode.includes("nixGcLockMessage")) {
    throw new Error(
      "link-node.ts must fail fast with actionable message when nix store gc is active",
    );
  }

  const nixShell = await fsp.readFile("build-tools/lang/nix_shell.bzl", "utf8");
  if (!nixShell.includes("--option min-free 0 --option max-free 0")) {
    throw new Error("nix_shell.bzl nix build helper must disable min-free/max-free");
  }
});
