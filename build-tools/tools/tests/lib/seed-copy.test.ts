#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { copySeedStoreToTempRepo, probeSeedCowCopyFrom } from "./test-helpers/seed-copy";

const scratchRoot = path.join(process.cwd(), ".viberoots", "workspace", "buck", "tmp");

async function mktemp(prefix = "seed-copy-"): Promise<string> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  return await fsp.mkdtemp(path.join(scratchRoot, prefix));
}

async function writeRequiredSeedFiles(root: string): Promise<void> {
  const files = [
    "flake.nix",
    ".buckconfig",
    path.join("viberoots", "flake.nix"),
    path.join("viberoots", "build-tools", "deployments", "defs.bzl"),
    path.join("viberoots", "build-tools", "tools", "buck", "export-graph.ts"),
    path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
  ];
  for (const rel of files) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `${rel}\n`, "utf8");
  }
  await fsp.mkdir(path.join(root, "docs"), { recursive: true });
}

async function makeReadOnlyTree(root: string): Promise<void> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) await makeReadOnlyTree(abs);
    if (!entry.isSymbolicLink()) {
      const st = await fsp.stat(abs).catch(() => null);
      if (st) await fsp.chmod(abs, st.mode & ~0o222).catch(() => {});
    }
  }
  const st = await fsp.stat(root).catch(() => null);
  if (st) await fsp.chmod(root, st.mode & ~0o222).catch(() => {});
}

async function makeWritableTree(root: string): Promise<void> {
  const st = await fsp.stat(root).catch(() => null);
  if (st) await fsp.chmod(root, st.mode | 0o700).catch(() => {});
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritableTree(abs);
    if (!entry.isSymbolicLink()) {
      const entrySt = await fsp.stat(abs).catch(() => null);
      if (entrySt) await fsp.chmod(abs, entrySt.mode | 0o700).catch(() => {});
    }
  }
}

