#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifiedRegistrySourceCopy } from "../../dev/install/cargo-registry-integrity";
import { cargoSourceMaterialization } from "../../dev/install/cargo-source-materializer";

const sourceRoot = path.resolve(process.env.VIBEROOTS_ROOT || process.cwd());
const source = "registry+https://registry.example.invalid/index";
const key = `dep@1.0.0#${source}`;

test("cold registry extraction ignores hostile GZIP_BIN on the production update runner", async () => {
  const owner = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-registry-canonical-gzip-"));
  const origin = path.join(owner, "registry/src/index/dep-1.0.0");
  const archive = path.join(owner, "registry/cache/index/dep-1.0.0.crate");
  const staged = path.join(owner, "staged/dep-1.0.0");
  const hostile = path.join(owner, "hostile-gzip");
  const marker = path.join(owner, "hostile-gzip-ran");
  const priorGzipBin = process.env.GZIP_BIN;
  const tarEnvironments: NodeJS.ProcessEnv[] = [];
  try {
    await Promise.all([
      fsp.mkdir(origin, { recursive: true }),
      fsp.mkdir(path.dirname(archive), { recursive: true }),
      fsp.mkdir(staged, { recursive: true }),
    ]);
    await fsp.writeFile(
      path.join(staged, "Cargo.toml"),
      "[package]\nname='dep'\nversion='1.0.0'\n",
    );
    await fsp.writeFile(hostile, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 97\n`);
    await fsp.chmod(hostile, 0o755);
    process.env.GZIP_BIN = hostile;
    const production = cargoSourceMaterialization(sourceRoot, {
      observeCommand: ({ command, env }) => {
        if (command === "tar") tarEnvironments.push(env);
      },
    });
    await production.runGit(
      "tar",
      ["-czf", archive, "-C", path.dirname(staged), path.basename(staged)],
      owner,
    );
    await assert.rejects(fsp.access(marker), /ENOENT/);
    const archiveChecksum = crypto
      .createHash("sha256")
      .update(await fsp.readFile(archive))
      .digest("hex");
    const verified = await verifiedRegistrySourceCopy(
      origin,
      key,
      source,
      archiveChecksum,
      production.runGit,
      owner,
    );
    try {
      assert.match(await fsp.readFile(path.join(verified.root, "Cargo.toml"), "utf8"), /dep/);
      assert.ok(tarEnvironments.length >= 2);
      for (const env of tarEnvironments) {
        assert.equal(env.GZIP_BIN, undefined);
        assert.equal(env.GZIP, undefined);
        assert.equal(env.TAR_OPTIONS, undefined);
      }
      await assert.rejects(fsp.access(marker), /ENOENT/);
    } finally {
      await verified.cleanup();
    }
  } finally {
    if (priorGzipBin === undefined) delete process.env.GZIP_BIN;
    else process.env.GZIP_BIN = priorGzipBin;
    await fsp.rm(owner, { recursive: true, force: true });
  }
});
