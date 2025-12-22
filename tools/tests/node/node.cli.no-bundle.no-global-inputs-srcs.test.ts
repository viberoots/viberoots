#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=False) does not include global Nix inputs as action inputs", async () => {
  await runInTemp("node-cli-no-bundle-no-global-inputs-srcs", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "cli");
    await fsp.mkdir(path.join(dir, "bin"), { recursive: true });
    await fsp.writeFile(path.join(dir, "bin", "tool"), "#!/usr/bin/env node\n", "utf8");
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "# stub\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "nix_node_cli_bin")',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute srcs //apps/cli:tool_copy`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      !out.includes(":flake.lock"),
      "expected //:flake.lock to be absent from srcs when bundle=False",
    );
  });
});
