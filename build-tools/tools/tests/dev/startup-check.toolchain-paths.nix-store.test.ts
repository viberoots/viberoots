#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("startup-check enforces nix-store toolchain paths", async () => {
  const res = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      STARTUP_CHECK_ALLOW_NON_NIX_STORE: "",
    },
  })`zx-wrapper build-tools/tools/dev/startup-check.ts`.nothrow();
  assert.equal(
    res.exitCode,
    0,
    `expected startup-check to pass, got exit=${res.exitCode}\n${res.stdout}\n${res.stderr}`,
  );
  const out = String(res.stdout || "");
  assert.match(out, /startup-check: OK/);
});
