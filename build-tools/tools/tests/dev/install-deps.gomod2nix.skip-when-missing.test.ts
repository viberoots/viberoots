#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runGomod2nixGenerateIn } from "../../dev/install/gomod2nix";
import { runInTemp } from "../lib/test-helpers";

test("install-deps gomod2nix skips when go.mod and go.sum missing", async () => {
  await runInTemp("install-deps-skip", async (tmp) => {
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
    try {
      await runGomod2nixGenerateIn(tmp, true, true);
    } finally {
      console.log = originalLog;
    }
    const out = output.join("\n");
    if (!out.includes("[gomod2nix] skip: no go.mod or go.sum present")) {
      console.error("expected skip message when no go.mod or go.sum");
      process.exit(2);
    }
  });
});
