#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) rejects non-default entry (bundle entry is fixed)", async () => {
  await runInTemp("node-cli-bundle-entry-reject", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "cli");
    await fsp.mkdir(path.join(dir, "bin"), { recursive: true });
    await fsp.writeFile(path.join(dir, "bin", "tool"), "#!/usr/bin/env node\n", "utf8");
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "# stub\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        '  entry = "bin/tool",',
        "  bundle = True,",
        '  labels = ["lockfile:projects/apps/cli/pnpm-lock.yaml#projects/apps/cli"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 build //projects/apps/cli:tool`;

    assert.notEqual(res.exitCode, 0, "expected buck2 build to fail for non-default bundled entry");
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes("nix_node_cli_bin(bundle=True) supports only entry='src/index.ts'"),
      "expected a deterministic error explaining the fixed bundled entry contract",
    );
  });
});
