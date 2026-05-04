#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertSsrAdapterConformance } from "../lib/ssr-adapter-conformance";
import { runInTemp } from "../lib/test-helpers";
import {
  TEST_TIMEOUT_MS,
  buildSelectedSsr,
  scaffoldAndPrepareWorkspace,
  withTempRoots,
} from "./lib/webapp-ssr";

async function buildBuckOutput(tmp: string, _$: any, label: string): Promise<string> {
  const built = await _$({
    cwd: tmp,
    stdio: "pipe",
    env: { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" },
  })`buck2 build --target-platforms prelude//platforms:default --show-output ${label}`;
  const outPath =
    String(built.stdout || "")
      .trim()
      .split(/\n+/)
      .pop()
      ?.split(/\s+/)
      .pop() || "";
  assert.ok(outPath, `missing Buck output for ${label}`);
  return path.isAbsolute(outPath) ? outPath : path.join(tmp, outPath);
}

test(
  "SSR next contracts: materialize listing and adapter conformance",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await withTempRoots(async () => {
      await runInTemp("node-webapp-ssr-next-contracts", async (tmp, _$) => {
        const appName = "demo-ssr-next";
        const label = `//projects/apps/${appName}:app`;
        await scaffoldAndPrepareWorkspace(tmp, _$, "webapp-ssr-next", appName);
        const appRoot = path.join(tmp, "projects", "apps", appName);
        const targets = await fsp.readFile(path.join(appRoot, "TARGETS"), "utf8");
        assert.match(targets, /node_vercel_next_artifact/);
        assert.match(targets, /name = "vercel_artifact"/);
        const vercelConfig = JSON.parse(
          await fsp.readFile(path.join(appRoot, "vercel.project.json"), "utf8"),
        ) as { schemaVersion?: string; framework?: string; runtime?: { nodeVersion?: string } };
        assert.equal(vercelConfig.schemaVersion, "vercel-next-artifact@1");
        assert.equal(vercelConfig.framework, "nextjs");
        assert.equal(vercelConfig.runtime?.nodeVersion, "22.x");
        const packageJson = JSON.parse(
          await fsp.readFile(path.join(appRoot, "package.json"), "utf8"),
        ) as {
          scripts?: Record<string, string>;
        };
        const scripts = packageJson.scripts || {};
        assert.equal(typeof scripts.dev, "string");
        assert.equal(typeof scripts["dev:ssr"], "string");
        assert.equal(typeof scripts["dev:ssr:only"], "string");
        assert.equal(typeof scripts["dev:wasm"], "string");
        assert.equal(typeof scripts["dev:wasm:watch"], "string");
        assert.equal(String(scripts.dev), "node scripts/dev.mjs");
        assert.equal(String(scripts["dev:wasm:watch"]), "node scripts/dev-wasm-watch.mjs");
        assert.equal(String(scripts["build:ssr"]), "node scripts/build-ssr.mjs");
        const devScript = await fsp.readFile(path.join(appRoot, "scripts", "dev.mjs"), "utf8");
        assert.match(devScript, /dev-with-wasm-watch\.ts/);
        const devWasmWatchScript = await fsp.readFile(
          path.join(appRoot, "scripts", "dev-wasm-watch.mjs"),
          "utf8",
        );
        assert.match(devWasmWatchScript, /watch-wasm-coordinator\.ts/);
        assert.doesNotMatch(devWasmWatchScript, /build-wasm-producer\.mjs/);
        assert.doesNotMatch(devWasmWatchScript, /--watch|--build-cmd|--build-out|--sync-out/);
        const buildSsrScript = await fsp.readFile(
          path.join(appRoot, "scripts", "build-ssr.mjs"),
          "utf8",
        );
        assert.match(
          buildSsrScript,
          /const nextBin = path\.join\(process\.cwd\(\), "node_modules", "\.bin", "next"\);/,
        );
        assert.match(buildSsrScript, /execFileSync\(nextBin, \["build"\]/);
        assert.match(
          buildSsrScript,
          /const tscBin = path\.join\(process\.cwd\(\), "node_modules", "\.bin", "tsc"\);/,
        );
        assert.match(buildSsrScript, /execFileSync\(tscBin, \["-p", "tsconfig\.server\.json"\]/);
        await fsp.access(path.join(appRoot, "app", "wasm-producer", "payload.txt"));
        const { outPath, importer } = await buildSelectedSsr(tmp, _$, label, "next");
        await assertSsrAdapterConformance({ label, outPath, importer, framework: "next" });
        const artifactOut = await buildBuckOutput(
          tmp,
          _$,
          `//projects/apps/${appName}:vercel_artifact`,
        );
        await fsp.access(path.join(artifactOut, ".vercel", "output", "config.json"));
        await fsp.access(
          path.join(
            artifactOut,
            ".vercel",
            "output",
            "functions",
            "render.func",
            ".vc-config.json",
          ),
        );
        const artifactIdentity = JSON.parse(
          await fsp.readFile(path.join(artifactOut, "artifact-identity.json"), "utf8"),
        ) as { identity?: string };
        assert.match(String(artifactIdentity.identity || ""), /^vercel-next:[a-f0-9]{64}$/);
      });
    });
  },
);
