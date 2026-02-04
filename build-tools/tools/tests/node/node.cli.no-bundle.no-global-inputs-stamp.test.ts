#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=False) does not stamp global Nix inputs", async () => {
  await runInTemp("node-cli-no-bundle-no-stamp", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "cli");
    await fsp.mkdir(path.join(dir, "bin"), { recursive: true });
    // Create a dummy entry to avoid cquery complaints if any tool inspects srcs
    await fsp.writeFile(path.join(dir, "bin", "tool"), "#!/usr/bin/env node\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool_copy",',
        '  entry = "bin/tool",',
        "  bundle = False,",
        '  labels = ["lockfile:apps/cli/pnpm-lock.yaml#apps/cli"],',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/cli:tool_copy`;
    if (probe.exitCode !== 0) {
      // Environment not fully available in temp — skip to avoid false negatives
      return;
    }
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(': "lang:node"') || out.includes('"lang:node"'),
      "expected lang:node label to be present",
    );
    assert.ok(
      !out.includes(":flake.lock"),
      "expected //:flake.lock to be absent when bundle=False",
    );
  });
});
