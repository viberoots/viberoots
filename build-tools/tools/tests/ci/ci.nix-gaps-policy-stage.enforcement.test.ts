#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("ci run-stage wires nix-gaps policy gate with canonical docs paths", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/run-stage.ts", "utf8");
  assert.ok(
    txt.includes('"nix-gaps-policy"'),
    "expected run-stage to expose a nix-gaps-policy stage",
  );
  assert.ok(
    txt.includes("nix-gaps-inventory-check.ts"),
    "expected nix-gaps-policy stage to invoke the policy checker script",
  );
  assert.ok(
    txt.includes("--starlark-api") &&
      txt.includes("docs/handbook/starlark-api.md") &&
      txt.includes("--nix-gaps") &&
      txt.includes("docs/handbook/nix-gaps.md") &&
      txt.includes("--exceptions") &&
      txt.includes("docs/handbook/nix-gaps-exceptions.json"),
    "expected nix-gaps-policy stage to use canonical docs path flags",
  );
});
