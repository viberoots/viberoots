#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { discoverPrebuildInputs } from "../../buck/prebuild/input-discovery";
import { glueFreshnessOutputs } from "../../dev/install/glue-freshness";

function hasPathEnding(paths: string[], suffix: string): boolean {
  return paths.some((p) => p.replace(/\\/g, "/").endsWith(suffix));
}

test("glue freshness tracks generated glue outputs", () => {
  const root = process.cwd();
  const outputs = glueFreshnessOutputs(root);

  assert.ok(
    hasPathEnding(outputs, ".viberoots/workspace/buck/graph.json"),
    "graph output must remain part of glue freshness",
  );
  assert.ok(
    hasPathEnding(outputs, ".viberoots/workspace/providers/auto_map.bzl"),
    "auto map output must remain part of glue freshness",
  );
  assert.ok(
    hasPathEnding(outputs, path.join("build-tools", "lang", "importer_roots.bzl")),
    "importer roots output must be part of glue freshness",
  );
  assert.ok(
    hasPathEnding(outputs, path.join("build-tools", "tools", "nix", "langs.nix")),
    "language nix output must be part of glue freshness",
  );
  assert.ok(
    hasPathEnding(outputs, path.join("build-tools", "lang", "nix_attr_aliases.bzl")),
    "nix attr aliases output must be part of glue freshness",
  );
});

test("prebuild input discovery tracks glue generator config", async () => {
  const inputs = await discoverPrebuildInputs(process.cwd());

  assert.ok(
    hasPathEnding(inputs, path.join("build-tools", "tools", "lib", "importer-roots.json")),
    "importer roots config must invalidate glue freshness",
  );
  assert.ok(
    hasPathEnding(inputs, path.join("build-tools", "tools", "lib", "nix-attr-aliases.json")),
    "nix attr aliases config must invalidate glue freshness",
  );
  assert.ok(
    hasPathEnding(inputs, path.join("build-tools", "tools", "nix", "langs.json")),
    "language config must invalidate glue freshness",
  );
});
