#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { materializeEvaluationBundle } from "../../dev/evaluation-bundle";
import { inventoryBundleSource } from "../../dev/evaluation-bundle-manifest";
import {
  assertUnsupportedBundleEntryRejected,
  artifactEnvForTmp,
  artifactToolsRoot,
  tempBundleDirs,
  writeEvaluationBundleFixture as fixture,
} from "./evaluation-bundle-test-fixture";

test("bundle manifests are identical for CoW and full-copy construction", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-parity-"));
  const captures: string[] = [];
  await fixture(root);
  const register = async (bundleRoot: string) => {
    const files = await inventoryBundleSource(bundleRoot);
    captures.push(JSON.stringify(files));
    return "/nix/store/00000000000000000000000000000000-viberoots-evaluation-bundle";
  };
  try {
    const none = await materializeEvaluationBundle(
      {
        stagedSource: root,
        attr: "graph-generator",
        classification: "hermetic",
        artifactToolsRoot,
        selectorEnv: {},
        sourceRevision: "a".repeat(40),
      },
      { register, copyMode: "none" },
    );
    const cow = await materializeEvaluationBundle(
      {
        stagedSource: root,
        attr: "graph-generator",
        classification: "hermetic",
        artifactToolsRoot,
        selectorEnv: {},
        sourceRevision: "a".repeat(40),
      },
      { register, copyMode: "try" },
    );
    assert.equal(cow.digest, none.digest);
    assert.equal(captures[1], captures[0]);
    assert.match(captures[0]!, /source-authority\.json/);
    assert.match(none.flakeRef, /\?dir=source#graph-generator$/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("bundle captures planner selectors and rewrites override sources", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-selectors-"));
  const root = path.join(tmp, "source");
  const override = path.join(tmp, "override");
  const registered = path.join(tmp, "registered");
  await fixture(root);
  await fsp.mkdir(override);
  await fsp.writeFile(path.join(override, "module.txt"), "captured\n");
  try {
    await materializeEvaluationBundle(
      {
        stagedSource: root,
        attr: "graph-generator",
        classification: "local-development",
        artifactToolsRoot,
        selectorEnv: {
          TEST_EXCLUDE_CPP_REQS: "1",
          TEST_PARTIAL_CLONE_GO_ONLY: "1",
          TEST_RSYNC_ROOTS: "viberoots, projects/app viberoots",
        },
        devOverrides: {
          NIX_GO_DEV_OVERRIDE_JSON: JSON.stringify({ "example.test/mod@v1": override }),
        },
        wasmBackend: "wasi_single",
        onlyCpp: true,
        coverage: true,
      },
      {
        register: async (bundleRoot) => {
          await fsp.cp(bundleRoot, registered, { recursive: true });
          return registered;
        },
      },
    );
    const selection = JSON.parse(
      await fsp.readFile(path.join(registered, "selection.json"), "utf8"),
    );
    const captured = selection.languageOverrides.NIX_GO_DEV_OVERRIDE_JSON["example.test/mod@v1"];
    assert.equal(selection.onlyCpp, true);
    assert.deepEqual(selection.verifySeed, {
      excludeCppReqs: true,
      partialCloneGoOnly: true,
      rsyncRoots: ["projects/app", "viberoots"],
    });
    assert.equal(selection.wasmBackend, "wasi_single");
    assert.equal(selection.coverage, true);
    assert.match(captured, /^overrides\/NIX_GO_DEV_OVERRIDE_JSON\/0000$/);
    assert.equal(
      await fsp.readFile(path.join(registered, captured, "module.txt"), "utf8"),
      "captured\n",
    );
    const manifest = JSON.parse(await fsp.readFile(path.join(registered, "manifest.json"), "utf8"));
    assert.ok(
      manifest.files.some((file: { path: string }) => file.path === `${captured}/module.txt`),
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle construction rejects external symlinks and cleans failure roots", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-cleanup-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await fixture(root);
  await fsp.symlink("/etc/passwd", path.join(root, "projects", "app", "external"));
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle({
        stagedSource: root,
        attr: "graph-generator",
        classification: "hermetic",
        artifactEnv: artifactEnvForTmp(tmp),
        selectorEnv: {},
      }),
      /external symlink: .*projects.*app.*external/,
    );
    assert.deepEqual(await tempBundleDirs(tmp), []);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("registration failure preserves its cause and cleans the owned root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-register-failure-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await fixture(root);
  process.env.TMPDIR = tmp;
  try {
    await assert.rejects(
      materializeEvaluationBundle(
        {
          stagedSource: root,
          attr: "graph-generator",
          classification: "hermetic",
          artifactEnv: artifactEnvForTmp(tmp),
          selectorEnv: {},
        },
        { register: async () => Promise.reject(new Error("registration timed out")) },
      ),
      /registration timed out/,
    );
    assert.deepEqual(await tempBundleDirs(tmp), []);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle construction rejects unsupported filesystem entries", async () => {
  await assertUnsupportedBundleEntryRejected();
});

test("SIGTERM waits for construction and removes the owned root", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-interrupt-"));
  const root = path.join(tmp, "source");
  await fixture(root);
  const fixturePath = fileURLToPath(
    new URL("./evaluation-bundle-interrupt.fixture.ts", import.meta.url),
  );
  const zxInit = fileURLToPath(new URL("../../dev/zx-init.mjs", import.meta.url));
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", zxInit, fixturePath, root],
      { env: { ...process.env, NODE_OPTIONS: "", TMPDIR: tmp }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("registration-ready")) child.kill("SIGTERM");
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
  });
  try {
    assert.equal(result.code, 0);
    assert.match(result.stderr, /evaluation bundle interrupted by SIGTERM/);
    assert.deepEqual(await tempBundleDirs(tmp), []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("bundle cleanup fails closed when ownership becomes ambiguous", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "evaluation-bundle-owner-"));
  const root = path.join(tmp, "source");
  const priorTmp = process.env.TMPDIR;
  await fixture(root);
  process.env.TMPDIR = tmp;
  try {
    const primary = new Error("registration failed");
    await assert.rejects(
      materializeEvaluationBundle(
        {
          stagedSource: root,
          attr: "graph-generator",
          classification: "hermetic",
          artifactEnv: artifactEnvForTmp(tmp),
          selectorEnv: {},
        },
        {
          register: async (bundleRoot) => {
            const marker = path.join(
              path.dirname(bundleRoot),
              ".viberoots-evaluation-bundle-owner",
            );
            await fsp.writeFile(marker, "different owner\n");
            throw primary;
          },
        },
      ),
      (error) =>
        error === primary &&
        primary.cause instanceof Error &&
        /cleanup ownership is ambiguous/.test(primary.cause.message),
    );
    assert.equal((await tempBundleDirs(tmp)).length, 1);
  } finally {
    if (priorTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmp;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
