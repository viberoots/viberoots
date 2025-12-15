#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("nix packages expose per-importer node-modules attr when importer exists", async () => {
  // If no apps/example importer exists, this test should still pass by skipping gracefully
  const importer = "apps/example";
  const attr = importer.replace(/[\/ :]+/g, "-");
  const { stdout: s1 } =
    await $`bash --noprofile --norc -c 'test -f ${importer}/pnpm-lock.yaml && echo yes || echo no'`;
  if (String(s1).trim() !== "yes") {
    console.log("skipping: no", `${importer}/pnpm-lock.yaml`);
    return;
  }
  const cmd = `nix eval --raw .#node-modules.${attr}.outPath --accept-flake-config`;
  const { stdout } = await $({ stdio: "pipe" })`bash --noprofile --norc -c ${cmd}`.nothrow();
  const out = String(stdout || "").trim();
  assert.ok(out.length > 0, "expected non-empty outPath for per-importer node-modules");
});
