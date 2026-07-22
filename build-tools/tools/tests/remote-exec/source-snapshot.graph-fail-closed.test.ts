#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

for (const [name, contents, expected] of [
  ["invalid JSON", '{"nodes":', /Unexpected end of JSON input|JSON/],
  ["non-object node", '{"nodes":[42]}', /node 0 must be an object/],
  [
    "malformed pin",
    '{"nodes":[{"name":"\/\/app:x","nixpkg_pins":{"pkgs.zlib":42}}]}',
    /malformed nixpkg pin/,
  ],
  [
    "missing pin profile",
    '{"nodes":[{"name":"\/\/app:x","nixpkg_pins":{"pkgs.zlib":{"rationale":"needed"}}}]}',
    /malformed nixpkg pin/,
  ],
  [
    "blank pin profile",
    '{"nodes":[{"name":"\/\/app:x","nixpkg_pins":{"pkgs.zlib":{"nixpkgs_profile":" ","rationale":"needed"}}}]}',
    /malformed nixpkg pin/,
  ],
  [
    "missing pin rationale",
    '{"nodes":[{"name":"\/\/app:x","nixpkg_pins":{"pkgs.zlib":{"nixpkgs_profile":"default"}}}]}',
    /malformed nixpkg pin/,
  ],
  [
    "blank pin rationale",
    '{"nodes":[{"name":"\/\/app:x","nixpkg_pins":{"pkgs.zlib":{"nixpkgs_profile":"default","rationale":" "}}}]}',
    /malformed nixpkg pin/,
  ],
  [
    "duplicate normalized pins",
    '{"nodes":[{"name":"\/\/app:x","nixpkg_pins":{"gtest":{"nixpkgs_profile":"default","rationale":"one"},"pkgs.gtest":{"nixpkgs_profile":"default","rationale":"two"}}}]}',
    /duplicate normalized nixpkg_pins key pkgs\.googletest/,
  ],
] as const) {
  test(`source snapshot fails closed for ${name}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-snapshot-malformed-"));
    try {
      const graph = path.join(root, "graph.json");
      await fs.writeFile(graph, contents);
      const result = await $({
        stdio: "pipe",
        nothrow: true,
      })`zx-wrapper viberoots/build-tools/tools/dev/source-snapshot.ts --workspace-root ${root} --out ${path.join(root, "out")} --manifest ${path.join(root, "manifest.json")} --graph ${graph}`;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || ""), expected);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
