#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repairRustDependencies } from "../../dev/install/cargo";
import { addCargoRoot, rustUpdateFixture, withCargoEnv } from "./rust.cargo-update.fixture";

test("Rust update publishes exact locked fixed-source metadata for patch authoring", async () => {
  const value = await rustUpdateFixture();
  try {
    const source = "registry+https://registry.example/index";
    const origin = path.join(
      value.root,
      ".viberoots/workspace/cargo-home/registry/src/exact/dep-1.0.0",
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
        path.join(value.root, ".viberoots/workspace/cargo-home/viberoots-fixed-sources.json"),
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
