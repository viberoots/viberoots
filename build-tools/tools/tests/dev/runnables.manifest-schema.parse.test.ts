#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inferRunnableFromOutPath, parseRunnableManifest } from "../../lib/runnables.ts";

test("parseRunnableManifest keeps backward compatibility for bins-only entries", () => {
  const legacy = JSON.stringify([
    { label: "//projects/apps/demo:demo", kind: "bin", bins: ["/nix/store/x/bin/demo"], aux: [] },
  ]);
  const parsed = parseRunnableManifest(legacy);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.label, "//projects/apps/demo:demo");
  assert.equal(parsed[0]?.runnable?.run.prod.argv[0], "/nix/store/x/bin/demo");
});

test("parseRunnableManifest reads explicit runnable contract fields", () => {
  const withRunnable = JSON.stringify([
    {
      label: "//projects/apps/web:web",
      kind: "app",
      bins: [],
      aux: [],
      runnable: {
        kind: "webapp",
        run: {
          prod: { argv: ["python3", "-m", "http.server", "--directory", "/nix/store/x/dist"] },
          dev: { argv: ["pnpm", "--dir", "projects/apps/web", "dev"] },
        },
      },
    },
  ]);
  const parsed = parseRunnableManifest(withRunnable);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.runnable?.kind, "webapp");
  assert.deepEqual(parsed[0]?.runnable?.run.dev?.argv, [
    "pnpm",
    "--dir",
    "projects/apps/web",
    "dev",
  ]);
});

test("parseRunnableManifest keeps SSR framework and runtime metadata fields", () => {
  const withSsr = JSON.stringify([
    {
      label: "//projects/apps/ssr:app",
      kind: "app",
      bins: [],
      aux: [],
      runnable: {
        kind: "webapp-ssr",
        framework: "hatch",
        run: {
          prod: { argv: ["node", "/nix/store/x/dist/server/index.js"] },
          dev: { argv: ["pnpm", "--dir", "projects/apps/ssr", "dev:ssr"] },
        },
        runtime: {
          serverCwd: "/nix/store/x",
          envFiles: [".env", ".env.local"],
          nodeArgs: ["--enable-source-maps"],
        },
        artifacts: {
          serverEntry: "/nix/store/x/dist/server/index.js",
          clientDir: "/nix/store/x/dist/client",
          assetManifest: "/nix/store/x/dist/client/manifest.json",
          publicDir: "/nix/store/x/public",
        },
      },
    },
  ]);
  const parsed = parseRunnableManifest(withSsr);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.runnable?.kind, "webapp-ssr");
  assert.equal(parsed[0]?.runnable?.framework, "hatch");
  assert.equal(parsed[0]?.runnable?.runtime?.serverCwd, "/nix/store/x");
  assert.deepEqual(parsed[0]?.runnable?.runtime?.envFiles, [".env", ".env.local"]);
  assert.deepEqual(parsed[0]?.runnable?.runtime?.nodeArgs, ["--enable-source-maps"]);
});

test("inferRunnableFromOutPath fails fast for SSR targets missing framework label", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "runnable-ssr-framework-"));
  await fsp.mkdir(path.join(tmp, "dist", "server"), { recursive: true });
  await fsp.mkdir(path.join(tmp, "dist", "client"), { recursive: true });
  await fsp.writeFile(path.join(tmp, "dist", "server", "index.js"), "console.log('ok');\n", "utf8");
  await assert.rejects(
    () =>
      inferRunnableFromOutPath({
        label: "//projects/apps/ssr:app",
        outPath: tmp,
        mode: "ssr",
        framework: "",
      }),
    /missing\/invalid framework label/,
  );
});

test("inferRunnableFromOutPath fails fast for missing SSR packaging artifacts", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "runnable-ssr-artifacts-"));
  await fsp.mkdir(path.join(tmp, "dist", "server"), { recursive: true });
  await fsp.writeFile(path.join(tmp, "dist", "server", "index.js"), "console.log('ok');\n", "utf8");
  await assert.rejects(
    () =>
      inferRunnableFromOutPath({
        label: "//projects/apps/ssr:app",
        outPath: tmp,
        mode: "ssr",
        framework: "next",
      }),
    /missing clientDir/,
  );
});
