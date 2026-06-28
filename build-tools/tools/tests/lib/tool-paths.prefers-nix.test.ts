#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureNixStoreToolPathSync, resolveToolPathSync } from "../../lib/tool-paths";

test("resolveToolPathSync prefers nix store binaries before host PATH entries", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const hostDir = path.join(tmp, "host");
    const nixDir = path.join(tmp, "nix", "store", "abc-tool", "bin");
    await fsp.mkdir(hostDir, { recursive: true });
    await fsp.mkdir(nixDir, { recursive: true });
    const hostTool = path.join(hostDir, "demo-tool");
    const nixTool = path.join(nixDir, "demo-tool");
    await fsp.writeFile(hostTool, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.writeFile(nixTool, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(hostTool, 0o755);
    await fsp.chmod(nixTool, 0o755);

    const resolved = resolveToolPathSync("demo-tool", {
      ...process.env,
      PATH: [hostDir, nixDir].join(path.delimiter),
    });
    assert.equal(resolved, nixTool);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveToolPathSync prefers Determinate profile Nix over flake Nix when present", async (t) => {
  const determinateNix = "/nix/var/nix/profiles/default/bin/nix";
  try {
    await fsp.access(determinateNix);
  } catch {
    t.skip("Determinate profile Nix is not installed on this host");
    return;
  }

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const nixDir = path.join(tmp, "nix", "store", "flake-nix", "bin");
    await fsp.mkdir(nixDir, { recursive: true });
    const flakeNix = path.join(nixDir, "nix");
    await fsp.writeFile(flakeNix, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(flakeNix, 0o755);

    const env = {
      ...process.env,
      PATH: nixDir,
    };
    assert.equal(resolveToolPathSync("nix", env), determinateNix);
    assert.equal(ensureNixStoreToolPathSync("nix", env), determinateNix);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveToolPathSync honors explicit VBR_NIX_BIN override", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const customDir = path.join(tmp, "custom");
    const nixDir = path.join(tmp, "nix", "store", "flake-nix", "bin");
    await fsp.mkdir(customDir, { recursive: true });
    await fsp.mkdir(nixDir, { recursive: true });
    const customNix = path.join(customDir, "nix");
    const flakeNix = path.join(nixDir, "nix");
    await fsp.writeFile(customNix, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.writeFile(flakeNix, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(customNix, 0o755);
    await fsp.chmod(flakeNix, 0o755);

    assert.equal(
      resolveToolPathSync("nix", {
        ...process.env,
        PATH: nixDir,
        VBR_NIX_BIN: customNix,
      }),
      customNix,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("ensureNixStoreToolPathSync rejects host-only tool paths", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const hostDir = path.join(tmp, "host");
    await fsp.mkdir(hostDir, { recursive: true });
    const hostTool = path.join(hostDir, "demo-tool");
    await fsp.writeFile(hostTool, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(hostTool, 0o755);

    assert.throws(
      () =>
        ensureNixStoreToolPathSync("demo-tool", {
          ...process.env,
          PATH: hostDir,
        }),
      /required tool must resolve to \/nix\/store/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("resolveToolPathSync ignores viberoots source trees and only searches PATH", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const cellBin = path.join(tmp, "viberoots", "build-tools", "tools", "bin");
    await fsp.mkdir(cellBin, { recursive: true });
    const cellTool = path.join(cellBin, "demo-tool");
    await fsp.writeFile(cellTool, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(cellTool, 0o755);

    assert.throws(
      () =>
        resolveToolPathSync("demo-tool", {
          ...process.env,
          PATH: "",
          VIBEROOTS_ROOT: path.join(tmp, "viberoots"),
        }),
      /required tool not found on PATH/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("install-time nix helpers use resolved Nix tool path", async () => {
  const files = [
    "viberoots/build-tools/tools/dev/filtered-flake.ts",
    "viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts",
    "viberoots/build-tools/tools/dev/install/link-node.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-command.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store.ts",
    "viberoots/build-tools/tools/lib/workspace-lock-repair.ts",
  ];

  for (const file of files) {
    const source = await fsp.readFile(file, "utf8");
    assert.match(source, /resolveToolPathSync\("nix"/, `${file} must resolve nix explicitly`);
    assert.doesNotMatch(source, /command:\s*"nix"/, `${file} must not spawn ambient nix`);
    assert.doesNotMatch(source, /execFileSync\(\s*"nix"/, `${file} must not exec ambient nix`);
    assert.doesNotMatch(
      source,
      /\}\)`nix\s+(?:eval|build|flake|hash|store)/,
      `${file} must not run ambient nix`,
    );
  }
});

test("maintenance gc default runner resolves Nix through tool selector", async () => {
  const source = await fsp.readFile("viberoots/build-tools/tools/lib/maintenance-gc.ts", "utf8");
  assert.match(source, /resolveToolPathSync\("nix"\)/);
  assert.doesNotMatch(source, /spawn\(command,/);
  assert.doesNotMatch(source, /execFileAsync\(command,/);
});

test("repo nix wrapper delegates through VBR_NIX_BIN", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const selected = path.join(tmp, "selected-nix");
    const marker = path.join(tmp, "marker.txt");
    await fsp.writeFile(
      selected,
      ["#!/usr/bin/env bash", 'printf \'%s\\n\' "$@" > "$VBR_NIX_WRAPPER_MARKER"', ""].join("\n"),
      "utf8",
    );
    await fsp.chmod(selected, 0o755);

    const result = await $({
      stdio: "pipe",
      env: {
        ...process.env,
        VBR_NIX_BIN: selected,
        VBR_NIX_WRAPPER_MARKER: marker,
      },
    })`viberoots/build-tools/tools/bin/nix --version`;

    assert.equal(result.exitCode, 0);
    assert.equal((await fsp.readFile(marker, "utf8")).trim(), "--version");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
