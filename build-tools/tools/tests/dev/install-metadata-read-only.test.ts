import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { withGoModuleInputFingerprint } from "../../dev/install/go-consistency";
import { runGomod2nixGenerateIn } from "../../dev/install/gomod2nix";
import { runUvRefreshAll } from "../../dev/install/uv";
import { assertCppTrackedMetadataReady } from "../../dev/install/metadata-mode";
import { glueFreshnessOutputs, writeGlueFingerprint } from "../../dev/install/glue-freshness";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { runInScratchTemp } from "../lib/test-helpers/run-in-temp";

const execFileAsync = promisify(execFile);

async function expectReadOnlyFailure(run: () => Promise<void>, file: string): Promise<void> {
  await assert.rejects(run, (error: Error) => {
    assert.match(error.message, new RegExp(`tracked metadata is stale: ${file}`));
    assert.match(error.message, /no tracked files were modified/);
    return true;
  });
}

async function writeGoMetadata(dir: string, body = "schema = 3\n\n[mod]\n"): Promise<string> {
  const metadata = await withGoModuleInputFingerprint(dir, body);
  await fsp.writeFile(path.join(dir, "gomod2nix.toml"), metadata);
  return metadata;
}

test("read-only install rejects changed go.sum despite newer metadata mtime", async () => {
  await runInScratchTemp("install-read-only-go-sum-semantic", async (root) => {
    const previousRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = root;
      await fsp.writeFile(path.join(root, "go.mod"), "module example.com/read-only\n\ngo 1.24\n");
      await fsp.writeFile(path.join(root, "go.sum"), "");
      await writeGoMetadata(root);
      await fsp.writeFile(
        path.join(root, "go.sum"),
        "example.com/unused v1.0.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n",
      );
      const newer = new Date(Date.now() + 10_000);
      await fsp.utimes(path.join(root, "go.sum"), newer, newer);
      await fsp.utimes(path.join(root, "gomod2nix.toml"), newer, newer);

      await expectReadOnlyFailure(
        () => runGomod2nixGenerateIn(root, false, false, true),
        "gomod2nix.toml",
      );
    } finally {
      if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previousRoot;
    }
  });
});

test("read-only install rejects gomod2nix without an input fingerprint", async () => {
  await runInScratchTemp("install-read-only-gomod2nix-semantic", async (root) => {
    const previousRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = root;
      await fsp.writeFile(path.join(root, "go.mod"), "module example.com/read-only\n\ngo 1.24\n");
      await fsp.writeFile(path.join(root, "go.sum"), "");
      await fsp.writeFile(path.join(root, "gomod2nix.toml"), "schema = 3\n\n[mod]\nstale = true\n");
      const newer = new Date(Date.now() + 10_000);
      await fsp.utimes(path.join(root, "gomod2nix.toml"), newer, newer);

      await expectReadOnlyFailure(
        () => runGomod2nixGenerateIn(root, false, false, true),
        "gomod2nix.toml",
      );
    } finally {
      if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previousRoot;
    }
  });
});

test("read-only Go check preserves relative replaces and requires no tools", async () => {
  await runInScratchTemp("install-read-only-go-local-replace", async (root) => {
    const moduleDir = path.join(root, "module");
    const localDir = path.join(root, "local");
    const noTools = path.join(root, "no-tools");
    const previousRoot = process.env.WORKSPACE_ROOT;
    const previousPath = process.env.PATH;
    try {
      await fsp.mkdir(moduleDir);
      await fsp.mkdir(localDir);
      await fsp.writeFile(path.join(localDir, "go.mod"), "module example.com/local\n");
      await fsp.writeFile(
        path.join(moduleDir, "go.mod"),
        "module example.com/app\n\ngo 1.24\n\nrequire example.com/local v0.0.0\nreplace example.com/local => ../local\n",
      );
      await fsp.writeFile(path.join(moduleDir, "go.sum"), "");
      await writeGoMetadata(moduleDir);
      process.env.WORKSPACE_ROOT = root;
      process.env.PATH = noTools;

      await runGomod2nixGenerateIn(moduleDir, false, false, true);
    } finally {
      if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previousRoot;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
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
      const uv = ensureNixStoreToolPathSync("uv");
      await execFileAsync(uv, ["lock"], { cwd: root });
      await execFileAsync(uv, ["lock", "--check"], {
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

test("read-only install rejects pyproject.toml without uv.lock", async () => {
  await runInScratchTemp("install-read-only-uv-missing", async (root) => {
    const previousRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = root;
      await fsp.writeFile(path.join(root, "pyproject.toml"), "[project]\nname = 'missing-lock'\n");
      await expectReadOnlyFailure(() => runUvRefreshAll(false, false, true), "uv.lock");
      await assert.rejects(fsp.access(path.join(root, "uv.lock")));
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

test("read-only C++ readiness resolves split-consumer build-tools authority", async () => {
  await runInScratchTemp("install-read-only-cpp-split", async (root) => {
    const tools = path.join(root, ".viberoots/current/build-tools");
    for (const rel of [
      "tools/dev/zx-init.mjs",
      "tools/nix/langs.json",
      "tools/nix/langs.nix",
      "lang/auto_map.bzl",
      "lang/nix_attr_aliases.bzl",
    ]) {
      await fsp.mkdir(path.dirname(path.join(tools, rel)), { recursive: true });
      await fsp.writeFile(
        path.join(tools, rel),
        rel.endsWith("langs.json") ? JSON.stringify({ enabled: ["cpp"] }) : "generated\n",
      );
    }
    for (const file of glueFreshnessOutputs(root)) {
      const output = path.join(root, file);
      await fsp.mkdir(path.dirname(output), { recursive: true });
      await fsp.writeFile(output, "generated\n").catch(() => {});
    }
    await writeGlueFingerprint(root);
    await assertCppTrackedMetadataReady(root);
  });
});

test("read-only install accepts semantically current gomod2nix despite older mtime", async () => {
  await runInScratchTemp("install-read-only-gomod2nix", async (root) => {
    const previousRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = root;
      const metadata = path.join(root, "gomod2nix.toml");
      await fsp.writeFile(path.join(root, "go.mod"), "module example.com/read-only\n", "utf8");
      await fsp.writeFile(path.join(root, "go.sum"), "", "utf8");
      const expected = await writeGoMetadata(root);
      const old = new Date(Date.now() - 10_000);
      await fsp.utimes(metadata, old, old);

      await runGomod2nixGenerateIn(root, false, false, true);
      assert.equal(await fsp.readFile(metadata, "utf8"), expected);
    } finally {
      if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previousRoot;
    }
  });
});
