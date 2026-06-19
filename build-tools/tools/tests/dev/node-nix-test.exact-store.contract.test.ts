#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

test("node_nix_test prepares and forwards exact pnpm stores into nix builds", async () => {
  const rule = await fsp.readFile(
    buildToolPath(process.cwd(), "node/private/nix_test.bzl"),
    "utf8",
  );
  if (!rule.includes("prepare-exact-pnpm-store.ts")) {
    throw new Error("node_nix_test must prepare an exact pnpm store before nix build");
  }
  if (!rule.includes("WORKSPACE_ROOT_ENV_ARG")) {
    throw new Error("node_nix_test must source the declared workspace-root.env input");
  }
  if (!rule.includes('cd \\"$WORKSPACE_ROOT\\"') && !rule.includes('cd "$WORKSPACE_ROOT"')) {
    throw new Error("node_nix_test must prepare exact stores from the consumer workspace root");
  }
  if (rule.includes('cd "$FLK_ROOT" && node') && rule.includes("prepare-exact-pnpm-store.ts")) {
    throw new Error("node_nix_test must not prepare project lockfile stores from FLK_ROOT");
  }
  if (!rule.includes("export NIX_PNPM_EXACT_STORE=")) {
    throw new Error(
      "node_nix_test must export NIX_PNPM_EXACT_STORE for downstream fixed-store builds",
    );
  }
  if (!rule.includes("export NIX_PNPM_FETCH_TIMEOUT=")) {
    throw new Error("node_nix_test must align exact-store fetch timeout with the test budget");
  }
  if (!rule.includes("exact-store must be a /nix/store path")) {
    throw new Error("node_nix_test must require exact stores to be realized in /nix/store");
  }
  if (!rule.includes("EXACT_PNPM_STORE_RAW=") || !rule.includes("/^\\\\/nix\\\\/store\\\\//")) {
    throw new Error("node_nix_test must parse the exact store path from noisy helper output");
  }
  if (!rule.includes("nix-build-filtered-flake.ts")) {
    throw new Error("node_nix_test must build through the filtered flake helper");
  }
  if (!rule.includes("$VIBEROOTS_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts")) {
    throw new Error("node_nix_test must build through the VIBEROOTS_ROOT filtered flake helper");
  }
  if (rule.includes("$FLK_ROOT/viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts")) {
    throw new Error("node_nix_test must not load filtered flake tooling from FLK_ROOT");
  }
  if (rule.includes("$FLK_ROOT/viberoots/build-tools/tools/dev/zx-init.mjs")) {
    throw new Error("node_nix_test must not load zx-init from FLK_ROOT");
  }
  if (!rule.includes('name \\"*.test.tsx\\"')) {
    throw new Error("node_nix_test must treat .test.tsx files as real tests");
  }
  if (rule.includes('nix build "path:$FLK_ROOT#node-test.')) {
    throw new Error(
      "node_nix_test must not build node-test attrs from a live path:$FLK_ROOT flake ref",
    );
  }
});
