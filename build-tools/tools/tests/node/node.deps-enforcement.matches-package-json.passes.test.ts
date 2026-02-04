#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node deps enforcement: matches package.json passes", async () => {
  await runInTemp("node-deps-enforcement-pass", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify(
        {
          name: "@repo/web",
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
        '  name = "web",',
        '  deps = ["//libs/ui:ui"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.mkdir(path.join(tmp, "build-tools", "tools", "node"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "node", "workspace-map.json"),
      JSON.stringify({ "@repo/ui": "//libs/ui:ui" }, null, 2),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node build-tools/tools/buck/enforce-node-deps.ts --check`;
    assert.equal(res.exitCode, 0);
  });
});
