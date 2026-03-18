#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import {
  assertStaticPwaServiceWorkerReady,
  readStaticPwaPrecacheState,
} from "../../lib/static-pwa-precache.ts";
import { runInTemp } from "../lib/test-helpers/run-in-temp.ts";
import { createStaticPwaServiceWorkerHarness } from "./lib/static-pwa-service-worker.ts";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-static-pwa build cold-loads offline after service-worker install and keeps the app shell contract",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS = "build-tools toolchains third_party/providers prelude patches";
    }
    try {
      await runInTemp("webapp-static-pwa-runtime-offline", async (tmp, _$) => {
        const $ = _$({ cwd: tmp, stdio: "inherit" });
        await $`scaf new ts webapp-static-pwa demo-pwa --yes --no-tests --skip-lockfile-gen`;
        const appAbs = path.join(tmp, "projects", "apps", "demo-pwa");
        await $({
          cwd: appAbs,
          env: { ...process.env },
        })`zx-wrapper ../../../build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
        await _$({
          cwd: tmp,
          stdio: "pipe",
        })`git add -A projects/apps/demo-pwa build-tools/tools/nix/node-modules.hashes.json build-tools/tools/nix/langs.nix build-tools/lang/importer_roots.bzl build-tools/tools/buck third_party/providers`;
        const importer = "projects/apps/demo-pwa";
        const lockfile = path.join(importer, "pnpm-lock.yaml");
        const sanitized = importer
          .replace(/\/\//g, "")
          .replace(/:/g, "-")
          .replace(/[\/\s]+/g, "-");
        const envWithPrefetch = { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<
          string,
          string
        >;
        await $({
          cwd: tmp,
          stdio: "inherit",
          env: envWithPrefetch,
        })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
        const nixOut = await $({
          stdio: "pipe",
          cwd: tmp,
          env: envWithPrefetch,
        })`bash --noprofile --norc -c ${`set -euo pipefail; nix build "${tmp}#node-webapp.${sanitized}" --impure --no-link --accept-flake-config --builders "" --print-build-logs --print-out-paths`}`;
        const outPath =
          String(nixOut.stdout || "")
            .trim()
            .split("\n")
            .pop() || "";
        const distDir = path.join(outPath, "dist");
        const precacheState = readStaticPwaPrecacheState(distDir);
        assertStaticPwaServiceWorkerReady(`${distDir}/service-worker.js`);

        const scriptUrl = precacheState.urls.find((url) => url.endsWith(".js"));
        const wasmUrl = precacheState.urls.find((url) => url.endsWith(".wasm"));
        assert.ok(scriptUrl, "expected built JS entry in precache");
        assert.ok(wasmUrl, "expected built wasm asset in precache");

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

        const onlineScript = await harness.dispatchFetch({
          destination: "script",
          method: "GET",
          url: `http://app.local${scriptUrl}`,
        });
        assert.equal(onlineScript.status, 200);

        const onlineWasm = await harness.dispatchFetch({
          method: "GET",
          url: `http://app.local${wasmUrl}`,
        });
        assert.equal(onlineWasm.status, 200);

        harness.setOffline(true);

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
