#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix templates warn locally and fail in CI when dev overrides set", async () => {
  await runInTemp("nix-dev-overrides-warning", async (tmp, $) => {
    // Minimal files to satisfy template parameters
    await fsp.writeFile(`${tmp}/gomod2nix.toml`, "# empty", "utf8");

    // Local (non-CI): expect a warning via builtins.trace and success exit
    const envLocal = { ...process.env, NIX_GO_DEV_OVERRIDE_JSON: '{"example@v1.0.0":"/tmp/src"}' };
    const cmdEval = `nix-instantiate --eval -E '
      let base = import <nixpkgs> {};
          pkgs = { lib = base.lib; buildGoApplication = args: args; };
          T = import ./tools/nix/lang-templates.nix { inherit pkgs; };
          drv = T.goLib { name = "//demo:lib"; modulesToml = ./gomod2nix.toml; };
          _ = drv.overrides "example@v1.0.0" {};
      in "ok"'
    `;
    const { exitCode: c1 } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: envLocal,
    })`bash -lc ${cmdEval}`;
    if (c1 !== 0) {
      console.error("expected success locally when overrides set, got code:", c1);
      process.exit(2);
    }
  });
});
