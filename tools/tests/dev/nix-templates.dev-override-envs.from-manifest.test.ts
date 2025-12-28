#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function readJsonStdout(stdout: unknown): any {
  const raw = String(stdout || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    console.error("expected JSON on stdout, got:", raw);
    process.exit(2);
  }
}

test("nix templates resolve dev override env names from tools/lib/dev-override-envs.json (go/python/cpp)", async () => {
  await runInTemp("nix-templates-dev-override-envs-from-manifest", async (tmp, $) => {
    await fs.writeFile(path.join(tmp, "gomod2nix.toml"), "# empty\n", "utf8");

    const manifestPath = path.join(tmp, "tools", "lib", "dev-override-envs.json");
    const manifest = (await fs.readJSON(manifestPath)) as Record<string, string>;
    manifest.go = "NIX_FAKE_GO_DEV_OVERRIDE_JSON";
    manifest.python = "NIX_FAKE_PY_DEV_OVERRIDE_JSON";
    manifest.cpp = "NIX_FAKE_CPP_DEV_OVERRIDE_JSON";
    await fs.writeJSON(manifestPath, manifest, { spaces: 2 });

    const uv2nixAdapterStub = `{ pkgs, uv2nixLib ? null }:\nargs: args\n`;
    await fs.writeFile(
      path.join(tmp, "tools", "nix", "uv2nix-adapter.nix"),
      uv2nixAdapterStub,
      "utf8",
    );

    // Go: ensure the template's default env name comes from the manifest by verifying override src.
    {
      const env = {
        ...process.env,
        [manifest.go]: JSON.stringify({ "example@v1.0.0": "/tmp/src-go" }),
      };
      const cmd = `nix-instantiate --eval --strict --json -E '
        let
          base = import <nixpkgs> {};
          pkgs = {
            lib = base.lib;
            buildGoApplication = { overrides ? null, ... }@args: args;
          };
          T = import ./tools/nix/lang-templates.nix { inherit pkgs; };
          drv = T.goLib { name = "//demo:lib"; modulesToml = ./gomod2nix.toml; patchDirs = []; };
          out = (drv.overrides "example@v1.0.0" { src = "ORIG"; version = "v1.0.0"; }).src;
        in out
      '`;
      const res = await $({ cwd: tmp, stdio: "pipe", env })`bash --noprofile --norc -c ${cmd}`;
      const out = readJsonStdout(res.stdout);
      if (out !== "/tmp/src-go") {
        console.error(
          "expected Go template to read fake override env and return /tmp/src-go, got:",
          out,
        );
        process.exit(2);
      }
    }

    // Python: replace uv2nix adapter with a stub so evaluation stays small; check devOverrides payload.
    {
      const env = {
        ...process.env,
        [manifest.python]: JSON.stringify({ "example@v1.0.0": "/tmp/src-py" }),
      };
      const cmd = `nix-instantiate --eval --strict --json -E '
        let
          pkgs = import <nixpkgs> {};
          T = import ./tools/nix/templates/python.nix { inherit pkgs; uv2nixLib = {}; };
          drv = T.pyLib { name = "//demo:py"; lockfile = "uv.lock"; };
        in drv.devOverrides."example@v1.0.0"
      '`;
      const res = await $({ cwd: tmp, stdio: "pipe", env })`bash --noprofile --norc -c ${cmd}`;
      const out = readJsonStdout(res.stdout);
      if (out !== "/tmp/src-py") {
        console.error(
          "expected Python template to read fake override env and return /tmp/src-py, got:",
          out,
        );
        process.exit(2);
      }
    }

    // C++: use a minimal pkgs stub and check that devMap is non-empty when only the manifest-derived env is set.
    {
      const env = {
        ...process.env,
        [manifest.cpp]: JSON.stringify({ "pkgs.zlib": "/tmp/src-cpp" }),
      };
      const cmd = `nix-instantiate --eval --strict --json -E '
        let
          base = import <nixpkgs> {};
          pkgs = {
            lib = base.lib;
            llvmPackages = { clang = "/fake"; llvm = "/fake"; };
            nodejs = "/fake";
            nodejs_22 = "/fake";
          };
          C = import ./tools/nix/templates/cpp-common.nix { inherit pkgs; };
        in builtins.hasAttr "pkgs.zlib" C.devMap
      '`;
      const res = await $({ cwd: tmp, stdio: "pipe", env })`bash --noprofile --norc -c ${cmd}`;
      const out = readJsonStdout(res.stdout);
      if (out !== true) {
        console.error(
          "expected C++ template to read fake override env and populate devMap, got:",
          out,
        );
        process.exit(2);
      }
    }
  });
});
