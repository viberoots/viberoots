#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

type SsrManifestOpts = {
  framework?: string;
  prodArgv?: string[];
  includeServerEntry?: boolean;
  includeClientDir?: boolean;
  includeDev?: boolean;
  malformedServerEntry?: boolean;
  malformedClientDir?: boolean;
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
  const artifacts: Record<string, unknown> = {};
  if (opts.includeServerEntry !== false) {
    artifacts.serverEntry = opts.malformedServerEntry ? { path: serverEntry } : serverEntry;
  }
  if (opts.includeClientDir !== false) {
    artifacts.clientDir = opts.malformedClientDir ? { path: clientDir } : clientDir;
  }
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

test("SSR runnable commands fail fast on invalid contract shapes", async () => {
  await runInTemp("runnable-ssr-negative-contracts", async (tmp, $) => {
    const runCase = async (opts: {
      name: string;
      cmd: "p" | "d";
      manifest: SsrManifestOpts;
      expected: RegExp;
    }) => {
      const manifestPath = await writeSsrManifest(tmp, opts.manifest);
      const result = await $({
        cwd: tmp,
        stdio: "pipe",
        nothrow: true,
        env: { ...process.env, RUNNABLE_TEST_MANIFEST: manifestPath },
      })`build-tools/tools/bin/${opts.cmd} //projects/apps/ssr:app`;
      assert.notEqual(result.exitCode, 0, `${opts.name}: expected non-zero exit`);
      assert.match(String(result.stderr || ""), opts.expected, `${opts.name}: expected error`);
    };

    await runCase({
      name: "missing/invalid framework discriminator",
      cmd: "p",
      manifest: { framework: "unknown" },
      expected: /missing\/invalid framework/,
    });
    await runCase({
      name: "missing serverEntry artifact",
      cmd: "p",
      manifest: { includeServerEntry: false },
      expected: /missing artifacts\.serverEntry/,
    });
    await runCase({
      name: "missing clientDir artifact",
      cmd: "p",
      manifest: { includeClientDir: false },
      expected: /missing artifacts\.clientDir/,
    });
    await runCase({
      name: "static-host prod fallback rejected",
      cmd: "p",
      manifest: {
        framework: "vite",
        prodArgv: ["python3", "-m", "http.server", "--directory", "/tmp/fake"],
      },
      expected: /must not use static host fallback/,
    });
    await runCase({
      name: "malformed serverEntry artifact",
      cmd: "p",
      manifest: { framework: "vite", malformedServerEntry: true },
      expected: /missing artifacts\.serverEntry/,
    });
    await runCase({
      name: "malformed clientDir artifact",
      cmd: "p",
      manifest: { framework: "vite", malformedClientDir: true },
      expected: /missing artifacts\.clientDir/,
    });
    await runCase({
      name: "missing dev routing metadata",
      cmd: "d",
      manifest: { includeDev: false },
      expected: /missing run\.dev argv/,
    });
  });
});
