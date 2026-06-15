#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

const startupCheckScript = new URL("../../dev/startup-check.ts", import.meta.url).pathname;

test("startup-check enforces nix-store toolchain paths", async () => {
  const res = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      STARTUP_CHECK_ALLOW_NON_NIX_STORE: "",
    },
  })`zx-wrapper ${startupCheckScript}`.nothrow();
  assert.equal(
    res.exitCode,
    0,
    `expected startup-check to pass, got exit=${res.exitCode}\n${res.stdout}\n${res.stderr}`,
  );
  const out = String(res.stdout || "");
  assert.match(out, /startup-check: OK/);
});
