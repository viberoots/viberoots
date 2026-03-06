#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists } from "../lib/test-helpers";

const REPO_ROOT = process.cwd();

type Phase2TemplateContract = {
  id: string;
  templateRoot: string;
  payloadFile: string;
};

const CONTRACTS: Phase2TemplateContract[] = [
  {
    id: "ts/webapp-static",
    templateRoot: path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-static",
    ),
    payloadFile: path.join("src", "wasm-producer", "payload.txt"),
  },
  {
    id: "ts/webapp-ssr-vite",
    templateRoot: path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-ssr-vite",
    ),
    payloadFile: path.join("src", "wasm-producer", "payload.txt"),
  },
  {
    id: "ts/webapp-ssr-next",
    templateRoot: path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-ssr-next",
    ),
    payloadFile: path.join("app", "wasm-producer", "payload.txt"),
  },
];

test("Phase-2 template policy: wasm producer contract keys exist across templates", async () => {
  for (const contract of CONTRACTS) {
    const root = path.join(REPO_ROOT, contract.templateRoot);
    const packageJsonPath = path.join(root, "package.json.jinja");
    const packageJson = await fsp.readFile(packageJsonPath, "utf8");

    assert.match(packageJson, /"dev":\s*"/, `${contract.id}: missing scripts.dev`);
    assert.match(packageJson, /"dev:wasm":\s*"/, `${contract.id}: missing scripts.dev:wasm`);
    assert.match(
      packageJson,
      /"dev:wasm:watch":\s*"/,
      `${contract.id}: missing scripts.dev:wasm:watch`,
    );
    assert.match(
      packageJson,
      /"dev":\s*"node scripts\/dev\.mjs"/,
      `${contract.id}: dev script mismatch`,
    );
    assert.match(
      packageJson,
      /"dev:wasm:watch":\s*"node scripts\/dev-wasm-watch\.mjs"/,
      `${contract.id}: watcher script mismatch`,
    );
    const devScript = await fsp.readFile(path.join(root, "scripts", "dev.mjs.jinja"), "utf8");
    assert.match(devScript, /dev-with-wasm-watch\.ts/, `${contract.id}: dev wrapper mismatch`);
    assert.match(devScript, /dev:wasm:watch/, `${contract.id}: dev missing watch wiring`);
    const watchScript = await fsp.readFile(
      path.join(root, "scripts", "dev-wasm-watch.mjs.jinja"),
      "utf8",
    );
    assert.match(
      watchScript,
      /watch-wasm-producer\.ts/,
      `${contract.id}: watcher command mismatch`,
    );
    assert.doesNotMatch(watchScript, /--wasm-manifest|--ts-manifest/);
    assert.doesNotMatch(watchScript, /wasm-modules\.manifest\.json|ts-modules\.manifest\.json/);
    assert.doesNotMatch(
      watchScript,
      /--watch/,
      `${contract.id}: legacy single-watch flag should be removed`,
    );
    assert.doesNotMatch(
      watchScript,
      /--build-cmd|--build-out|--sync-out/,
      `${contract.id}: legacy single-module build/sync flags should be removed`,
    );

    assert.equal(
      await exists(path.join(root, contract.payloadFile)),
      true,
      `${contract.id}: payload missing`,
    );
  }
});

test("Phase-2 policy docs: troubleshooting and template parity text are present", async () => {
  const templateReadme = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "README.md.jinja",
    ),
    "utf8",
  );
  assert.match(templateReadme, /pnpm run dev:wasm/);
  assert.match(templateReadme, /pnpm run dev:wasm:watch/);
  assert.match(templateReadme, /app\/wasm-producer/);
  assert.match(templateReadme, /\[wasm-watch\] sync:ok/);

  const scaffoldingDoc = await fsp.readFile(
    path.join(REPO_ROOT, "build-tools", "docs", "scaffolding.md"),
    "utf8",
  );
  assert.match(scaffoldingDoc, /webapp-static <name>/);
  assert.match(scaffoldingDoc, /webapp-ssr-vite <name>/);
  assert.match(scaffoldingDoc, /webapp-ssr-next <name>/);
  assert.match(scaffoldingDoc, /app\/wasm-producer/);
  assert.match(scaffoldingDoc, /dist\/server\/wasm\/<module>\.wasm/);
});
