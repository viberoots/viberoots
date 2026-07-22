#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { installCanonicalArtifactToolsAuthority } from "../../lib/artifact-tool-authority";
import { viberootsSourcePath } from "./test-helpers/source-paths";

// The canonical tool authority rejects any asserted VBR_ARTIFACT_TOOLS_ROOT
// that is not a literal /nix/store directory or that does not exist. These
// poison cases defend explicit tool-authority boundaries: an attacker or
// misconfigured caller cannot swap the tool closure for a mutable path.

test("canonicalArtifactToolsRoot rejects a non-store asserted root", () => {
  assert.throws(
    () => canonicalArtifactToolsRoot("/", "/tmp/not-a-store"),
    /must be a literal Nix store directory/,
  );
});

test("canonicalArtifactToolsRoot rejects a well-shaped but missing store root", () => {
  const missing =
    "/nix/store/00000000000000000000000000000000-poison-does-not-exist-remote-worker-tools";
  assert.throws(
    () => canonicalArtifactToolsRoot("/", missing),
    /unavailable|must not use a mutable or indirect path|must be a literal Nix store directory/,
  );
});

test("canonicalArtifactToolsRoot rejects an empty asserted root when no manifest exists", () => {
  // Point at a scratch dir with no toolchain-paths.json and no asserted root.
  // The function must throw a clear "run u && i" message rather than falling
  // back to any implicit authority.
  assert.throws(
    () => canonicalArtifactToolsRoot("/", ""),
    /canonical generated tool authority|Nix store directory/,
  );
});

test("canonicalArtifactToolsRoot rejects a distinct valid active store authority", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-authority-mismatch-"));
  const toolsRoot = canonicalArtifactToolsRoot(process.cwd());
  try {
    await installCanonicalArtifactToolsAuthority(tmp, toolsRoot);
    const nodePath = await fsp.realpath(path.join(toolsRoot, "bin", "node"));
    const nodeStoreRoot = nodePath.match(/^(\/nix\/store\/[a-z0-9]{32}-[^/]+)/u)?.[1];
    assert.ok(nodeStoreRoot, `node must resolve into a literal Nix store root: ${nodePath}`);
    assert.notEqual(nodeStoreRoot, toolsRoot);
    assert.throws(
      () => canonicalArtifactToolsRoot(tmp, nodeStoreRoot),
      /canonical artifact tool authority mismatch: generated=.* active=.*; run u && i/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("ordinary ingress does not replace a missing manifest with ambient tool authority", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "artifact-ingress-missing-manifest-"));
  const toolsRoot = canonicalArtifactToolsRoot(process.cwd());
  const entrypoint = viberootsSourcePath("build-tools/tools/dev/canonical-artifact-entrypoint.ts");
  const zxInit = viberootsSourcePath("build-tools/tools/dev/zx-init.mjs");
  try {
    const child = spawnSync(
      path.join(toolsRoot, "bin", "node"),
      [
        "--experimental-strip-types",
        "--import",
        zxInit,
        "--input-type=module",
        "--eval",
        `import { enterCanonicalArtifactEntrypoint } from ${JSON.stringify(entrypoint)}; enterCanonicalArtifactEntrypoint(process.cwd());`,
      ],
      {
        cwd: tmp,
        encoding: "utf8",
        env: {
          HOME: os.homedir(),
          PATH: path.join(toolsRoot, "bin"),
          VBR_ARTIFACT_TOOLS_ROOT: toolsRoot,
        },
      },
    );
    assert.notEqual(child.status, 0);
    assert.match(String(child.stderr || ""), /canonical generated tool authority/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
