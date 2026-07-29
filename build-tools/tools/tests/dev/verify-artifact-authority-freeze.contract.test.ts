#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import * as fs from "node:fs/promises";
import { ensureToolchainPathsFiles } from "../../dev/toolchain-paths";
import {
  canonicalArtifactToolsRoot,
  UnavailableGeneratedArtifactToolAuthorityError,
} from "../../lib/artifact-tool-authority";

async function source(rel: string): Promise<string> {
  return await fs.readFile(viberootsSourcePath(`viberoots/${rel}`), "utf8");
}

test("verify freezes one artifact authority across seed preparation and concurrent targets", async () => {
  const verify = await source("build-tools/tools/dev/verify/run-verify.ts");
  const resolve = verify.indexOf("const artifactToolsRoot = deps.resolveArtifactToolsRoot(root)");
  const seed = verify.indexOf("deps.prepareVerifySeed({ root, iso, artifactToolsRoot");
  const passes = verify.indexOf("deps.runVerifyBuckPasses({");
  const passAuthority = verify.indexOf("artifactToolsRoot,", passes);

  assert.ok(resolve >= 0);
  assert.ok(seed > resolve);
  assert.ok(passes > seed);
  assert.ok(passAuthority > passes);
});

test("read-only prebuild repair preserves verify's frozen authority", async () => {
  const install = await source("build-tools/tools/dev/install/deps-main.ts");
  const tempToolchains = await source(
    "build-tools/tools/tests/lib/test-helpers/toolchain-paths.ts",
  );
  const toolchains = await source("build-tools/tools/dev/toolchain-paths.ts");

  assert.match(
    install,
    /metadataMode === "read-only" \? String\(process\.env\.VBR_ARTIFACT_TOOLS_ROOT \|\| ""\) : ""/,
  );
  assert.match(install, /ensureArtifactToolsGcRoot\(\{\s+repoRoot,\s+storePath:/u);
  assert.match(
    toolchains,
    /String\(frozenArtifactToolsRoot \|\| ""\)\.trim\(\) \|\|\s+String\(parsed\?\.artifactTools\?\.root \|\| ""\)\.trim\(\)/u,
  );
  assert.match(
    toolchains,
    /String\(opts\.frozenArtifactToolsRoot \|\| ""\)\.trim\(\) \|\|\s+\(await resolveToolchainOut/u,
  );
  assert.match(
    tempToolchains,
    /canonicalArtifactToolsRoot\(\s+root,\s+String\(process\.env\.VBR_ARTIFACT_TOOLS_ROOT \|\| ""\),\s+\)/u,
  );
  assert.match(tempToolchains, /ensureToolchainPathsFiles\(root, \{ frozenArtifactToolsRoot \}\)/u);
});

test("toolchain repair rewrites a changed manifest back to the frozen authority", async () => {
  const manifestCandidates = [process.cwd(), path.dirname(process.cwd())].map((root) =>
    path.join(root, ".viberoots/workspace/toolchain-paths.json"),
  );
  let frozenRoot = "";
  for (const candidate of [process.cwd(), path.dirname(process.cwd())].map((root) =>
    path.join(root, ".nix-gcroots/artifact-tools"),
  )) {
    const resolved = await fs.realpath(candidate).catch(() => "");
    const live = await fs.access(path.join(resolved, "bin/bash")).then(
      () => true,
      () => false,
    );
    if (live) {
      frozenRoot = resolved;
      break;
    }
  }
  assert.match(frozenRoot, /^\/nix\/store\//u);
  const generated = JSON.parse(await fs.readFile(manifestCandidates[0]!, "utf8"));
  const activeManifest = {
    ...generated,
    python: { bin: path.join(frozenRoot, "bin/python3") },
    zxWrapper: { bin: path.join(frozenRoot, "bin/zx-wrapper") },
  };
  await fs.access(String(activeManifest.go?.bin || ""));
  await fs.access(String(activeManifest.go?.root || ""));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "verify-frozen-authority-"));
  try {
    const manifest = path.join(root, ".viberoots/workspace/toolchain-paths.json");
    await fs.mkdir(path.dirname(manifest), { recursive: true });
    await fs.mkdir(path.join(root, "toolchains"), { recursive: true });
    const gcRoot = path.join(root, ".nix-gcroots/artifact-tools");
    await fs.mkdir(path.dirname(gcRoot), { recursive: true });
    await fs.symlink(frozenRoot, gcRoot);
    await fs.writeFile(
      manifest,
      `${JSON.stringify(
        {
          ...activeManifest,
          artifactTools: { root: "/nix/store/00000000000000000000000000000000-changed" },
        },
        null,
        2,
      )}\n`,
    );

    const repaired = await ensureToolchainPathsFiles(root, {
      frozenArtifactToolsRoot: frozenRoot,
    });
    const written = JSON.parse(await fs.readFile(manifest, "utf8"));
    assert.equal(await fs.realpath(gcRoot), frozenRoot);
    assert.equal(repaired.artifactTools.root, frozenRoot);
    assert.equal(written.artifactTools.root, frozenRoot);
    assert.equal(await fs.realpath(gcRoot), written.artifactTools.root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("explicit reconciliation can distinguish a collected generated authority", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "collected-artifact-authority-"));
  try {
    const manifest = path.join(root, ".viberoots/workspace/toolchain-paths.json");
    await fs.mkdir(path.dirname(manifest), { recursive: true });
    await fs.writeFile(
      manifest,
      `${JSON.stringify({
        artifactTools: { root: "/nix/store/00000000000000000000000000000000-collected" },
      })}\n`,
    );
    assert.throws(
      () => canonicalArtifactToolsRoot(root),
      UnavailableGeneratedArtifactToolAuthorityError,
    );
    const update = await source("build-tools/tools/dev/update-command/toolchain.ts");
    assert.match(update, /error instanceof UnavailableGeneratedArtifactToolAuthorityError/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
