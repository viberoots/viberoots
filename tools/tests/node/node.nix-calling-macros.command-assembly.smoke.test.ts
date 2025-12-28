#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function assertCmdInvariants(cmd: string, label: string) {
  assert.ok(
    cmd.includes("--no-link --print-out-paths"),
    `${label}: expected nix build out-path capture (--no-link --print-out-paths)`,
  );
  assert.ok(
    cmd.includes("BUCK_GRAPH_JSON="),
    `${label}: expected BUCK_GRAPH_JSON env export to be present`,
  );
  assert.ok(
    cmd.includes(". tools/buck/workspace-root.env"),
    `${label}: expected workspace-root env sourcing for temp/sandboxed workspaces`,
  );
}

test("node Nix-calling macros use standardized command assembly helpers (cquery smoke)", async () => {
  await runInTemp("node-nix-calling-cmd-assembly-smoke", async (tmp, $) => {
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

    const app = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/web:bundle`;
    if (app.exitCode !== 0) return;
    assertCmdInvariants(String(app.stdout || ""), "node_webapp");

    const cli = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //apps/web:tool`;
    if (cli.exitCode !== 0) return;
    assertCmdInvariants(String(cli.stdout || ""), "nix_node_cli_bin(bundle=True)");
  });
});
