#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node planner: lockfile label parsing is strict and deterministic (single ok, multiple fail)", async () => {
  await runInTemp("planner-node-lockfile-labels", async (tmp, $) => {
    // Ensure the importer lockfile exists (node-modules plumbing expects it to exist at eval time).
    await fsp.mkdir(path.join(tmp, "projects", "apps", "web"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "projects", "apps", "web", "pnpm-lock.yaml"),
      "# lockfile\n",
      "utf8",
    );

    const exprOk = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        nodes = [
          {
            name = "//projects/apps/web:cli";
            labels = [ "lang:node" "kind:bin" "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web" ];
            deps = [];
            srcs = [];
          }
        ];
        ctx = {
          inherit lib pkgs nodes;
          repoRoot = ./.;
          get = n: k: if builtins.hasAttr k n then n.\${k} else null;
          pkgPathOf = name: "projects/apps/web";
          modulesTomlFor = name: null;
        };
        plugin = (import ./viberoots/build-tools/tools/nix/planner/node.nix { inherit lib; }) ctx;
        drv = plugin.mkApp "//projects/apps/web:cli";
      in drv.version
    `;
    const ok = await $({ cwd: tmp, stdio: "pipe" })`nix eval --impure --raw --expr ${exprOk}`;
    assert.equal(String(ok.stdout || "").trim(), "projects-apps-web");

    const exprMulti = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        nodes = [
          {
            name = "//projects/apps/web:cli";
            labels = [
              "lang:node"
              "kind:bin"
              "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"
              "lockfile:projects/apps/api/pnpm-lock.yaml#projects/apps/api"
            ];
            deps = [];
            srcs = [];
          }
        ];
        ctx = {
          inherit lib pkgs nodes;
          repoRoot = ./.;
          get = n: k: if builtins.hasAttr k n then n.\${k} else null;
          pkgPathOf = name: "projects/apps/web";
          modulesTomlFor = name: null;
        };
        plugin = (import ./viberoots/build-tools/tools/nix/planner/node.nix { inherit lib; }) ctx;
      in (plugin.mkApp "//projects/apps/web:cli").version
    `;
    const bad = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`nix eval --impure --raw --expr ${exprMulti}`;
    assert.notEqual(
      bad.exitCode,
      0,
      "expected nix eval to fail when multiple lockfile labels are present",
    );
    const combined = String(bad.stderr || "") + String(bad.stdout || "");
    assert.ok(
      combined.includes("expected exactly one lockfile:<path>#<importer>"),
      `expected deterministic multiple-label error; got:\n${combined}`,
    );
    assert.ok(
      combined.includes("//projects/apps/web:cli"),
      `expected error to mention target name; got:\n${combined}`,
    );
  });
});
