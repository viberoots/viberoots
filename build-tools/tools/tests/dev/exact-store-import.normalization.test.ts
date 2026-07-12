#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeExactStoreForImport } from "../../dev/update-pnpm-hash/exact-store-import";

test("exact store import normalization removes path-local pnpm state", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-exact-store-normalize-"));
  try {
    const first = await writeVolatileExactStore(tmp, "first", "2026-07-11T00:00:00.000Z");
    const second = await writeVolatileExactStore(tmp, "second", "2026-07-12T00:00:00.000Z");

    await normalizeExactStoreForImport({
      repoRoot: tmp,
      importer: "projects/apps/demo",
      storeDir: first.storeDir,
      timeoutMs: 30_000,
    });
    await normalizeExactStoreForImport({
      repoRoot: tmp,
      importer: "projects/apps/demo",
      storeDir: second.storeDir,
      timeoutMs: 30_000,
    });

    await assert.rejects(fsp.stat(first.projectsDir));
    await assert.rejects(fsp.stat(path.join(first.storeDir, ".metadata_never_index")));
    const { stdout } =
      await $`sqlite3 ${first.indexDb} "SELECT hex(data) FROM package_index WHERE key = 'pkg';"`;
    assert.equal(String(stdout).trim(), "CB0000000000000000");

    const nix = process.env.VBR_NIX_BIN ?? "nix";
    const firstHash = await $`${nix} hash path ${first.storeDir}`;
    const secondHash = await $`${nix} hash path ${second.storeDir}`;
    assert.equal(String(firstHash.stdout).trim(), String(secondHash.stdout).trim());
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

async function writeVolatileExactStore(
  root: string,
  name: string,
  timestampIso: string,
): Promise<{ indexDb: string; projectsDir: string; storeDir: string }> {
  const repoRoot = path.join(root, name, "repo-root");
  const storeDir = path.join(root, name, "store");
  const versionDir = path.join(storeDir, "v11");
  const filesDir = path.join(versionDir, "files", "aa");
  const projectsDir = path.join(versionDir, "projects");
  await fsp.mkdir(filesDir, { recursive: true });
  await fsp.mkdir(projectsDir, { recursive: true });
  await fsp.writeFile(path.join(storeDir, ".metadata_never_index"), "", "utf8");
  await fsp.writeFile(path.join(filesDir, "payload"), "payload\n", "utf8");
  await fsp.mkdir(path.join(repoRoot, "projects", "apps", "demo"), { recursive: true });
  await fsp.symlink(repoRoot, path.join(projectsDir, "volatile-project"));

  const indexDb = path.join(versionDir, "index.db");
  const timestamp = Buffer.alloc(9);
  timestamp[0] = 0xcb;
  timestamp.writeDoubleBE(Date.parse(timestampIso), 1);
  const seedSql = path.join(root, `${name}.sql`);
  const sql = [
    "CREATE TABLE package_index (key TEXT PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID;",
    `INSERT INTO package_index(key,data) VALUES('pkg',X'${timestamp.toString("hex")}');`,
  ].join("\n");
  await fsp.writeFile(seedSql, sql, "utf8");
  await $`bash --noprofile --norc -c ${'sqlite3 "$1" < "$2"'} bash ${indexDb} ${seedSql}`;
  await $`touch -t 202607110101 ${path.join(filesDir, "payload")}`;

  return { indexDb, projectsDir, storeDir };
}
