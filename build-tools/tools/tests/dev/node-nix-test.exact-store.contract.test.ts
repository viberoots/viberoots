#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node_nix_test prepares and forwards exact pnpm stores into nix builds", async () => {
  const rule = await fsp.readFile("build-tools/node/private/nix_test.bzl", "utf8");
  if (!rule.includes("prepare-exact-pnpm-store.ts")) {
    throw new Error("node_nix_test must prepare an exact pnpm store before nix build");
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
  if (!rule.includes("nix-build-filtered-flake.ts")) {
    throw new Error("node_nix_test must build through the filtered flake helper");
  }
  if (rule.includes('nix build "path:$FLK_ROOT#node-test.')) {
    throw new Error(
      "node_nix_test must not build node-test attrs from a live path:$FLK_ROOT flake ref",
    );
  }
});
