import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runGoModTidyForMissingSum } from "../../dev/install/go-tidy";
import { runGomod2nixGenerateIn } from "../../dev/install/gomod2nix";
import { runUvRefreshAll } from "../../dev/install/uv";
import { assertCppTrackedMetadataReady } from "../../dev/install/metadata-mode";
import { glueFreshnessOutputs, writeGlueFingerprint } from "../../dev/install/glue-freshness";
import { runInScratchTemp } from "../lib/test-helpers/run-in-temp";

const execFileAsync = promisify(execFile);

async function expectReadOnlyFailure(run: () => Promise<void>, file: string): Promise<void> {
  await assert.rejects(run, (error: Error) => {
    assert.match(error.message, new RegExp(`tracked metadata is stale: ${file}`));
    assert.match(error.message, /no tracked files were modified/);
    return true;
  });
}

test("read-only install rejects missing go.sum without creating it", async () => {
  await runInScratchTemp("install-read-only-go-sum", async (root) => {
    await fsp.writeFile(path.join(root, "go.mod"), "module example.com/read-only\n", "utf8");

    await expectReadOnlyFailure(
      () => runGoModTidyForMissingSum(root, false, false, true),
      "go.sum",
    );
    await assert.rejects(fsp.access(path.join(root, "go.sum")));
  });
});

test("read-only install rejects stale uv.lock without rewriting it", async () => {
  await runInScratchTemp("install-read-only-uv", async (root) => {
    const previousRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = root;
      const lock = path.join(root, "uv.lock");
      const manifest = path.join(root, "pyproject.toml");
      await fsp.writeFile(
        manifest,
        "[project]\nname = 'valid-baseline'\nversion = '0.0.0'\nrequires-python = '>=3.11'\n",
        "utf8",
      );
      await execFileAsync(process.env.INSTALL_DEPS_UV_BIN || "uv", ["lock"], { cwd: root });
      await execFileAsync(process.env.INSTALL_DEPS_UV_BIN || "uv", ["lock", "--check"], {
        cwd: root,
      });
      const originalLock = await fsp.readFile(lock, "utf8");
      await fsp.appendFile(manifest, "dependencies = ['idna==3.10']\n", "utf8");
      const old = new Date(Date.now() - 10_000);
      await fsp.utimes(manifest, old, old);
      await fsp.utimes(lock, new Date(), new Date());
      await expectReadOnlyFailure(() => runUvRefreshAll(false, false, true), "uv.lock");
      assert.equal(await fsp.readFile(lock, "utf8"), originalLock);
    } finally {
      if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previousRoot;
    }
  });
});

test("read-only install rejects missing tracked C++ provider metadata", async () => {
  await runInScratchTemp("install-read-only-cpp", async (root) => {
    await fsp.mkdir(path.join(root, "build-tools/tools/nix"), { recursive: true });
    await fsp.mkdir(path.join(root, "build-tools/lang"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "build-tools/tools/nix/langs.json"),
      JSON.stringify({ enabled: ["cpp"] }),
      "utf8",
    );
    await expectReadOnlyFailure(
      () => assertCppTrackedMetadataReady(root),
      "build-tools/lang/auto_map.bzl",
    );
  });
});

test("read-only install rejects stale-but-present C++ provider inputs", async () => {
  await runInScratchTemp("install-read-only-cpp-stale", async (root) => {
    const outputs = [
      ...glueFreshnessOutputs(root),
      "build-tools/lang/auto_map.bzl",
      "build-tools/lang/nix_attr_aliases.bzl",
      "build-tools/tools/nix/langs.nix",
    ];
    for (const file of new Set(outputs)) {
      await fsp.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fsp.writeFile(path.join(root, file), "generated\n", "utf8");
    }
    const langsJson = path.join(root, "build-tools/tools/nix/langs.json");
    await fsp.mkdir(path.dirname(langsJson), { recursive: true });
    await fsp.writeFile(langsJson, JSON.stringify({ enabled: ["cpp"] }), "utf8");
    await writeGlueFingerprint(root);
    const before = await fsp.stat(langsJson);
    await fsp.writeFile(langsJson, JSON.stringify({ enabled: ["cpp"], changed: true }), "utf8");
    await fsp.utimes(langsJson, before.atime, before.mtime);

    await expectReadOnlyFailure(
      () => assertCppTrackedMetadataReady(root),
      "build-tools/tools/nix/langs.json",
    );
  });
});

test("read-only install rejects stale gomod2nix metadata without rewriting it", async () => {
  await runInScratchTemp("install-read-only-gomod2nix", async (root) => {
    const previousRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = root;
      const metadata = path.join(root, "gomod2nix.toml");
      await fsp.writeFile(path.join(root, "go.mod"), "module example.com/read-only\n", "utf8");
      await fsp.writeFile(path.join(root, "go.sum"), "", "utf8");
      await fsp.writeFile(metadata, "schema = 3\n\n[mod]\n", "utf8");
      const old = new Date(Date.now() - 10_000);
      await fsp.utimes(metadata, old, old);

      await expectReadOnlyFailure(
        () => runGomod2nixGenerateIn(root, false, false, true),
        "gomod2nix.toml",
      );
      assert.equal(await fsp.readFile(metadata, "utf8"), "schema = 3\n\n[mod]\n");
    } finally {
      if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previousRoot;
    }
  });
});
