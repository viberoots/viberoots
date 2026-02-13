#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function assertCmdInvariants(cmd: string, label: string, requiresOutPathCapture = true) {
  if (requiresOutPathCapture) {
    assert.ok(
      cmd.includes("--no-link --print-out-paths"),
      `${label}: expected nix build out-path capture (--no-link --print-out-paths)`,
    );
  }
  assert.ok(
    cmd.includes("BUCK_GRAPH_JSON="),
    `${label}: expected BUCK_GRAPH_JSON env export to be present`,
  );
  assert.ok(
    cmd.includes(". build-tools/tools/buck/workspace-root.env"),
    `${label}: expected workspace-root env sourcing for temp/sandboxed workspaces`,
  );
}

test("node Nix-calling macros use standardized command assembly helpers (cquery smoke)", async () => {
  await runInTemp("node-nix-calling-cmd-assembly-smoke", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "# stub\n", "utf8");
    await fsp.writeFile(path.join(appDir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.writeFile(path.join(appDir, "src", "a.wasm"), "00", "utf8");

    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_webapp", "nix_node_cli_bin", "nix_node_gen", "node_asset_stage", "node_wasm_inline_module")',
        "",
        "nix_node_gen(",
        '  name = "gen_copy",',
        '  srcs = ["src/index.ts"],',
        '  out = "index.out",',
        '  cmd = "cp src/index.ts $OUT",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_asset_stage(",
        '  name = "staged",',
        '  app = ":bundle",',
        '  assets = [{"src": "src/index.ts", "dest": "extra/index.ts"}],',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "node_wasm_inline_module(",
        '  name = "inline_mod",',
        '  src = "src/a.wasm",',
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
        "nix_node_cli_bin(",
        '  name = "tool_copy",',
        '  entry = "src/index.ts",',
        "  bundle = False,",
        '  labels = ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const gen = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:gen_copy`;
    if (gen.exitCode !== 0) return;
    assertCmdInvariants(String(gen.stdout || ""), "nix_node_gen");

    const app = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:bundle`;
    if (app.exitCode !== 0) return;
    assertCmdInvariants(String(app.stdout || ""), "node_webapp");

    const staged = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:staged`;
    if (staged.exitCode !== 0) return;
    assertCmdInvariants(String(staged.stdout || ""), "node_asset_stage");

    const inline = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:inline_mod`;
    if (inline.exitCode !== 0) return;
    assertCmdInvariants(String(inline.stdout || ""), "node_wasm_inline_module");

    const cli = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:tool`;
    if (cli.exitCode !== 0) return;
    assertCmdInvariants(String(cli.stdout || ""), "nix_node_cli_bin(bundle=True)");

    const cliNoBundle = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/web:tool_copy`;
    if (cliNoBundle.exitCode !== 0) return;
    assertCmdInvariants(String(cliNoBundle.stdout || ""), "nix_node_cli_bin(bundle=False)");
  });
});
