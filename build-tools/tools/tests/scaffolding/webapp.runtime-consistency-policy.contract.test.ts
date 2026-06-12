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
  payloadExpected: boolean;
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
    payloadExpected: false,
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
    payloadExpected: true,
  },
];

test("SSR runtime-consistency: script and path contracts stay deterministic across templates", async () => {
  for (const contract of SSR_CONTRACTS) {
    const templateAbs = path.join(REPO_ROOT, contract.templateRoot);
    const packageJson = await fsp.readFile(path.join(templateAbs, "package.json.jinja"), "utf8");
    const devScript = await fsp.readFile(
      path.join(templateAbs, "scripts", "dev.mjs.jinja"),
      "utf8",
    );
    const watchScript = await fsp.readFile(
      path.join(templateAbs, "scripts", "dev-wasm-watch.mjs.jinja"),
      "utf8",
    );

    assert.match(packageJson, /"dev":\s*"/, `${contract.id}: missing scripts.dev`);
    assert.match(
      packageJson,
      /"dev":\s*"node scripts\/dev\.mjs"/,
      `${contract.id}: dev script mismatch`,
    );
    assert.match(packageJson, /dev:ssr:only/, `${contract.id}: missing dev:ssr:only wiring`);
    assert.match(
      packageJson,
      /"dev:wasm:watch":\s*"node scripts\/dev-wasm-watch\.mjs"/,
      `${contract.id}: watcher script mismatch`,
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
    assert.match(devScript, /dev-with-wasm-watch\.ts/, `${contract.id}: dev wrapper mismatch`);
    assert.match(devScript, /--watch-cmd/, `${contract.id}: missing watcher wiring`);
    assert.match(devScript, /dev:wasm:watch/, `${contract.id}: missing watcher wiring`);
    assert.match(
      watchScript,
      /watch-wasm-coordinator\.ts/,
      `${contract.id}: watcher entry mismatch`,
    );
    assert.match(
      watchScript,
      /watch-wasm-coordinator\.ts/,
      `${contract.id}: canonical watcher missing`,
    );
    assert.doesNotMatch(
      watchScript,
      /build-wasm-producer\.mjs/,
      `${contract.id}: legacy .mjs producer path must stay disabled`,
    );
    assert.doesNotMatch(
      watchScript,
      /--watch|--build-cmd|--build-out|--sync-out/,
      `${contract.id}: legacy watcher flags should not be hardcoded`,
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
    assert.equal(
      payloadExists,
      contract.payloadExpected,
      `${contract.id}: wasm producer payload source mismatch`,
    );
  }
});

test("SSR runtime-consistency policy docs: runtime consistency and startup guidance stay explicit", async () => {
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

  const hmrPlan = await fsp.readFile(
    path.join(REPO_ROOT, "docs", "history", "designs", "legacy", "hmr-plan.md"),
    "utf8",
  );
  assert.match(hmrPlan, /### Phase 3 Closeout Status/);
  assert.match(hmrPlan, /Checkpoint: `COMPLETED` for Phase 3/);
  assert.match(hmrPlan, /Phase 4 is complete\./);
  assert.match(hmrPlan, /## Dev Update Contract Matrix \(Phase 0 through Phase 3\)/);
  assert.match(
    hmrPlan,
    /\|\s*Change class\s*\|\s*`ts\/webapp-static`\s*\|\s*`ts\/webapp-ssr-vite`\s*\|\s*`ts\/webapp-ssr-next`\s*\|/,
  );
  assert.match(hmrPlan, /Deterministic failure signatures and recovery commands by change class/);
  assert.match(hmrPlan, /Stale install lock state during dependency\/bootstrap steps/);
  assert.match(
    hmrPlan,
    /inspect `\/tmp\/viberoots-locks\/` for orphaned lock directories and retry/,
  );
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
  assert.match(scaffoldingDoc, /stale install lock state during dependency\/bootstrap/);
  assert.match(
    scaffoldingDoc,
    /inspect `\/tmp\/viberoots-locks\/` for orphaned lock directories and retry/,
  );
  assert.match(scaffoldingDoc, /Shared regression helper contract/);
  assert.match(scaffoldingDoc, /lib\/wasm-watch\.ts/);
  assert.match(scaffoldingDoc, /E2E runner policy contract for this suite/);
  assert.match(
    scaffoldingDoc,
    /selected runner is Node `zx-wrapper` tests with deterministic process, HTTP, and filesystem probes/,
  );
  assert.match(scaffoldingDoc, /escalation triggers for Playwright adoption/);
});

test("shared helper reuse: representative template local-dep tests import shared helpers", async () => {
  const staticLocalDep = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "tests",
      "scaffolding",
      "webapp-static.dev-hmr.local-ts-dep.test.ts",
    ),
    "utf8",
  );
  assert.match(staticLocalDep, /from "\.\/lib\/webapp-local-ts-dep"/);

  const viteLocalDep = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "tests",
      "scaffolding",
      "webapp-ssr-vite.dev-hmr.local-ts-dep.test.ts",
    ),
    "utf8",
  );
  assert.match(viteLocalDep, /from "\.\/lib\/webapp-ssr-vite-local-ts-dep"/);

  const viteLocalDepHelper = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "tests",
      "scaffolding",
      "lib",
      "webapp-ssr-vite-local-ts-dep.ts",
    ),
    "utf8",
  );
  assert.match(viteLocalDepHelper, /from "\.\/wasm-watch"/);
  assert.match(viteLocalDepHelper, /writeAndBumpMtime/);

  const staticLocalDepHelper = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "tests",
      "scaffolding",
      "lib",
      "webapp-local-ts-dep.ts",
    ),
    "utf8",
  );
  assert.match(staticLocalDepHelper, /from "\.\/wasm-watch"/);
  assert.match(staticLocalDepHelper, /assertWorkspaceLinkedDependency/);
  assert.match(staticLocalDepHelper, /writeAndBumpMtime/);

  const staticPwaLocalDep = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "tests",
      "scaffolding",
      "webapp-static-pwa.dev-hmr.local-ts-dep.test.ts",
    ),
    "utf8",
  );
  assert.match(staticPwaLocalDep, /from "\.\/lib\/webapp-local-ts-dep"/);

  const nextLocalDep = await fsp.readFile(
    path.join(
      REPO_ROOT,
      "build-tools",
      "tools",
      "tests",
      "scaffolding",
      "webapp-ssr-next.dev-hmr.local-ts-dep.test.ts",
    ),
    "utf8",
  );
  assert.match(nextLocalDep, /from "\.\/lib\/wasm-watch"/);
  assert.match(nextLocalDep, /assertNoProcessRestart/);
});
