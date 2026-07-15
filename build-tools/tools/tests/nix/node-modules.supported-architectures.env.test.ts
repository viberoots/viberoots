#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);

test("pnpm store and node_modules share the exact supported Nix platform authority", async () => {
  const root = viberootsSourcePath("viberoots/build-tools/tools/nix/node-modules");
  const [platforms, store, modules] = await Promise.all(
    ["supported-platforms.nix", "store.nix", "modules.nix"].map(
      async (file) => await fsp.readFile(`${root}/${file}`, "utf8"),
    ),
  );
  for (const tuple of [
    'system = "aarch64-darwin"; os = "darwin"; cpu = "arm64";',
    'system = "aarch64-linux"; os = "linux"; cpu = "arm64"; libc = "glibc";',
    'system = "x86_64-linux"; os = "linux"; cpu = "x64"; libc = "glibc";',
  ]) {
    assert.match(platforms, new RegExp(tuple.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const platformTuples = platforms.slice(
    platforms.indexOf("platforms = ["),
    platforms.indexOf("];", platforms.indexOf("platforms = [")) + 2,
  );
  assert.doesNotMatch(platformTuples, /win32|musl|cpu = "arm"|x86_64-darwin/);
  assert.match(platforms, /if platform\.os == "linux" then \[ "glibc" "musl" \]/);
  assert.match(platforms, /throw "unsupported Nix system/);
  assert.match(store, /supportedPlatforms\.universalMarkers/);
  assert.match(store, /for supported_architectures in/);
  assert.match(
    modules,
    /supportedPlatforms\.markerForSystem pkgs\.stdenvNoCC\.hostPlatform\.system/,
  );
});

test("evaluated universal markers retain both Linux libcs while exact Nix markers stay glibc", async () => {
  const platformsPath = viberootsSourcePath(
    "viberoots/build-tools/tools/nix/node-modules/supported-platforms.nix",
  );
  const expression = `
    let supported = import (builtins.toPath ${JSON.stringify(platformsPath)}) { };
    in {
      universal = supported.universalMarkers;
      exactArm64 = supported.markerForSystem "aarch64-linux";
      exactX64 = supported.markerForSystem "x86_64-linux";
      exactDarwin = supported.markerForSystem "aarch64-darwin";
    }
  `;
  const { stdout } = await execFileAsync(
    resolveToolPathSync("nix"),
    ["eval", "--impure", "--json", "--expr", expression],
    { timeout: 30_000 },
  );
  const evaluated = JSON.parse(stdout) as {
    universal: string[];
    exactArm64: string;
    exactX64: string;
    exactDarwin: string;
  };
  const linuxUniversal = evaluated.universal.filter((marker) => marker.includes("- linux"));
  assert.equal(linuxUniversal.length, 2);
  for (const marker of linuxUniversal) {
    assert.match(marker, /libc:\n    - glibc\n    - musl\n/);
  }
  for (const marker of [evaluated.exactArm64, evaluated.exactX64]) {
    assert.match(marker, /libc:\n    - glibc\n/);
    assert.doesNotMatch(marker, /musl/);
  }
  assert.doesNotMatch(evaluated.exactDarwin, /libc:/);
});
