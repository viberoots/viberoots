#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node deps enforcement: generated map required", async () => {
  await runInTemp("node-deps-generated-map-required", async (tmp, $) => {
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
    await fsp.mkdir(path.join(tmp, "tools", "node"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "tools", "node", "workspace-map.json"), "{}", "utf8");

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`node tools/buck/enforce-node-deps.ts --check`;
    assert.notEqual(res.exitCode, 0);
    const combined = `${res.stdout || ""}${res.stderr || ""}`;
    assert.ok(
      combined.includes("workspace:@repo/ui") && combined.includes("tools/node/workspace-map.json"),
    );
  });
});
