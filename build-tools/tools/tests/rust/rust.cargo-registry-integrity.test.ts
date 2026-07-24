#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifiedRegistrySourceCopy } from "../../dev/install/cargo-registry-integrity";

const source = "registry+https://registry.example.invalid/index";
const key = `dep@1.0.0#${source}`;
const packageChecksum = crypto.createHash("sha256").update("dep archive").digest("hex");
const digest = (bytes: string) => crypto.createHash("sha256").update(bytes).digest("hex");

async function fixture(
  files: Record<string, string> = { "Cargo.toml": "[package]\nname='dep'\nversion='1.0.0'\n" },
): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-registry-integrity-"));
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(root, relative);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, bytes);
  }
  await fsp.writeFile(
    path.join(root, ".cargo-checksum.json"),
    JSON.stringify({
      files: Object.fromEntries(
        Object.entries(files).map(([name, bytes]) => [name, digest(bytes)]),
      ),
      package: packageChecksum,
    }),
  );
  return root;
}

async function rejectsMutation(
  mutate: (root: string) => Promise<void>,
  pattern: RegExp,
): Promise<void> {
  const root = await fixture();
  try {
    await mutate(root);
    await assert.rejects(verifiedRegistrySourceCopy(root, key, source, packageChecksum), pattern);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("registry integrity snapshots only verified files and preserves checksum metadata", async () => {
  const root = await fixture({ "Cargo.toml": "manifest\n", "src/lib.rs": "pub fn value() {}\n" });
  try {
    const checksumRaw = await fsp.readFile(path.join(root, ".cargo-checksum.json"), "utf8");
    const verified = await verifiedRegistrySourceCopy(root, key, source, packageChecksum);
    try {
      assert.notEqual(verified.root, root);
      assert.equal(
        await fsp.readFile(path.join(verified.root, "src/lib.rs"), "utf8"),
        "pub fn value() {}\n",
      );
      assert.equal(
        await fsp.readFile(path.join(verified.root, ".cargo-checksum.json"), "utf8"),
        checksumRaw,
      );
    } finally {
      await verified.cleanup();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("registry integrity rejects tampered, missing, and unexpected files", async () => {
  await rejectsMutation(
    (root) => fsp.writeFile(path.join(root, "Cargo.toml"), "tampered\n"),
    /file checksum mismatch/,
  );
  await rejectsMutation(
    (root) => fsp.rm(path.join(root, "Cargo.toml")),
    /do not exactly match checksum metadata/,
  );
  await rejectsMutation(
    (root) => fsp.writeFile(path.join(root, "extra.rs"), "unexpected\n"),
    /do not exactly match checksum metadata/,
  );
});

test("registry integrity rejects traversal, normalization collisions, and symlinks", async () => {
  await rejectsMutation(async (root) => {
    const metadata = JSON.parse(
      await fsp.readFile(path.join(root, ".cargo-checksum.json"), "utf8"),
    );
    metadata.files["../Cargo.toml"] = metadata.files["Cargo.toml"];
    await fsp.writeFile(path.join(root, ".cargo-checksum.json"), JSON.stringify(metadata));
  }, /unsafe or non-canonical path/);
  await rejectsMutation(async (root) => {
    const metadata = JSON.parse(
      await fsp.readFile(path.join(root, ".cargo-checksum.json"), "utf8"),
    );
    metadata.files["/Cargo.toml"] = metadata.files["Cargo.toml"];
    await fsp.writeFile(path.join(root, ".cargo-checksum.json"), JSON.stringify(metadata));
  }, /unsafe or non-canonical path/);
  await rejectsMutation(async (root) => {
    const metadata = JSON.parse(
      await fsp.readFile(path.join(root, ".cargo-checksum.json"), "utf8"),
    );
    metadata.files["src/../Cargo.toml"] = metadata.files["Cargo.toml"];
    await fsp.writeFile(path.join(root, ".cargo-checksum.json"), JSON.stringify(metadata));
  }, /unsafe or non-canonical path/);
  await rejectsMutation(async (root) => {
    await fsp.symlink("Cargo.toml", path.join(root, "linked.toml"));
  }, /contains a symlink/);
});

test("registry integrity rejects malformed hashes and checksum schema", async () => {
  await rejectsMutation(async (root) => {
    const metadata = JSON.parse(
      await fsp.readFile(path.join(root, ".cargo-checksum.json"), "utf8"),
    );
    metadata.files["Cargo.toml"] = "not-a-sha256";
    await fsp.writeFile(path.join(root, ".cargo-checksum.json"), JSON.stringify(metadata));
  }, /file checksum must be a SHA-256/);
  await rejectsMutation(
    (root) => fsp.writeFile(path.join(root, ".cargo-checksum.json"), '{"files":[],"package":7}'),
    /invalid package\/files schema/,
  );
  await rejectsMutation(
    (root) =>
      fsp.writeFile(
        path.join(root, ".cargo-checksum.json"),
        `{"files":{"Cargo.toml":"${digest("wrong")}","Cargo.toml":"${digest("also wrong")}"},"package":"${packageChecksum}"}`,
      ),
    /duplicate JSON key/,
  );
  const root = await fixture();
  try {
    await assert.rejects(
      verifiedRegistrySourceCopy(root, key, source, digest("different archive")),
      /Cargo.lock package checksum/,
    );
    await assert.rejects(
      verifiedRegistrySourceCopy(
        root,
        `dep@1.0.0#registry+https://wrong.invalid`,
        source,
        packageChecksum,
      ),
      /identity does not match Cargo.lock/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
