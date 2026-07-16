import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  ensureExactStoreGcRoot,
  exactStoreGcRootArgs,
  exactStoreGcRootPath,
} from "../../dev/update-pnpm-hash/exact-store-gc-root";

const execFileAsync = promisify(execFile);

function existingStorePath(): string {
  const match = path.resolve(process.execPath).match(/^(\/nix\/store\/[^/]+)/);
  if (!match?.[1]) throw new Error(`test node is not in /nix/store: ${process.execPath}`);
  return match[1];
}

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-pnpm-gc-root-"));
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

test("exact store root argv is importer-scoped and canonical", () => {
  assert.equal(
    exactStoreGcRootPath("/workspace", "projects/apps/web"),
    "/workspace/.nix-gcroots/pnpm-store.projects-apps-web",
  );
  assert.deepEqual(exactStoreGcRootArgs("/workspace/root", "/nix/store/store"), [
    "--add-root",
    "/workspace/root",
    "--indirect",
    "--realise",
    "/nix/store/store",
  ]);
});

test("explicit reconciliation creates and replaces only its owned stale root", async () => {
  const fx = await fixture();
  const storePath = existingStorePath();
  const gcRoot = exactStoreGcRootPath(fx.root, ".");
  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  await fsp.symlink("/nix/store/stale-exact-store", gcRoot);
  try {
    assert.equal(
      await ensureExactStoreGcRoot({
        repoRoot: fx.root,
        importer: ".",
        storePath,
        mode: "reconcile",
        env: { ...process.env, VBR_NIX_STORE_BIN: fx.fake },
      }),
      gcRoot,
    );
    assert.equal(await fsp.realpath(gcRoot), storePath);
    assert.equal(
      (await fsp.readFile(fx.log, "utf8")).trim(),
      `--add-root ${gcRoot} --indirect --realise ${storePath}`,
    );
  } finally {
    await fsp.rm(fx.root, { recursive: true, force: true });
  }
});

test("read-only reasserts an absent root but rejects a stale root", async () => {
  const fx = await fixture();
  const storePath = existingStorePath();
  const gcRoot = exactStoreGcRootPath(fx.root, "projects/apps/web");
  try {
    await ensureExactStoreGcRoot({
      repoRoot: fx.root,
      importer: "projects/apps/web",
      storePath,
      mode: "read-only",
      env: { ...process.env, VBR_NIX_STORE_BIN: fx.fake },
    });
    assert.equal(await fsp.realpath(gcRoot), storePath);
    await fsp.unlink(gcRoot);
    await fsp.symlink("/nix/store/stale-exact-store", gcRoot);
    await assert.rejects(
      ensureExactStoreGcRoot({
        repoRoot: fx.root,
        importer: "projects/apps/web",
        storePath,
        mode: "read-only",
        env: { ...process.env, VBR_NIX_STORE_BIN: fx.fake },
      }),
      /gc root is stale[\s\S]*repair: run u/,
    );
    assert.equal((await fsp.readFile(fx.log, "utf8")).trim().split("\n").length, 1);
  } finally {
    await fsp.rm(fx.root, { recursive: true, force: true });
  }
});

test("exact store root refuses to replace a non-symlink", async () => {
  const fx = await fixture();
  const gcRoot = exactStoreGcRootPath(fx.root, ".");
  await fsp.mkdir(path.dirname(gcRoot), { recursive: true });
  await fsp.writeFile(gcRoot, "not-owned\n");
  try {
    await assert.rejects(
      ensureExactStoreGcRoot({
        repoRoot: fx.root,
        importer: ".",
        storePath: existingStorePath(),
        mode: "reconcile",
        env: { ...process.env, VBR_NIX_STORE_BIN: fx.fake },
      }),
      /refusing to replace non-symlink/,
    );
  } finally {
    await fsp.rm(fx.root, { recursive: true, force: true });
  }
});

test("a real indirect root blocks deletion in a bounded isolated store", async () => {
  const base = path.join(process.cwd(), ".viberoots", "workspace", "tmp");
  await fsp.mkdir(base, { recursive: true });
  const root = await fsp.mkdtemp(path.join(base, "vbr-pnpm-real-root-"));
  const localRoot = path.join(root, "local-store");
  const localStore = `local?root=${localRoot}`;
  const source = path.join(root, "small-store-source");
  await fsp.writeFile(source, `bounded exact-store root fixture ${path.basename(root)}\n`);
  const { stdout } = await execFileAsync("nix-store", ["--store", localStore, "--add", source], {
    timeout: 30_000,
  });
  const storePath = String(stdout).trim();
  const gcRoot = exactStoreGcRootPath(root, ".");
  try {
    await execFileAsync(
      "nix-store",
      ["--store", localStore, ...exactStoreGcRootArgs(gcRoot, storePath)],
      { timeout: 30_000 },
    );
    await assert.rejects(
      execFileAsync("nix-store", ["--store", localStore, "--delete", storePath], {
        timeout: 30_000,
      }),
    );
    const physicalStorePath = path.join(localRoot, storePath);
    await fsp.access(physicalStorePath);
    await fsp.unlink(gcRoot);
    await execFileAsync("nix-store", ["--store", localStore, "--delete", storePath], {
      timeout: 30_000,
    });
    await assert.rejects(fsp.access(physicalStorePath), { code: "ENOENT" });
  } finally {
    await fsp.unlink(gcRoot).catch(() => undefined);
    await fsp.rm(root, { recursive: true, force: true });
  }
});
