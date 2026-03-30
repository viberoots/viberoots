#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();
const TARGETS = [
  "projects/apps/example-webapp/package.json",
  "projects/apps/pleomino/package.json",
  "build-tools/tools/scaffolding/templates/ts/webapp-static/package.json.jinja",
  "build-tools/tools/scaffolding/templates/ts/webapp-static-pwa/package.json.jinja",
  "build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/package.json.jinja",
  "build-tools/tools/scaffolding/templates/ts/webapp-ssr-next/package.json.jinja",
];

test("webapp package manifests keep esbuild platform-neutral", async () => {
  for (const relativePath of TARGETS) {
    const manifest = await fsp.readFile(path.join(REPO_ROOT, relativePath), "utf8");
    assert.match(manifest, /"esbuild": "\^0\.21\.5"/, `${relativePath} must depend on esbuild`);
    assert.doesNotMatch(
      manifest,
      /"@esbuild\/(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)[^"]*"/,
      `${relativePath} must not hard-code a host-specific esbuild package`,
    );
  }
});
