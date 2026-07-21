#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { enterCanonicalArtifactEntrypoint } from "../../dev/canonical-artifact-entrypoint";
import {
  canonicalDevOverrideArg,
  evaluationBundleDevOverrides,
  evaluationBundleWasmBackend,
  withoutWasmBackendArgs,
} from "../../dev/evaluation-bundle-selectors";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const artifactToolsRoot = canonicalArtifactToolsRoot(
  process.cwd(),
  String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
);
const execFileAsync = promisify(execFile);
const DEV_OVERRIDE_CHILD = "--canonical-dev-override-child";

if (process.argv.includes(DEV_OVERRIDE_CHILD)) {
  enterCanonicalArtifactEntrypoint(process.cwd(), { allowDevOverrides: true });
  process.stdout.write(
    `${JSON.stringify({
      argv: process.argv.slice(2),
      env: Object.fromEntries(
        [
          "NIX_GO_DEV_OVERRIDE_JSON",
          "NIX_CPP_DEV_OVERRIDE_JSON",
          "NIX_PY_DEV_OVERRIDE_JSON",
          "WEB_WASM_BACKEND",
        ].map((name) => [name, process.env[name]]),
      ),
    })}\n`,
  );
  process.exit(0);
}

test("Wasm backend ingress converts environment authority to canonical argv", () => {
  assert.equal(evaluationBundleWasmBackend([], { WEB_WASM_BACKEND: "wasi_single" }), "wasi_single");
  assert.equal(evaluationBundleWasmBackend(["--wasm-backend=wasi_single"], {}), "wasi_single");
  assert.equal(
    evaluationBundleWasmBackend(["--wasm-backend", "wasi_single"], {
      WEB_WASM_BACKEND: "wasi_single",
    }),
    "wasi_single",
  );
  assert.throws(
    () =>
      evaluationBundleWasmBackend(["--wasm-backend=other"], {
        WEB_WASM_BACKEND: "wasi_single",
      }),
    /conflicting wasm backend selectors/,
  );
  assert.throws(
    () => evaluationBundleWasmBackend(["--wasm-backend=wasi_single", "--wasm-backend=wasi_single"]),
    /conflicting wasm backend selectors/,
  );
});

test("Wasm backend transport is consumed before downstream command argv", () => {
  assert.deepEqual(
    withoutWasmBackendArgs([
      "build",
      "//projects/apps/demo:app",
      "--wasm-backend=wasi_single",
      "--show-output",
    ]),
    ["build", "//projects/apps/demo:app", "--show-output"],
  );
  assert.deepEqual(
    withoutWasmBackendArgs(["build", "--wasm-backend", "wasi_single", "//projects/apps/demo:app"]),
    ["build", "//projects/apps/demo:app"],
  );
});

test("canonical artifact runtime strips the ambient Wasm backend selector", () => {
  const toolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const previous = process.env.WEB_WASM_BACKEND;
  process.env.WEB_WASM_BACKEND = "wasi_single";
  try {
    const env = buildCanonicalArtifactEnvironment(process.cwd(), {
      artifactToolsRoot: toolsRoot,
    });
    assert.equal(env.WEB_WASM_BACKEND, undefined);
  } finally {
    if (previous === undefined) delete process.env.WEB_WASM_BACKEND;
    else process.env.WEB_WASM_BACKEND = previous;
  }
});

test("graph evaluation reads the Wasm backend only from immutable bundle selection", async () => {
  const graphGenerator = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/nix/graph-generator.nix"),
    "utf8",
  );
  assert.doesNotMatch(graphGenerator, /getEnv "WEB_WASM_BACKEND"/);
  assert.match(graphGenerator, /evaluationBundle\.selection\.wasmBackend or ""/);
});

