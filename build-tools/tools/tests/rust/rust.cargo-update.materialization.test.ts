#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repairRustDependencies } from "../../dev/install/cargo";
import {
  cachedFixedSourceGcRoot,
  readCachedFixedSource,
  writeCachedFixedSource,
} from "../../dev/install/cargo-fixed-source-cache";
import { materializeFixedSources } from "../../dev/install/cargo-fixed-sources";
import { addCargoRoot, rustUpdateFixture, withCargoEnv } from "./rust.cargo-update.fixture";

test("Rust update publishes exact locked fixed-source metadata for patch authoring", async () => {
  const value = await rustUpdateFixture();
  try {
    const source = "registry+https://registry.example/index";
    const origin = path.join(
      value.root,
      ".viberoots/cargo-home.noindex/registry/src/exact/dep-1.0.0",
    );
    await fsp.mkdir(origin, { recursive: true });
    const manifestBytes = "[package]\nname='dep'\nversion='1'\n";
    const fileChecksum = crypto.createHash("sha256").update(manifestBytes).digest("hex");
    const packageChecksum = crypto.createHash("sha256").update("dep crate archive").digest("hex");
    await fsp.writeFile(path.join(origin, "Cargo.toml"), manifestBytes);
    await fsp.writeFile(
      path.join(origin, ".cargo-checksum.json"),
      `${JSON.stringify({ files: { "Cargo.toml": fileChecksum }, package: packageChecksum })}\n`,
    );
    await addCargoRoot(
      value.root,
      "metadata",
      `version=3\n[[package]]\nname="dep"\nversion="1.0.0"\nsource="${source}"\nchecksum="${packageChecksum}"\n`,
    );
    await withCargoEnv(
      {
        FAKE_CARGO_LOG: value.log,
        FAKE_CARGO_PRESERVE_LOCK: "1",
        FAKE_CARGO_METADATA_JSON: JSON.stringify({
          packages: [
            {
              name: "dep",
              version: "1.0.0",
              source,
              manifest_path: path.join(origin, "Cargo.toml"),
            },
          ],
        }),
      },
      async () =>
        await repairRustDependencies(value.root, false, false, value.cargo, async (_key, entry) => {
          assert.notEqual(entry.originPath, origin);
          assert.equal(
            await fsp.readFile(path.join(entry.originPath, "Cargo.toml"), "utf8"),
            manifestBytes,
          );
          assert.deepEqual(
            JSON.parse(
              await fsp.readFile(path.join(entry.originPath, ".cargo-checksum.json"), "utf8"),
            ),
            { files: { "Cargo.toml": fileChecksum }, package: packageChecksum },
          );
          return {
            storePath: "/nix/store/fixture-private-registry-source",
            narHash: "sha256-fixture",
          };
        }),
    );
    const manifest = JSON.parse(
      await fsp.readFile(
        path.join(value.root, ".viberoots/cargo-home.noindex/viberoots-fixed-sources.json"),
        "utf8",
      ),
    );
    assert.deepEqual(manifest[`dep@1.0.0#${source}`], {
      originPath: await fsp.realpath(origin),
      source,
      checksum: packageChecksum,
      storePath: "/nix/store/fixture-private-registry-source",
      narHash: "sha256-fixture",
      buildInput: {
        source,
        checksum: packageChecksum,
        storePath: "/nix/store/fixture-private-registry-source",
        narHash: "sha256-fixture",
      },
    });
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("fixed-source materialization reuses verified registry cache entries", async () => {
  const value = await rustUpdateFixture();
  try {
    const source = "registry+https://registry.example/index";
    const checksum = crypto.createHash("sha256").update("dep crate archive").digest("hex");
    const manifestBytes = "[package]\nname='dep'\nversion='1'\n";
    const fileChecksum = crypto.createHash("sha256").update(manifestBytes).digest("hex");
    const origin = path.join(value.root, "registry-src", "dep-1.0.0");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "Cargo.toml"), manifestBytes);
    await fsp.writeFile(
      path.join(origin, ".cargo-checksum.json"),
      `${JSON.stringify({ files: { "Cargo.toml": fileChecksum }, package: checksum })}\n`,
    );
    const key = `dep@1.0.0#${source}`;
    let cached: { storePath: string; narHash: string } | null = null;
    let addCalls = 0;
    const deferred = {
      lookup: async () => cached,
      add: async () => {
        addCalls += 1;
        return { storePath: "/nix/store/00000000000000000000000000000000-vbr-cargo-dep" };
      },
      hash: async () => ["sha256-cached-dep"],
      store: async (
        _key: string,
        _entry: unknown,
        value: { storePath: string; narHash: string },
      ) => {
        cached = value;
      },
    };
    const first = await materializeFixedSources(
      { [key]: { originPath: origin, source, checksum } },
      async () => {
        throw new Error("direct materialization should not be used with deferred cache");
      },
      undefined,
      undefined,
      deferred,
    );
    assert.equal(first[key]?.storePath, cached?.storePath);
    assert.equal(addCalls, 1);

    await fsp.writeFile(path.join(origin, "Cargo.toml"), "tampered\n");
    const second = await materializeFixedSources(
      { [key]: { originPath: origin, source, checksum } },
      async () => {
        throw new Error("cached registry source should skip rematerialization");
      },
      undefined,
      undefined,
      deferred,
    );
    assert.equal(second[key]?.storePath, cached?.storePath);
    assert.equal(addCalls, 1);
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("fixed-source cache roots store paths before publishing reusable metadata", async () => {
  const value = await rustUpdateFixture();
  try {
    const cacheRoot = path.join(value.root, "fixed-source-cache");
    const source = "registry+https://registry.example/index";
    const checksum = crypto.createHash("sha256").update("dep crate archive").digest("hex");
    const key = `dep@1.0.0#${source}`;
    const entry = { originPath: value.root, source, checksum };
    const cached = {
      storePath: "/nix/store/00000000000000000000000000000000-vbr-cargo-dep",
      narHash: "sha256-cached-dep",
    };
    const rootCalls: Array<{ rootPath: string; storePath: string }> = [];
    await writeCachedFixedSource(cacheRoot, key, entry, cached, {
      addRoot: async (rootPath, storePath) => {
        rootCalls.push({ rootPath, storePath });
        await fsp.mkdir(path.dirname(rootPath), { recursive: true });
        await fsp.symlink(storePath, rootPath);
      },
    });

    assert.deepEqual(rootCalls, [
      { rootPath: cachedFixedSourceGcRoot(cacheRoot, key, entry), storePath: cached.storePath },
    ]);
    assert.deepEqual(
      await readCachedFixedSource(cacheRoot, key, entry, async (storePath) => {
        assert.equal(storePath, cached.storePath);
        return true;
      }),
      cached,
    );
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});

test("fixed-source cache does not publish metadata when GC rooting fails", async () => {
  const value = await rustUpdateFixture();
  try {
    const cacheRoot = path.join(value.root, "fixed-source-cache");
    const source = "registry+https://registry.example/index";
    const checksum = crypto.createHash("sha256").update("dep crate archive").digest("hex");
    const key = `dep@1.0.0#${source}`;
    const entry = { originPath: value.root, source, checksum };
    await writeCachedFixedSource(
      cacheRoot,
      key,
      entry,
      {
        storePath: "/nix/store/00000000000000000000000000000000-vbr-cargo-dep",
        narHash: "sha256-cached-dep",
      },
      {
        addRoot: async () => {
          throw new Error("rooting unavailable");
        },
      },
    );

    assert.equal(await readCachedFixedSource(cacheRoot, key, entry, async () => true), null);
  } finally {
    await fsp.rm(value.root, { recursive: true, force: true });
  }
});
