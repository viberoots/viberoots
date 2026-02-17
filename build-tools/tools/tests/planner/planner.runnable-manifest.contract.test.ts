#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { parseRunnableManifest } from "../../lib/runnables.ts";

test("planner manifest emits runnable entries for bin and webapp shapes", async () => {
  await runInTemp("planner-runnable-manifest", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        mkBin = pkgs.runCommand "bnx-bin" {} ''
          mkdir -p "$out/bin"
          cat > "$out/bin/demo" <<'EOF'
#!/usr/bin/env bash
echo demo
EOF
          chmod +x "$out/bin/demo"
        '';
        mkWeb = pkgs.runCommand "bnx-web" {} ''
          mkdir -p "$out/dist"
          echo "<html>ok</html>" > "$out/dist/index.html"
        '';
        mkLib = pkgs.runCommand "bnx-lib" {} ''
          mkdir -p "$out/lib"
          echo "ok" > "$out/lib/lib.txt"
        '';
        M = import ./build-tools/tools/nix/planner/manifest.nix {
          inherit pkgs lib;
          repoRootStr = builtins.toString ./.;
          devOverrideJSON = "";
          devOverrideCppJSON = "";
          devOverridePyJSON = "";
          isCI = false;
          suppressDevOverrideLog = true;
          overridePresentList = [];
          goOutPaths = { "//projects/libs/core:core" = mkLib; };
          cppOutPaths = { "//projects/apps/demo:demo" = mkBin; };
          nodeOutPaths = { "//projects/apps/web:web" = mkWeb; };
          nodeDevImporters = { "//projects/apps/web:web" = "projects/apps/web"; };
          modulesTomlFor = _: ./gomod2nix.toml;
          pkgPathOf = _: ".";
          targetNameOf = _: "demo";
          sanitize = s: "t";
        };
      in M.all
    `;
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build --impure --expr ${expr} --no-link --print-out-paths`;
    const outPath =
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    assert.ok(outPath, "expected nix build output path");
    const manifestPath = path.join(outPath, "manifest.json");
    const entries = parseRunnableManifest(await fsp.readFile(manifestPath, "utf8"));
    const byLabel = new Map(entries.map((e) => [e.label, e]));

    assert.equal(byLabel.get("//projects/apps/demo:demo")?.runnable?.kind, "native-bin");
    assert.equal(byLabel.get("//projects/apps/web:web")?.runnable?.kind, "webapp");
    assert.equal(byLabel.has("//projects/libs/core:core"), false);
    assert.deepEqual(byLabel.get("//projects/apps/web:web")?.runnable?.run.dev?.argv, [
      "pnpm",
      "--dir",
      "projects/apps/web",
      "dev",
    ]);
  });
});