test("canonical re-exec transports the Wasm backend only through argv", async () => {
  const source = fileURLToPath(import.meta.url);
  const zxInit = path.resolve("viberoots/build-tools/tools/dev/zx-init.mjs");
  const { stdout } = await execFileAsync(
    path.join(artifactToolsRoot, "bin", "node"),
    ["--experimental-strip-types", "--import", zxInit, source, DEV_OVERRIDE_CHILD],
    {
      cwd: process.cwd(),
      env: {
        HOME: os.homedir(),
        PATH: path.join(artifactToolsRoot, "bin"),
        WEB_WASM_BACKEND: "wasi_single",
      },
    },
  );
  const result = JSON.parse(String(stdout).trim()) as {
    argv: string[];
    env: Record<string, string | undefined>;
  };
  assert.equal(result.argv.filter((arg) => arg === "--wasm-backend=wasi_single").length, 1);
  assert.deepEqual(result.env, {});
});

test("development overrides convert once to canonical argv and reject competing authority", () => {
  const override = JSON.stringify({ "example.test/mod@v1": "./local-go" });
  const fromEnv = evaluationBundleDevOverrides([], { NIX_GO_DEV_OVERRIDE_JSON: override });
  assert.deepEqual(JSON.parse(fromEnv.NIX_GO_DEV_OVERRIDE_JSON!), {
    "example.test/mod@v1": path.resolve("local-go"),
  });
  const arg = canonicalDevOverrideArg(fromEnv);
  assert.match(arg, /^--dev-overrides=[0-9a-f]+$/);
  assert.deepEqual(evaluationBundleDevOverrides([arg], {}), fromEnv);
  assert.throws(
    () => evaluationBundleDevOverrides([arg], { NIX_GO_DEV_OVERRIDE_JSON: override }),
    /conflicting dev override environment and canonical argv transport/,
  );
  assert.throws(
    () => evaluationBundleDevOverrides([arg, arg], {}),
    /duplicate or empty canonical dev override transport/,
  );
});

test("canonical artifact runtime does not retain development override environment", () => {
  const env = buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot });
  for (const name of [
    "NIX_GO_DEV_OVERRIDE_JSON",
    "NIX_CPP_DEV_OVERRIDE_JSON",
    "NIX_PY_DEV_OVERRIDE_JSON",
  ]) {
    assert.equal(env[name], undefined);
  }
});

test("canonical re-exec transports a validated development override only through argv", async () => {
  const source = fileURLToPath(import.meta.url);
  const zxInit = path.resolve("viberoots/build-tools/tools/dev/zx-init.mjs");
  const override = JSON.stringify({ "example.test/mod@v1": process.cwd() });
  const { stdout } = await execFileAsync(
    path.join(artifactToolsRoot, "bin", "node"),
    ["--experimental-strip-types", "--import", zxInit, source, DEV_OVERRIDE_CHILD],
    {
      cwd: process.cwd(),
      env: {
        HOME: os.homedir(),
        PATH: path.join(artifactToolsRoot, "bin"),
        NIX_GO_DEV_OVERRIDE_JSON: override,
      },
    },
  );
  const result = JSON.parse(String(stdout).trim()) as {
    argv: string[];
    env: Record<string, string | undefined>;
  };
  assert.equal(result.argv.includes(DEV_OVERRIDE_CHILD), true);
  assert.equal(result.argv.filter((arg) => arg.startsWith("--dev-overrides=")).length, 1);
  assert.deepEqual(result.env, {});
});

test("canonical ingress rejects duplicate workspace-root transport", async () => {
  const source = fileURLToPath(import.meta.url);
  const zxInit = path.resolve("viberoots/build-tools/tools/dev/zx-init.mjs");
  const rootArg = `--artifact-workspace-root=${process.cwd()}`;
  await assert.rejects(
    execFileAsync(
      path.join(artifactToolsRoot, "bin", "node"),
      [
        "--experimental-strip-types",
        "--import",
        zxInit,
        source,
        DEV_OVERRIDE_CHILD,
        rootArg,
        rootArg,
      ],
      {
        cwd: process.cwd(),
        env: { HOME: os.homedir(), PATH: path.join(artifactToolsRoot, "bin") },
      },
    ),
    /canonical artifact ingress requires one non-empty workspace-root transport/,
  );
});
