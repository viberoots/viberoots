#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function hasUnescapedCommandSubst(s: string): boolean {
  return /(^|[^$])\$\(/.test(s);
}

test("node macros do not emit unescaped $(...) command substitutions in assembled cmd", async () => {
  await runInTemp("node-cmd-no-unescaped-subst", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "# stub\n", "utf8");
    await fsp.writeFile(path.join(appDir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//node:defs.bzl", "node_webapp", "nix_node_cli_bin")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
        ")",
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probeApp = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/web:bundle`;
    if (probeApp.exitCode !== 0) {
      return;
    }
    const cmdApp = String(probeApp.stdout || "");
    assert.ok(!hasUnescapedCommandSubst(cmdApp), "node_webapp cmd contains unescaped $(...)");

    const probeCli = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/web:tool`;
    if (probeCli.exitCode !== 0) {
      return;
    }
    const cmdCli = String(probeCli.stdout || "");
    assert.ok(
      !hasUnescapedCommandSubst(cmdCli),
      "nix_node_cli_bin(bundle=True) cmd contains unescaped $(...)",
    );
  });
});
