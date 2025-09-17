#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("install-deps gomod2nix integration writes deterministic gomod2nix.toml", async () => {
  await runInTemp("install-deps-integration", async (tmp, $) => {
    const goMod = ["module example.com/demo", "\ngo 1.22"].join("\n");
    await fsp.writeFile(path.join(tmp, "go.mod"), goMod, "utf8");
    // Run install-deps which invokes gomod2nix regeneration
    const env = {
      ...process.env,
      INSTALL_DEPS_GOMOD2NIX_BIN: "nix run github:nix-community/gomod2nix --",
    } as any;
    await $({
      cwd: tmp,
      stdio: "inherit",
      env,
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs ./tools/dev/install-deps.ts --verbose`;
    const first = await fsp.readFile(path.join(tmp, "gomod2nix.toml"), "utf8");
    // Run again; output should be stable
    await $({
      cwd: tmp,
      stdio: "inherit",
      env,
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs ./tools/dev/install-deps.ts --verbose`;
    const second = await fsp.readFile(path.join(tmp, "gomod2nix.toml"), "utf8");
    if (first !== second) {
      console.error("gomod2nix.toml not stable across runs");
      process.exit(2);
    }
  });
});
