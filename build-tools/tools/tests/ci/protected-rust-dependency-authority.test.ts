#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  materializeProtectedRustDependency,
  verifyProtectedRustDependencySource,
} from "../../ci/protected-rust-dependency-authority";
import {
  createProtectedDependencySource,
  PROTECTED_DEPENDENCY_STORE_NAME,
} from "../../ci/protected-rust-patch-consumer";

const execFileAsync = promisify(execFile);

test("protected Rust dependency verifies checksum metadata before store publication", async () => {
  const ownerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-authority-"));
  const storePath = `/nix/store/${"a".repeat(32)}-viberoots-protected-behavior`;
  const narHash = `sha256-${"A".repeat(43)}=`;
  const storeCommands: string[][] = [];
  try {
    const authority = await materializeProtectedRustDependency({
      ownerRoot,
      artifactToolsRoot: `/nix/store/${"b".repeat(32)}-remote-ci-tools`,
      localRunNix: async (args) => {
        if (args[0] === "store") storeCommands.push(args);
        return { stdout: args[0] === "store" ? `${storePath}\n` : `${narHash}\n`, stderr: "" };
      },
      active: {
        runNix: async (args) => ({
          stdout:
            args[0] === "path-info"
              ? JSON.stringify({ [storePath]: { narHash } })
              : args[0] === "hash"
                ? `${narHash}\n`
                : "",
          stderr: "",
        }),
      },
    });
    assert.equal(authority.storePath, storePath);
    assert.equal(storeCommands.length, 1);
    assert.deepEqual(storeCommands[0]!.slice(0, 4), [
      "store",
      "add-path",
      "--name",
      PROTECTED_DEPENDENCY_STORE_NAME,
    ]);
    assert.equal(storeCommands[0]!.length, 5);
    assert.match(storeCommands[0]![4]!, /vbr-cargo-verified-/u);
  } finally {
    await fsp.rm(ownerRoot, { recursive: true, force: true });
  }
});

test("protected Rust dependency source carries complete file checksums", async () => {
  const ownerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-authority-"));
  try {
    const dependency = await createProtectedDependencySource(ownerRoot);
    const raw = await fsp.readFile(
      path.join(dependency.sourceRoot, ".cargo-checksum.json"),
      "utf8",
    );
    const checksum = JSON.parse(raw) as { files: Record<string, string>; package: string };
    assert.equal(checksum.package, dependency.checksum);
    assert.deepEqual(Object.keys(checksum.files).sort(), ["Cargo.toml", "src/lib.rs"]);
    const verified = await verifyProtectedRustDependencySource(dependency);
    await verified.cleanup();
  } finally {
    await fsp.rm(ownerRoot, { recursive: true, force: true });
  }
});

test("protected Rust dependency rejects incomplete, tampered, and unexpected source bytes", async () => {
  await assertRejectedProtectedMutation(async (dependency) => {
    const checksumPath = path.join(dependency.sourceRoot, ".cargo-checksum.json");
    const checksum = JSON.parse(await fsp.readFile(checksumPath, "utf8")) as {
      files: Record<string, string>;
      package: string;
    };
    delete checksum.files["src/lib.rs"];
    await fsp.writeFile(checksumPath, JSON.stringify(checksum));
  }, /do not exactly match checksum metadata/u);
  await assertRejectedProtectedMutation(
    (dependency) => fsp.writeFile(path.join(dependency.sourceRoot, "src/lib.rs"), "tampered\n"),
    /file checksum mismatch/u,
  );
  await assertRejectedProtectedMutation(
    (dependency) => fsp.writeFile(path.join(dependency.sourceRoot, "extra.rs"), "unexpected\n"),
    /do not exactly match checksum metadata/u,
  );
});

test("protected Rust dependency rejects malformed schema and unsafe paths", async () => {
  await assertRejectedProtectedMutation(
    (dependency) =>
      fsp.writeFile(
        path.join(dependency.sourceRoot, ".cargo-checksum.json"),
        '{"files":[],"package":7}',
      ),
    /invalid package\/files schema/u,
  );
  await assertRejectedProtectedMutation(async (dependency) => {
    const checksumPath = path.join(dependency.sourceRoot, ".cargo-checksum.json");
    const checksum = JSON.parse(await fsp.readFile(checksumPath, "utf8")) as {
      files: Record<string, string>;
      package: string;
    };
    checksum.files["../Cargo.toml"] = checksum.files["Cargo.toml"]!;
    await fsp.writeFile(checksumPath, JSON.stringify(checksum));
  }, /unsafe or non-canonical path/u);
});

test("protected Rust dependency rejects symlinks and non-regular entries", async () => {
  await assertRejectedProtectedMutation(
    (dependency) => fsp.symlink("Cargo.toml", path.join(dependency.sourceRoot, "linked.toml")),
    /contains a symlink/u,
  );
  await assertRejectedProtectedMutation(async (dependency) => {
    await execFileAsync("mkfifo", [path.join(dependency.sourceRoot, "pipe")]);
  }, /contains a non-regular file/u);
});

async function assertRejectedProtectedMutation(
  mutate: (dependency: { sourceRoot: string; checksum: string }) => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  const ownerRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-authority-"));
  try {
    const dependency = await createProtectedDependencySource(ownerRoot);
    await mutate(dependency);
    await assert.rejects(verifyProtectedRustDependencySource(dependency), pattern);
  } finally {
    await fsp.rm(ownerRoot, { recursive: true, force: true });
  }
}
