#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_node_cli_bin(bundle=True) requires exactly one importer-scoped lockfile label (shared error text)", async () => {
  await runInTemp("node-cli-bundle-lockfile-required", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "cli");
    await fsp.mkdir(dir, { recursive: true });
    await fsp
      .writeFile(
        path.join(dir, "bin", "tool"),
        "#!/usr/bin/env node\nconsole.log('hello')\n",
        "utf8",
      )
      .catch(async () => {
        await fsp.mkdir(path.join(dir, "bin"), { recursive: true });
        await fsp.writeFile(
          path.join(dir, "bin", "tool"),
          "#!/usr/bin/env node\nconsole.log('hello')\n",
          "utf8",
        );
      });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "nix_node_cli_bin")',
        "",
        "nix_node_cli_bin(",
        '  name = "tool",',
        '  entry = "bin/tool",',
        "  bundle = True,",
        // Intentionally omit any lockfile label argument or stamped label
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
    })`buck2 build //apps/cli:tool`;

    // Expect failure with shared, stable error text from ensure_single_lockfile_label
    assert.notEqual(res.exitCode, 0, "expected buck2 build to fail when lockfile label is missing");
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>)",
      ),
      "expected shared error message for missing importer-scoped lockfile label",
    );
  });
});
