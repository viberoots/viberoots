#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

type SsrManifestOpts = {
  framework?: string;
  prodArgv?: string[];
  includeServerEntry?: boolean;
  includeClientDir?: boolean;
  includeDev?: boolean;
};

async function writeSsrManifest(tmp: string, opts: SsrManifestOpts = {}): Promise<string> {
  const outRoot = path.join(tmp, "buck-out", "tmp", "ssr-contract-out");
  const serverEntry = path.join(outRoot, "dist", "server", "index.js");
  const clientDir = path.join(outRoot, "dist", "client");
  await fsp.mkdir(path.dirname(serverEntry), { recursive: true });
  await fsp.mkdir(clientDir, { recursive: true });
  await fsp.writeFile(serverEntry, "console.log('server');\n", "utf8");

  const manifestPath = path.join(
    tmp,
    "buck-out",
    "tmp",
    `runnable.ssr-negative.${Date.now()}.json`,
  );
  await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
  const artifacts: Record<string, string> = {};
  if (opts.includeServerEntry !== false) artifacts.serverEntry = serverEntry;
  if (opts.includeClientDir !== false) artifacts.clientDir = clientDir;
  const runnable: Record<string, unknown> = {
    kind: "webapp-ssr",
    framework: opts.framework ?? "next",
    run: {
      prod: { argv: opts.prodArgv ?? ["node", serverEntry] },
      ...(opts.includeDev === false
        ? {}
        : { dev: { argv: ["pnpm", "--dir", "projects/apps/ssr", "dev:ssr"] } }),
    },
    artifacts,
  };
  await fsp.writeFile(
    manifestPath,
    JSON.stringify(
      [
        {
          label: "//projects/apps/ssr:app",
          kind: "app",
          bins: [],
          aux: [],
          runnable,
        },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return manifestPath;
}

test("SSR run command fails on missing or invalid framework discriminator", async () => {
  await runInTemp("runnable-ssr-negative-framework", async (tmp, $) => {
    const manifestPath = await writeSsrManifest(tmp, { framework: "unknown" });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: { ...process.env, RUNNABLE_TEST_MANIFEST: manifestPath },
    })`build-tools/tools/bin/p //projects/apps/ssr:app`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /missing\/invalid framework/);
  });
});

test("SSR run command fails when serverEntry artifact is missing", async () => {
  await runInTemp("runnable-ssr-negative-server-entry", async (tmp, $) => {
    const manifestPath = await writeSsrManifest(tmp, { includeServerEntry: false });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: { ...process.env, RUNNABLE_TEST_MANIFEST: manifestPath },
    })`build-tools/tools/bin/p //projects/apps/ssr:app`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /missing artifacts\.serverEntry/);
  });
});

test("SSR run command fails when clientDir artifact is missing", async () => {
  await runInTemp("runnable-ssr-negative-client-dir", async (tmp, $) => {
    const manifestPath = await writeSsrManifest(tmp, { includeClientDir: false });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: { ...process.env, RUNNABLE_TEST_MANIFEST: manifestPath },
    })`build-tools/tools/bin/p //projects/apps/ssr:app`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /missing artifacts\.clientDir/);
  });
});

test("SSR run command never falls back to static host production command", async () => {
  await runInTemp("runnable-ssr-negative-static-fallback", async (tmp, $) => {
    const manifestPath = await writeSsrManifest(tmp, {
      prodArgv: ["python3", "-m", "http.server", "--directory", "/tmp/fake"],
    });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: { ...process.env, RUNNABLE_TEST_MANIFEST: manifestPath },
    })`build-tools/tools/bin/p //projects/apps/ssr:app`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /must not use static host fallback/);
  });
});

test("SSR dev routing fails fast when run.dev metadata is missing", async () => {
  await runInTemp("runnable-ssr-negative-missing-dev", async (tmp, $) => {
    const manifestPath = await writeSsrManifest(tmp, { includeDev: false });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      env: { ...process.env, RUNNABLE_TEST_MANIFEST: manifestPath },
    })`build-tools/tools/bin/d //projects/apps/ssr:app`;
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /missing run\.dev argv/);
  });
});
