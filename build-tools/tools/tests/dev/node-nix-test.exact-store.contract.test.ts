#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { buildToolPath } from "../../dev/dev-build/paths";

test("node_nix_test delegates final pnpm store materialization to the filtered build", async () => {
  const rule = await fsp.readFile(
    buildToolPath(process.cwd(), "node/private/nix_test.bzl"),
    "utf8",
  );
  if (!rule.includes("WORKSPACE_ROOT_ENV_ARG")) {
    throw new Error("node_nix_test must source the declared workspace-root.env input");
  }
  if (
    !rule.includes('GRAPH_ARG=\\"${1:-}\\"') ||
    !rule.includes('graph_json_path = "$GRAPH_ARG"')
  ) {
    throw new Error("node_nix_test must bind and validate its declared Buck graph input");
  }
  if (!rule.includes('"node_nix_test", ctx.attrs._graph_json, ctx.attrs._workspace_root_env')) {
    throw new Error("node_nix_test must pass graph and workspace authorities as fixed argv");
  }
  if (rule.includes("prepare-final-pnpm-store.ts") || rule.includes("_prepare_final_pnpm_store")) {
    throw new Error("node_nix_test must not carry a redundant final-store prewarm helper");
  }
  if (rule.includes("NIX_PNPM_EXACT_STORE")) {
    throw new Error("node_nix_test must not forward an impure exact-store environment path");
  }
  if (!rule.includes("export NIX_PNPM_FETCH_TIMEOUT=")) {
    throw new Error("node_nix_test must align final-store fetch timeout with the test budget");
  }
  if (!rule.includes("nix-build-filtered-flake.ts")) {
    throw new Error("node_nix_test must build through the filtered flake helper");
  }
  if (!rule.includes("COVERAGE_ARG=--coverage") || !rule.includes("unset COVERAGE")) {
    throw new Error("node_nix_test must convert coverage to explicit filtered-build argv");
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
