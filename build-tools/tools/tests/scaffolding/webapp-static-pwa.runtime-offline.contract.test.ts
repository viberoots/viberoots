#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core";
import { assertStaticPwaServiceWorkerReady } from "../../lib/static-pwa-precache";
import { reconcileTempDependencyInputs, runInTemp } from "../lib/test-helpers/run-in-temp";
import { pnpmInstallForDevTest } from "./lib/dev-node-modules";
import { createStaticPwaServiceWorkerHarness } from "./lib/static-pwa-service-worker";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

function parseInjectedPrecacheUrls(serviceWorkerSource: string): string[] {
  const match = serviceWorkerSource.match(
    /const PRECACHE_URLS = \[APP_SHELL_URL, \.\.\.(\[[\s\S]*?\])\];/,
  );
  if (!match?.[1]) {
    throw new Error("failed to parse injected service worker precache urls");
  }
  return JSON.parse(match[1]) as string[];
}

test(
  "webapp-static-pwa build cold-loads offline after service-worker install and keeps the app shell contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS =
        "viberoots/build-tools toolchains third_party/providers prelude patches";
    }
    try {
      await runInTemp("webapp-static-pwa-runtime-offline", async (tmp, _$) => {
        const $ = _$({ cwd: tmp, stdio: "inherit" });
        await $`scaf new ts webapp-static-pwa demo-pwa --yes --no-tests --skip-store-hash-refresh`;
        const appAbs = path.join(tmp, "projects", "apps", "demo-pwa");
        const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
        await syncModuleContractsForApp({
          appCwd: appAbs,
          appTargetLabel: contracts.appTargetLabel,
          root: tmp,
        });
        await reconcileTempDependencyInputs(tmp, $);
        await pnpmInstallForDevTest({
          tmp,
          _$,
          filter: "./projects/apps/demo-pwa...",
          frozenLockfile: true,
        });
        await _$({ cwd: appAbs, stdio: "inherit" })`node scripts/build.mjs`;
        const distDir = path.join(appAbs, "dist");
        assertStaticPwaServiceWorkerReady(`${distDir}/service-worker.js`);
        const serviceWorkerSource = await fsp.readFile(
          path.join(distDir, "service-worker.js"),
          "utf8",
        );
        const precacheUrls = parseInjectedPrecacheUrls(serviceWorkerSource);
        const scriptUrl = precacheUrls.find((url) => url.endsWith(".js"));
        const wasmUrl = precacheUrls.find((url) => url.endsWith(".wasm"));
        assert.ok(scriptUrl, "expected built JS entry in precache");
        assert.ok(wasmUrl, "expected built wasm asset in precache");
        assert.match(serviceWorkerSource, new RegExp(scriptUrl.replace(".", "\\.")));
        assert.match(serviceWorkerSource, new RegExp(wasmUrl.replace(".", "\\.")));

        const harness = await createStaticPwaServiceWorkerHarness(distDir);
        await harness.dispatchInstall();
        await harness.dispatchActivate();

        const onlineNavigate = await harness.dispatchFetch({
          destination: "document",
          method: "GET",
          mode: "navigate",
          url: "http://app.local/",
        });
        assert.equal(onlineNavigate.status, 200);

        harness.setOffline(true);

        const offlineScript = await harness.dispatchFetch({
          destination: "script",
          method: "GET",
          url: `http://app.local${scriptUrl}`,
        });
        assert.equal(offlineScript.status, 200);
        assert.match(await offlineScript.text(), /moduleMessage|loaded/);

        const offlineWasm = await harness.dispatchFetch({
          method: "GET",
          url: `http://app.local${wasmUrl}`,
        });
        assert.equal(offlineWasm.status, 200);
        assert.ok((await offlineWasm.arrayBuffer()).byteLength > 0);

        const offlineNavigate = await harness.dispatchFetch({
          destination: "document",
          method: "GET",
          mode: "navigate",
          url: "http://app.local/",
        });
        assert.equal(offlineNavigate.status, 200);
        assert.match(
          await offlineNavigate.text(),
          /Offline-ready app shell with service worker and manifest wiring\./,
        );
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
