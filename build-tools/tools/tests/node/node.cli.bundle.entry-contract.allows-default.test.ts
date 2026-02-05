#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) allows default entry (entry unset)", async () => {
  await runInTemp("node-cli-bundle-entry-allow", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "cli");
    await fsp.mkdir(path.join(dir, "src"), { recursive: true });
    await fsp.writeFile(path.join(dir, "src", "index.ts"), "console.log('cli')\n", "utf8");
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "# stub\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        "  bundle = True,",
        '  labels = ["lockfile:projects/apps/cli/pnpm-lock.yaml#projects/apps/cli"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute cmd //projects/apps/cli:tool`;

    assert.equal(
      probe.exitCode,
      0,
      "expected cquery to succeed for bundled CLI with default entry",
    );
  });
});
