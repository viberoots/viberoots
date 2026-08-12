#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { resolveToolPathSync } from "../../lib/tool-paths";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());

test("manifest evaluation emits Tauri desktop metadata only for Rust Tauri outputs", async () => {
  const root = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "tauri-manifest-"));
  try {
    const rust = path.join(root, "rust");
    const cpp = path.join(root, "cpp");
    const out = path.join(root, "out");
    await Promise.all([
      fsp.mkdir(path.join(rust, "bin"), { recursive: true }),
      fsp.mkdir(path.join(rust, "app", "desktop.app", "Contents", "MacOS"), { recursive: true }),
      fsp.mkdir(path.join(rust, "share/viberoots-tauri"), { recursive: true }),
      fsp.mkdir(path.join(cpp, "bin"), { recursive: true }),
      fsp.mkdir(out),
    ]);
    const appExecutable = path.join(rust, "app", "desktop.app", "Contents", "MacOS", "desktop");
    for (const executable of [
      path.join(rust, "bin/desktop"),
      appExecutable,
      path.join(cpp, "bin/tool"),
    ]) {
      await fsp.writeFile(executable, "#!/bin/sh\n");
      await fsp.chmod(executable, 0o755);
    }
    await fsp.writeFile(
      path.join(rust, "share/viberoots-tauri/artifact-manifest.json"),
      `${JSON.stringify({
        schema: "viberoots.tauri-artifact.v1",
        appExecutable,
        signature: {
          mode: "adhoc-platform",
          credentialed: false,
          teamIdentifier: null,
          signingIdentity: null,
          releaseSigned: false,
          releaseAdmitted: false,
        },
      })}\n`,
    );
    const jqPath = resolveToolPathSync("jq");
    const manifestPath = path.join(sourceRoot, "build-tools/tools/nix/planner/manifest.nix");
    const expression = `
      let
        lib = {
          attrValues = builtins.attrValues;
          concatStringsSep = builtins.concatStringsSep;
          mapAttrsToList = f: attrs:
            map (name: f name attrs.\${name}) (builtins.attrNames attrs);
        };
        pkgs = {
          jq = builtins.toPath ${JSON.stringify(path.dirname(path.dirname(jqPath)))};
          runCommand = _: _: script: { inherit script; };
        };
        result = import (builtins.toPath ${JSON.stringify(manifestPath)}) {
          inherit pkgs lib;
          repoRootStr = "."; devOverrideJSON = {}; devOverrideCppJSON = {};
          devOverridePyJSON = {}; isCI = true; suppressDevOverrideLog = true;
          goOutPaths = {}; nodeOutPaths = {};
          cppOutPaths = { "//cpp:tool" = ${JSON.stringify(cpp)}; };
          rustOutPaths = { "//rust:desktop" = ${JSON.stringify(rust)}; };
          rustRunnableMeta = { "//rust:desktop" = { kind = "tauri"; }; };
          modulesTomlFor = _: "/dev/null"; pkgPathOf = _: "";
          targetNameOf = _: ""; sanitize = value: builtins.replaceStrings [ "/" ":" ] [ "_" "_" ] value;
        };
      in result.all.script
    `;
    const evaluated = await $({ cwd: sourceRoot, stdio: "pipe" })`
      nix eval --impure --raw --expr ${expression}
    `;
    const script = path.join(root, "manifest.sh");
    await fsp.writeFile(script, String(evaluated.stdout));
    await $({ cwd: sourceRoot, env: { ...process.env, out } })`bash ${script}`;
    const entries = JSON.parse(await fsp.readFile(path.join(out, "manifest.json"), "utf8"));
    const byLabel = new Map(entries.map((entry: any) => [entry.label, entry]));
    assert.equal(byLabel.get("//rust:desktop")?.kind, "app");
    assert.equal(byLabel.get("//rust:desktop")?.runnable?.kind, "desktop-app");
    assert.equal(byLabel.get("//rust:desktop")?.runnable?.run?.prod?.argv?.[0], appExecutable);
    assert.equal(
      byLabel.get("//rust:desktop")?.runnable?.run?.dev?.argv?.[0],
      "viberoots-tauri-dev",
    );
    assert.equal(byLabel.get("//cpp:tool")?.kind, "bin");
    assert.equal(byLabel.get("//cpp:tool")?.runnable?.kind, "native-bin");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
