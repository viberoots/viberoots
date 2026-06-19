#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

const startupCheckScript = new URL("../../dev/startup-check.ts", import.meta.url).pathname;

await runInTemp("startup-check-toolchain-paths-nix-store", async (_tmp, $) => {
  const res = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      STARTUP_CHECK_ALLOW_NON_NIX_STORE: "",
    },
  })`${process.execPath || "node"} ${startupCheckScript}`.nothrow();
  assert.equal(
    res.exitCode,
    0,
    `expected startup-check to pass, got exit=${res.exitCode}\n${res.stdout}\n${res.stderr}`,
  );
  const out = String(res.stdout || "");
  assert.match(out, /startup-check: OK/);
});
