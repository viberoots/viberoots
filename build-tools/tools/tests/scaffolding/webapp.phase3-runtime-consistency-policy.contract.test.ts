#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();

type Phase3TemplateContract = {
  id: string;
  templateRoot: string;
  payloadPath: string;
  contractPath: string;
  watchPathFragment: string;
};

const SSR_CONTRACTS: Phase3TemplateContract[] = [
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
    payloadPath: path.join("src", "wasm-producer", "payload.txt"),
    contractPath: path.join("src", "wasm-contract", "top.wasm"),
    watchPathFragment: "--watch src/wasm-producer/payload.txt",
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
    payloadPath: path.join("app", "wasm-producer", "payload.txt"),
    contractPath: path.join("app", "wasm-contract", "top.wasm"),
    watchPathFragment: "--watch app/wasm-producer/payload.txt",
  },
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("Phase-3 template policy: SSR runtime-consistency script and path contracts stay deterministic", async () => {
  for (const contract of SSR_CONTRACTS) {
    const templateAbs = path.join(REPO_ROOT, contract.templateRoot);
    const packageJson = await fsp.readFile(path.join(templateAbs, "package.json.jinja"), "utf8");

    assert.match(packageJson, /"dev":\s*"/, `${contract.id}: missing scripts.dev`);
    assert.match(packageJson, /dev-with-wasm-watch\.ts/, `${contract.id}: dev wrapper mismatch`);
    assert.match(packageJson, /dev:ssr:only/, `${contract.id}: missing dev:ssr:only wiring`);
    assert.match(
      packageJson,
      /--watch-cmd .*dev:wasm:watch/,
      `${contract.id}: missing watcher wiring`,
    );
    assert.match(
      packageJson,
      /"dev:ssr:only":\s*"/,
      `${contract.id}: missing scripts.dev:ssr:only`,
    );
    assert.match(
      packageJson,
      /"dev:wasm:watch":\s*"/,
      `${contract.id}: missing scripts.dev:wasm:watch`,
    );
    assert.match(packageJson, /watch-wasm-producer\.ts/, `${contract.id}: watcher entry mismatch`);
    assert.match(
      packageJson,
      /build-wasm-producer\.ts/,
      `${contract.id}: canonical producer command missing`,
    );
    assert.doesNotMatch(
      packageJson,
      /build-wasm-producer\.mjs/,
      `${contract.id}: legacy .mjs producer path must stay disabled`,
    );
    assert.match(
      packageJson,
      new RegExp(escapeRegex(contract.watchPathFragment)),
      `${contract.id}: watcher source path mismatch`,
    );
    assert.match(
      packageJson,
      new RegExp(`--sync-out ${escapeRegex(contract.contractPath)}`),
      `${contract.id}: watcher contract sync path mismatch`,
    );
    assert.doesNotMatch(
      packageJson,
      /\bprewarm\b/i,
      `${contract.id}: startup scripts must stay non-blocking (no prewarm gate in dev startup path)`,
    );

    const payloadExists = await fsp
      .access(path.join(templateAbs, contract.payloadPath))
      .then(() => true)
      .catch(() => false);
    assert.equal(payloadExists, true, `${contract.id}: wasm producer payload source missing`);
  }
});

test("Phase-3 policy docs: SSR runtime consistency and startup guidance stay explicit", async () => {
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
  assert.match(
    templateReadme,
    /For deterministic Phase 3 checks, run repeated client\/server\/wasm edit cycles/,
  );
  assert.match(templateReadme, /verify process PID stays stable/);
  assert.match(templateReadme, /If startup appears blocked, verify `\/` responds on/);
  assert.match(templateReadme, /\[wasm-watch\] rebuild:start/);
  assert.match(templateReadme, /\[wasm-watch\] sync:ok/);

  const hmrPlan = await fsp.readFile(path.join(REPO_ROOT, "hmr-plan.md"), "utf8");
  assert.match(hmrPlan, /### Phase 3 Closeout Status/);
  assert.match(hmrPlan, /Checkpoint: `COMPLETED` for Phase 3/);
  assert.match(hmrPlan, /Begin Phase 4 regression coverage and docs lock-in/);
  assert.match(hmrPlan, /## Dev Update Contract Matrix \(Phase 0 through Phase 3\)/);
  assert.match(
    hmrPlan,
    /\|\s*Change class\s*\|\s*`ts\/webapp-static`\s*\|\s*`ts\/webapp-ssr-vite`\s*\|\s*`ts\/webapp-ssr-next`\s*\|/,
  );
  assert.match(hmrPlan, /Deterministic failure signatures and recovery commands by change class/);
  assert.match(hmrPlan, /## E2E Runner Policy/);
  assert.match(hmrPlan, /Current selected runner contract for this suite/);
  assert.match(hmrPlan, /Escalation triggers to adopt Playwright coverage in a future phase/);

  const scaffoldingDoc = await fsp.readFile(
    path.join(REPO_ROOT, "build-tools", "docs", "scaffolding.md"),
    "utf8",
  );
  assert.match(scaffoldingDoc, /Dev-update contract matrix for in-scope templates/);
  assert.match(
    scaffoldingDoc,
    /\|\s*Change class\s*\|\s*`ts\/webapp-static`\s*\|\s*`ts\/webapp-ssr-vite`\s*\|\s*`ts\/webapp-ssr-next`\s*\|/,
  );
  assert.match(scaffoldingDoc, /Deterministic failure signatures and recovery commands/);
  assert.match(scaffoldingDoc, /E2E runner policy contract for this suite/);
  assert.match(
    scaffoldingDoc,
    /selected runner is Node `zx-wrapper` tests with deterministic process, HTTP, and filesystem probes/,
  );
  assert.match(scaffoldingDoc, /escalation triggers for Playwright adoption/);
});
