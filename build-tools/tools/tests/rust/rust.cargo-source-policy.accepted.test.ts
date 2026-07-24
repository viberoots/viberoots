#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { assertSupportedCargoLockSources } from "../../dev/install/cargo-source-policy";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const nixSourcePolicy = path.join(sourceRoot, "build-tools/rust/cargo-source-policy.nix");
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());
const artifactToolsRoot = canonicalArtifactToolsRoot(
  workspaceRoot,
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);
const nixInstantiate = ensureNixStoreToolPathSync("nix-instantiate", {
  PATH: path.join(artifactToolsRoot, "bin"),
});

test("source policy accepts HTTPS private registries and full-revision HTTPS Git identities", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-source-policy-accepted-"));
  try {
    const lock = path.join(root, "Cargo.lock");
    const revision = "a".repeat(40);
    await fsp.writeFile(
      lock,
      [
        "version = 3",
        "[[package]]",
        'name = "private-dep"',
        'version = "1.0.0"',
        'source = "registry+https://registry.example/index"',
        'checksum = "fixture"',
        "[[package]]",
        'name = "git-dep"',
        'version = "2.0.0"',
        `source = "git+https://git.example/repo.git#${revision}"`,
        "",
      ].join("\n"),
    );
    await assertSupportedCargoLockSources(lock);
    const result = await execFileAsync(nixInstantiate, [
      "--eval",
      "--strict",
      "--expr",
      `import ${JSON.stringify(nixSourcePolicy)} { lockFile = builtins.toPath ${JSON.stringify(
        lock,
      )}; }`,
    ]);
    assert.match(result.stdout, /true/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