test("copySeedStoreToTempRepo publishes a complete forced-CoW seed copy atomically", async () => {
  const seed = await mktemp("seed-copy-source-");
  const tmp = await mktemp("seed-copy-dest-");
  await writeRequiredSeedFiles(seed);
  await fsp.writeFile(path.join(seed, ".metadata_never_index"), "", "utf8");
  for (const rel of [
    path.join(".viberoots", "codex-logs", "full.log"),
    path.join(".viberoots", "workspace", "backups", "backup.json"),
    path.join(".viberoots", "workspace", "buck", "log"),
    path.join(".viberoots", "workspace", "cache", "nix-tarballs", "blob"),
    path.join(".viberoots", "workspace", "codex-test-logs", "focused.log"),
    path.join(".viberoots", "workspace", "install-cache", "state.json"),
    path.join(".viberoots", "workspace", "nix-xdg-cache", "nix", "tarball-cache-v2", "pack"),
    path.join(".viberoots", "workspace", "node", "bin", "node"),
    path.join(".viberoots", "workspace", "pr-logs", "pr6.log"),
    path.join(".viberoots", "workspace", "xdg-cache", "nix", "tarball-cache-v2", "pack"),
    path.join("build-tools", "tmp", "rsync-nested-buck-out-123", "buck-out", "artifact"),
    path.join("viberoots", ".direnv", "flake-profile.rc"),
    path.join("viberoots", ".nix-gcroots", "devshell"),
    path.join("viberoots", "buck-out", "v2", "cache"),
    path.join("viberoots", "node_modules", ".bin", "tool"),
  ]) {
    const abs = path.join(seed, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, "generated\n", "utf8");
  }
  await fsp.writeFile(path.join(tmp, "stale.txt"), "stale\n", "utf8");

  const supported = await probeSeedCowCopyFrom({
    srcFile: path.join(seed, "flake.nix"),
    dstDir: tmp,
  });
  assert.equal(supported, true);

  await copySeedStoreToTempRepo({ seedPath: seed, tmpDir: tmp });

  assert.equal(await fsp.readFile(path.join(tmp, "flake.nix"), "utf8"), "flake.nix\n");
  assert.equal(
    await fsp.readFile(path.join(tmp, "viberoots", "flake.nix"), "utf8"),
    `${path.join("viberoots", "flake.nix")}\n`,
  );
  assert.equal(
    await fsp.readFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
      "utf8",
    ),
    `${path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs")}\n`,
  );
  assert.ok((await fsp.stat(path.join(tmp, "docs"))).isDirectory());
  if (process.platform === "darwin") {
    await fsp.stat(path.join(tmp, ".metadata_never_index"));
  }
  await assert.rejects(fsp.access(path.join(tmp, "stale.txt")));
  await assert.rejects(fsp.access(path.join(tmp, ".viberoots", "codex-logs", "full.log")));
  await assert.rejects(
    fsp.access(path.join(tmp, ".viberoots", "workspace", "backups", "backup.json")),
  );
  await assert.rejects(fsp.access(path.join(tmp, ".viberoots", "workspace", "buck", "log")));
  await assert.rejects(
    fsp.access(path.join(tmp, ".viberoots", "workspace", "cache", "nix-tarballs", "blob")),
  );
  await assert.rejects(
    fsp.access(path.join(tmp, ".viberoots", "workspace", "codex-test-logs", "focused.log")),
  );
  await assert.rejects(
    fsp.access(path.join(tmp, ".viberoots", "workspace", "install-cache", "state.json")),
  );
  await assert.rejects(
    fsp.access(
      path.join(tmp, ".viberoots", "workspace", "nix-xdg-cache", "nix", "tarball-cache-v2", "pack"),
    ),
  );
  await assert.rejects(
    fsp.access(path.join(tmp, ".viberoots", "workspace", "node", "bin", "node")),
  );
  await assert.rejects(fsp.access(path.join(tmp, ".viberoots", "workspace", "pr-logs", "pr6.log")));
  await assert.rejects(
    fsp.access(
      path.join(tmp, ".viberoots", "workspace", "xdg-cache", "nix", "tarball-cache-v2", "pack"),
    ),
  );
  await assert.rejects(
    fsp.access(
      path.join(tmp, "build-tools", "tmp", "rsync-nested-buck-out-123", "buck-out", "artifact"),
    ),
  );
  await assert.rejects(fsp.access(path.join(tmp, "viberoots", ".direnv")));
  await assert.rejects(fsp.access(path.join(tmp, "viberoots", ".nix-gcroots")));
  await assert.rejects(fsp.access(path.join(tmp, "viberoots", "buck-out")));
  await assert.rejects(fsp.access(path.join(tmp, "viberoots", "node_modules")));
  assert.equal(await fsp.readFile(path.join(seed, "flake.nix"), "utf8"), "flake.nix\n");
});

test("copySeedStoreToTempRepo can publish from a read-only seed root", async (t) => {
  const seed = await mktemp("seed-copy-readonly-source-");
  const tmp = await mktemp("seed-copy-readonly-dest-");
  await writeRequiredSeedFiles(seed);
  for (let i = 0; i < 80; i++) {
    const abs = path.join(seed, "bulk", `dir-${String(i).padStart(2, "0")}`, "file.txt");
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `bulk-${i}\n`, "utf8");
  }

  const supported = await probeSeedCowCopyFrom({
    srcFile: path.join(seed, "flake.nix"),
    dstDir: tmp,
  });
  assert.equal(supported, true);

  const seedMode = (await fsp.stat(seed)).mode;
  t.after(async () => {
    await makeWritableTree(seed).catch(() => {});
    await fsp.chmod(seed, seedMode).catch(() => {});
  });
  await makeReadOnlyTree(seed);

  await copySeedStoreToTempRepo({ seedPath: seed, tmpDir: tmp });

  await fsp.writeFile(path.join(tmp, "private-write.txt"), "ok\n", "utf8");
  assert.equal(await fsp.readFile(path.join(tmp, "flake.nix"), "utf8"), "flake.nix\n");
  assert.equal(
    await fsp.readFile(path.join(tmp, "viberoots", "flake.nix"), "utf8"),
    `${path.join("viberoots", "flake.nix")}\n`,
  );
  assert.ok((await fsp.stat(path.join(tmp, "docs"))).isDirectory());
  assert.equal(
    await fsp.readFile(path.join(tmp, "bulk", "dir-79", "file.txt"), "utf8"),
    "bulk-79\n",
  );
});
