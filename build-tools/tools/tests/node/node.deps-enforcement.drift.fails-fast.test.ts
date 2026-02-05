#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node deps enforcement: drift fails fast", async () => {
  await runInTemp("node-deps-enforcement-drift", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "api");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify(
        {
          name: "@repo/api",
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
        '  name = "api",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.mkdir(path.join(tmp, "build-tools", "tools", "node"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "node", "workspace-map.json"),
      JSON.stringify({ "@repo/ui": "//projects/libs/ui:ui" }, null, 2),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node build-tools/tools/buck/enforce-node-deps.ts --check`;
    assert.notEqual(res.exitCode, 0);
    const combined = String(res.stdout || "") + String(res.stderr || "");
    assert.ok(combined.includes("node deps drift in //projects/apps/api:api"));
    assert.ok(combined.includes("missing: //projects/libs/ui:ui"));
    assert.ok(combined.includes("Fix: node build-tools/tools/buck/enforce-node-deps.ts --fix"));
  });
});
