#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  commandSitePolicyPath,
  defsStageStandalone,
  exceptionsPath,
  inventoryStandaloneRoute,
  inventoryWrapperRoute,
  scriptPath,
  writeNodeRouteFixture,
} from "./nix-gaps-inventory-check.node-route-fixture";

function checkerCommand(tmp: string) {
  return {
    cwd: tmp,
    env: { ...process.env, VIBEROOTS_SOURCE_ROOT: path.join(tmp, "route-source") },
  };
}

test("nix-gaps checker accepts standalone stage/inline route when docs and implementation match", async () => {
  await runInTemp("nix-gaps-node-route-standalone-pass", async (tmp, $) => {
    await writeNodeRouteFixture(tmp, { inventory: inventoryStandaloneRoute });
    await $(
      checkerCommand(tmp),
    )`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath} --command-site-policy ${commandSitePolicyPath}`;
  });
});

test("nix-gaps checker rejects standalone routes that bypass the canonical selected-build helper", async () => {
  await runInTemp("nix-gaps-node-route-helper-missing", async (tmp, $) => {
    await writeNodeRouteFixture(tmp, {
      inventory: inventoryStandaloneRoute,
      defsStage: defsStageStandalone.replaceAll(
        "nix_action_build_selected_out_path_cmd(",
        "noncanonical_selected_build(",
      ),
    });
    const res = await $({
      ...checkerCommand(tmp),
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath} --command-site-policy ${commandSitePolicyPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /canonical|selected-build|standalone nix-calling/);
  });
});

test("nix-gaps checker fails when docs claim wrapper route but stage/inline implementation is standalone", async () => {
  await runInTemp("nix-gaps-node-route-mismatch-fail", async (tmp, $) => {
    await writeNodeRouteFixture(tmp, { inventory: inventoryWrapperRoute });
    const res = await $({
      ...checkerCommand(tmp),
      stdio: "pipe",
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath} --command-site-policy ${commandSitePolicyPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /docs\/implementation mismatch/);
  });
});
