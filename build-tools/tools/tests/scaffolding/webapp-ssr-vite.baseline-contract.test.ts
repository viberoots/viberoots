#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";
import { viberootsRoot, viberootsTool } from "./lib/viberoots-tools";

const TEMPLATE_ROOT = viberootsTool(
  path.join("build-tools", "tools", "scaffolding", "templates", "ts", "webapp-ssr-vite"),
);

test("Vite SSR template appears in templates listing and help", async () => {
  await runInTemp("scaf-webapp-ssr-vite-listing", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    const templates = await $`scaf templates ts --json`;
    const rows = JSON.parse(String(templates.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    const tsTemplates = new Set(
      rows.filter((row) => row.language === "ts").map((row) => row.template),
    );
    assert.ok(tsTemplates.has("webapp-ssr-vite"));

    const help = await $`scaf help ts webapp-ssr-vite`;
    const helpText = String(help.stdout || "");
    assert.match(helpText, /scaf new ts webapp-ssr-vite <name>/);
    assert.match(helpText, /scaf new ts webapp-ssr-vite demo-vite-ssr --yes/);
  });
});

test("Vite SSR template metadata and scaffold baseline are present", async () => {
  const meta = JSON.parse(await fsp.readFile(path.join(TEMPLATE_ROOT, "meta.json"), "utf8")) as {
    language?: string;
    template?: string;
    help?: { usage?: string };
  };
  assert.equal(meta.language, "ts");
  assert.equal(meta.template, "webapp-ssr-vite");
  assert.match(String(meta.help?.usage || ""), /scaf new ts webapp-ssr-vite <name>/);

  const copier = await fsp.readFile(path.join(TEMPLATE_ROOT, "copier.yaml"), "utf8");
  assert.match(copier, /^language:\s*["']?ts["']?\s*$/m);
  assert.match(copier, /^name:\s*["']?.*["']?\s*$/m);
  assert.match(copier, /^template:\s*["']?webapp-ssr-vite["']?\s*$/m);
  assert.match(copier, /^importer:\s*["']?projects\/apps\/\{\{ name \}\}["']?\s*$/m);
  assert.match(
    copier,
    /^lockfilePath:\s*["']?projects\/apps\/\{\{ name \}\}\/pnpm-lock\.yaml["']?\s*$/m,
  );
  assert.match(copier, /^pkgScope:\s*["']?@apps["']?\s*$/m);
  assert.match(copier, /^includeNodeTests:\s*true\s*$/m);

  await runInTemp("scaf-webapp-ssr-vite-baseline", async (tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --skip-lockfile-gen`;
    const appRoot = path.join(tmp, "projects", "apps", "demo-vite-ssr");
    const expectedFiles = [
      path.join(appRoot, "TARGETS"),
      path.join(appRoot, "package.json"),
      path.join(appRoot, "index.html"),
      path.join(appRoot, "vite.config.ts"),
      path.join(appRoot, "tsconfig.json"),
      path.join(appRoot, "tsconfig.server.json"),
      path.join(appRoot, "pnpm-lock.yaml"),
      path.join(appRoot, "server", "index.ts"),
      path.join(appRoot, "server", "wasm-contract.ts"),
      path.join(appRoot, "src", "entry-client.ts"),
      path.join(appRoot, "src", "entry-server.ts"),
      path.join(appRoot, "src", "home.tsx"),
      path.join(appRoot, "src", "wasm-contract.ts"),
    ];
    for (const file of expectedFiles) {
      assert.ok(await exists(file), `expected scaffold file missing: ${file}`);
    }
    assert.equal(await exists(path.join(appRoot, "copier.yaml")), false);
    assert.equal(await exists(path.join(appRoot, "src", "wasm-contract", "top.wasm")), false);
    assert.equal(await exists(path.join(appRoot, "src", "wasm-producer", "payload.txt")), false);

    const targets = await fsp.readFile(path.join(appRoot, "TARGETS"), "utf8");
    assert.match(targets, /webapp:ssr/);
    assert.match(targets, /framework:vite/);
    const packageJson = JSON.parse(
      await fsp.readFile(path.join(appRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    assert.equal(String(packageJson.scripts?.dev || ""), "node scripts/dev.mjs");
    assert.equal(
      String(packageJson.scripts?.["dev:wasm:watch"] || ""),
      "node scripts/dev-wasm-watch.mjs",
    );
    assert.equal(String(packageJson.scripts?.["build:ssr"] || ""), "node scripts/build-ssr.mjs");
    assert.equal(String(packageJson.dependencies?.react || ""), "^18.3.1");
    assert.equal(String(packageJson.dependencies?.["react-dom"] || ""), "^18.3.1");
    assert.equal(String(packageJson.dependencies?.["react-native-web"] || ""), "^0.19.13");
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
      /const viteBin = path\.join\(process\.cwd\(\), "node_modules", "\.bin", "vite"\);/,
    );
    assert.match(
      buildSsrScript,
      /const tscBin = path\.join\(process\.cwd\(\), "node_modules", "\.bin", "tsc"\);/,
    );
    assert.match(buildSsrScript, /execFileSync\(viteBin, \["build", "--outDir", "dist\/client"\]/);
    assert.match(
      buildSsrScript,
      /execFileSync\(\s*viteBin,\s*\[\s*"build",\s*"--ssr",\s*"src\/entry-server\.ts",\s*"--outDir",\s*"dist\/server",?\s*\]/,
    );

    await $({
      cwd: viberootsRoot(),
    })`pnpm prettier --check ${path.join(appRoot, "pnpm-lock.yaml")} ${path.join(appRoot, "scripts", "build-ssr.mjs")} ${path.join(appRoot, "scripts", "dev-wasm-watch.mjs")} ${path.join(appRoot, "server", "dev.mjs")} ${path.join(appRoot, "server", "index.ts")} ${path.join(appRoot, "server", "ts-modules.ts")} ${path.join(appRoot, "src", "home.tsx")} ${path.join(appRoot, "src", "ts-modules.ts")} ${path.join(appRoot, "src", "wasm-contract.ts")} ${path.join(appRoot, "test", "entry-server.test.ts")} ${path.join(appRoot, "vite.config.ts")}`;
  });
});
