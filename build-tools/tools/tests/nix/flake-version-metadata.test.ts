#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";

test("flake exposes viberoots version metadata and mkWorkspace", async () => {
  const version = await $({
    stdio: "pipe",
  })`nix eval --raw --accept-flake-config .#lib.version`;
  const releaseTag = await $({
    stdio: "pipe",
  })`nix eval --raw --accept-flake-config .#lib.releaseTag`;
  assert.equal(String(version.stdout || "").trim(), "0.0.0-dev");
  assert.equal(String(releaseTag.stdout || "").trim(), "v0.0.0-dev");

  const mkWorkspace = await $({
    stdio: "pipe",
  })`nix eval --no-write-lock-file --accept-flake-config ./viberoots#lib.mkWorkspace`;
  assert.match(String(mkWorkspace.stdout || ""), /lambda mkWorkspace/);
});

test("flake app wrappers use the viberoots source root for helper scripts", async () => {
  const apps = await fsp.readFile("build-tools/tools/nix/flake/outputs-apps.nix", "utf8");
  const bootstrapPackage = await fsp.readFile(
    "build-tools/tools/nix/flake/packages/remote-worker-bootstrap.nix",
    "utf8",
  );
  assert.match(apps, /\{ pkgs, zx-wrapper, viberootsRoot, version, releaseTag, \.\.\. \}:/);
  assert.match(
    apps,
    /import \.\/packages\/remote-worker-bootstrap\.nix \{\s*inherit pkgs viberootsRoot;/,
  );
  assert.match(
    bootstrapPackage,
    /\$\{viberootsRoot\}\/build-tools\/tools\/remote-exec\/remote-worker-bootstrap\.ts/,
  );
  assert.match(apps, /\$\{viberootsRoot\}\/build-tools\/tools\/dev\/bulk-move\.ts/);
  assert.doesNotMatch(apps, /\$PWD\/build-tools\/tools\/remote-exec\/remote-worker-bootstrap\.ts/);
  assert.doesNotMatch(
    bootstrapPackage,
    /\$PWD\/build-tools\/tools\/remote-exec\/remote-worker-bootstrap\.ts/,
  );
  assert.doesNotMatch(apps, /\$PWD\/build-tools\/tools\/dev\/bulk-move\.ts/);
});
