import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactToolsCandidateGcRootPath,
  artifactToolsGcRootArgs,
  artifactToolsGcRootPath,
  ensureArtifactToolsGcRoot,
} from "../../dev/update-command/artifact-tools-gc-root";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function existingStorePath(): string {
  const match = path.resolve(process.execPath).match(/^(\/nix\/store\/[^/]+)/);
  if (!match?.[1]) throw new Error(`test node is not in /nix/store: ${process.execPath}`);
  return match[1];
}

function otherExistingStorePath(): string {
  const match = path.resolve(process.env.SHELL || "/bin/sh").match(/^(\/nix\/store\/[^/]+)/);
  return match?.[1] || existingStorePath();
}

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-artifact-tools-gc-root-"));
  const log = path.join(root, "nix-store.log");
  const fake = path.join(root, "nix-store");
  await fsp.writeFile(
    fake,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      'root="$2"',
      'store="$5"',
      'mkdir -p "$(dirname "$root")"',
      'ln -s "$store" "$root"',
      'printf "%s\\n" "$store"',
    ].join("\n"),
    { mode: 0o755 },
  );
  return { root, log, fake };
}

test("artifact tools GC root uses one workspace-owned indirect root", () => {
  assert.equal(artifactToolsGcRootPath("/workspace"), "/workspace/.nix-gcroots/artifact-tools");
  assert.equal(
    artifactToolsCandidateGcRootPath("/workspace"),
    "/workspace/.nix-gcroots/.artifact-tools.candidate",
  );
  assert.deepEqual(artifactToolsGcRootArgs("/workspace/root", "/nix/store/tools"), [
    "--add-root",
    "/workspace/root",
    "--indirect",
    "--realise",
    "/nix/store/tools",
  ]);
});

test("explicit update bypasses a host nix-store and replaces only its owned root", async () => {
  const fx = await fixture();
  const storePath = existingStorePath();
  const gcRoot = artifactToolsGcRootPath(fx.root);
  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  await fsp.symlink("/nix/store/stale-artifact-tools", gcRoot);
  try {
    assert.equal(
      await ensureArtifactToolsGcRoot({
        repoRoot: fx.root,
        storePath,
        env: { ...process.env, PATH: `${fx.root}${path.delimiter}${process.env.PATH || ""}` },
      }),
      gcRoot,
    );
    assert.equal(await fsp.realpath(gcRoot), storePath);
    await assert.rejects(fsp.readFile(fx.log, "utf8"), { code: "ENOENT" });
    await assert.rejects(fsp.lstat(artifactToolsCandidateGcRootPath(fx.root)), { code: "ENOENT" });
  } finally {
    await fsp.rm(fx.root, { recursive: true, force: true });
  }
});

test("failed replacement preserves the previous artifact tools root", async () => {
  const fx = await fixture();
  const gcRoot = artifactToolsGcRootPath(fx.root);
  const previous = otherExistingStorePath();
  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  await fsp.symlink(previous, gcRoot);
  try {
    await assert.rejects(
      ensureArtifactToolsGcRoot({
        repoRoot: fx.root,
        storePath: "/nix/store/00000000000000000000000000000000-missing-artifact-tools",
        env: process.env,
      }),
    );
    assert.equal(await fsp.realpath(gcRoot), previous);
    await assert.rejects(fsp.lstat(artifactToolsCandidateGcRootPath(fx.root)), { code: "ENOENT" });
  } finally {
    await fsp.rm(fx.root, { recursive: true, force: true });
  }
});

test("artifact tools root refuses to replace a non-symlink", async () => {
  const fx = await fixture();
  const gcRoot = artifactToolsGcRootPath(fx.root);
  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  await fsp.writeFile(gcRoot, "not-owned\n");
  try {
    await assert.rejects(
      ensureArtifactToolsGcRoot({
        repoRoot: fx.root,
        storePath: existingStorePath(),
        env: process.env,
      }),
      /refusing to replace non-symlink artifact tools gc root/,
    );
  } finally {
    await fsp.rm(fx.root, { recursive: true, force: true });
  }
});

test("toolchain repair roots bootstrap and final canonical artifact tools", async () => {
  const source = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-command/toolchain.ts"),
    "utf8",
  );
  assert.match(source, /storePath: canonicalArtifactToolsRoot\(root\)/);
  assert.match(source, /storePath: bootstrap\.artifactTools\.root/);
  assert.match(source, /storePath: finalPaths\.artifactTools\.root/);
});

test("expected fixed-output hash discovery never waits for active GC", async () => {
  const source = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts"),
    "utf8",
  );
  assert.match(
    source,
    /expectedHashMismatch = output\.includes\("viberoots-pnpm-fod-hash-mismatch-v1"\)/,
  );
  assert.match(source, /!res\.timedOut && !expectedHashMismatch/);
});
