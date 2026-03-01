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
  watchPathFragment: string;
  syncPathFragment: string;
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
    watchPathFragment: "--watch src/wasm-producer/payload.txt",
    syncPathFragment: "--sync-out src/wasm-contract/top.wasm",
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
    watchPathFragment: "--watch src/wasm-producer/payload.txt",
    syncPathFragment: "--sync-out src/wasm-contract/top.wasm",
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
    watchPathFragment: "--watch app/wasm-producer/payload.txt",
    syncPathFragment: "--sync-out app/wasm-contract/top.wasm",
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
    assert.match(packageJson, /dev-with-wasm-watch\.ts/, `${contract.id}: dev not composed`);
    assert.match(packageJson, /dev:wasm:watch/, `${contract.id}: dev missing watch wiring`);
    assert.match(
      packageJson,
      /watch-wasm-producer\.ts/,
      `${contract.id}: watcher command mismatch`,
    );
    assert.match(packageJson, /--build-cmd/, `${contract.id}: watcher build command flag missing`);
    assert.match(
      packageJson,
      /build-wasm-producer\.ts/,
      `${contract.id}: watcher build command must use zx-wrapper TypeScript producer script`,
    );
    assert.doesNotMatch(
      packageJson,
      /build-wasm-producer\.mjs/,
      `${contract.id}: watcher build command must not rely on legacy .mjs producer logic`,
    );
    assert.match(
      packageJson,
      /--build-out \.wasm-producer\/top\.wasm/,
      `${contract.id}: watcher build output mismatch`,
    );
    assert.match(
      packageJson,
      new RegExp(contract.watchPathFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${contract.id}: watcher source path mismatch`,
    );
    assert.match(
      packageJson,
      new RegExp(contract.syncPathFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${contract.id}: watcher sync path mismatch`,
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
  assert.match(templateReadme, /app\/wasm-producer\/payload\.txt/);
  assert.match(templateReadme, /\[wasm-watch\] sync:ok/);

  const scaffoldingDoc = await fsp.readFile(
    path.join(REPO_ROOT, "build-tools", "docs", "scaffolding.md"),
    "utf8",
  );
  assert.match(scaffoldingDoc, /webapp-static <name>/);
  assert.match(scaffoldingDoc, /webapp-ssr-vite <name>/);
  assert.match(scaffoldingDoc, /webapp-ssr-next <name>/);
  assert.match(scaffoldingDoc, /app\/wasm-producer\/payload\.txt/);
  assert.match(scaffoldingDoc, /app\/wasm-contract\/top\.wasm/);
});
