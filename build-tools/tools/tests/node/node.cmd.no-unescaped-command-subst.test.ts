#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function hasUnescapedCommandSubst(s: string): boolean {
  const withoutBuckLocations = s.replace(/\$\(location [^)]+\)/g, "");
  return /(^|[^$])\$\(/.test(withoutBuckLocations);
}

test("node macros do not emit unescaped $(...) command substitutions in assembled cmd", async () => {
  const defsStage = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/node/defs_stage.bzl"),
    "utf8",
  );
  assert.match(
    defsStage,
    /nix_action_build_selected_out_path_cmd\([\s\S]*?escape_cmd_subst = True,/,
    "node stage selected-build helper must escape shell substitutions for Buck parsing",
  );

  await runInTemp("node-cmd-no-unescaped-subst", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "# stub\n", "utf8");
    await fsp.writeFile(path.join(appDir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage", "node_wasm_inline_module", "node_webapp", "nix_node_cli_bin")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_asset_stage(",
        '  name = "staged",',
        '  app = ":bundle",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "inline_wasm",',
        '  src = "src/input.wasm",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(path.join(appDir, "src", "input.wasm"), "00", "utf8");

    const probeApp = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:bundle`;
    assert.equal(probeApp.exitCode, 0, String(probeApp.stderr || ""));
    const cmdApp = String(probeApp.stdout || "");
    assert.match(cmdApp, /\$\(location workspace_buck\/\/:graph\.json\b/);
    assert.ok(!hasUnescapedCommandSubst(cmdApp), "node_webapp cmd contains unescaped $(...)");

    const probeCli = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:tool`;
    assert.equal(probeCli.exitCode, 0, String(probeCli.stderr || ""));
    const cmdCli = String(probeCli.stdout || "");
    assert.ok(
      !hasUnescapedCommandSubst(cmdCli),
      "nix_node_cli_bin(bundle=True) cmd contains unescaped $(...)",
    );

    for (const target of ["staged", "inline_wasm"] as const) {
      const probe = await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd ${`//projects/apps/web:${target}`}`;
      assert.equal(probe.exitCode, 0, String(probe.stderr || ""));
      assert.ok(
        !hasUnescapedCommandSubst(String(probe.stdout || "")),
        `${target} cmd contains unescaped $(...)`,
      );
    }
  });
});
