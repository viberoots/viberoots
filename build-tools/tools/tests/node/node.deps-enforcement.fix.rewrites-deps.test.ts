#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node deps enforcement: fix rewrites deps", async () => {
  await runInTemp("node-deps-enforcement-fix", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "admin");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify(
        {
          name: "@repo/admin",
          version: "0.0.0",
          dependencies: {
            "@repo/ui": "workspace:*",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/node:defs_core.bzl", "nix_node_lib")',
        "",
        "nix_node_lib(",
        '  name = "admin",',
        '  deps = ["//projects/libs/old:old"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.mkdir(path.join(tmp, "build-tools", "tools", "node"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "node", "workspace-map.json"),
      JSON.stringify(
        { "@repo/ui": "//projects/libs/ui:ui", "@repo/old": "//projects/libs/old:old" },
        null,
        2,
      ),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node build-tools/tools/buck/enforce-node-deps.ts --fix`;
    assert.equal(res.exitCode, 0);

    const updated = await fsp.readFile(path.join(appDir, "TARGETS"), "utf8");
    assert.ok(updated.includes('"//projects/libs/ui:ui"'));
    assert.ok(!updated.includes('"//projects/libs/old:old"'));
  });
});
