#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEMPLATE_CASES = [
  { template: "webapp-static", appName: "demo-static" },
  { template: "webapp-static-pwa", appName: "demo-pwa" },
  { template: "webapp-ssr-vite", appName: "demo-ssr-vite" },
  { template: "webapp-ssr-next", appName: "demo-ssr-next" },
];

test("webapp package manifests keep esbuild platform-neutral", async () => {
  await runInTemp("webapp-esbuild-platform-neutral", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    for (const { template, appName } of TEMPLATE_CASES) {
      await $`scaf new ts ${template} ${appName} --yes --no-tests --skip-lockfile-gen`;
      const relativePath = path.join("projects", "apps", appName, "package.json");
      const manifest = await fsp.readFile(path.join(tmp, relativePath), "utf8");
      assert.match(manifest, /"esbuild": "\^0\.21\.5"/, `${relativePath} must depend on esbuild`);
      assert.doesNotMatch(
        manifest,
        /"@esbuild\/(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)[^"]*"/,
        `${relativePath} must not hard-code a host-specific esbuild package`,
      );
    }
  });
});
