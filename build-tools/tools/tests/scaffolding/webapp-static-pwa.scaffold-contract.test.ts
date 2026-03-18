#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("webapp-static-pwa scaffold includes pwa contract files and static labels", async () => {
  await runInTemp("webapp-static-pwa-scaffold-contract", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`scaf new ts webapp-static-pwa demo-pwa --yes --no-tests --skip-lockfile-gen`;

    const appRoot = path.join(tmp, "projects", "apps", "demo-pwa");
    const targets = await fsp.readFile(path.join(appRoot, "TARGETS"), "utf8");
    const indexHtml = await fsp.readFile(path.join(appRoot, "index.html"), "utf8");
    const entryClient = await fsp.readFile(path.join(appRoot, "src", "main.ts"), "utf8");
    const manifest = JSON.parse(
      await fsp.readFile(path.join(appRoot, "public", "manifest.webmanifest"), "utf8"),
    ) as { icons?: Array<{ src?: string }> };
    const serviceWorker = await fsp.readFile(
      path.join(appRoot, "public", "service-worker.js"),
      "utf8",
    );

    await fsp.access(path.join(appRoot, "public", "icons", "icon-192.svg"));
    await fsp.access(path.join(appRoot, "public", "icons", "icon-512.svg"));

    assert.match(targets, /labels = \["lang:node", "kind:app", "webapp:static", "webapp:pwa"\]/);
    assert.match(indexHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(indexHtml, /apple-mobile-web-app-capable/);
    assert.match(entryClient, /navigator\.serviceWorker/);
    assert.match(entryClient, /register\("\/service-worker\.js"/);
    assert.match(entryClient, /controllerchange/);
    assert.deepEqual(
      manifest.icons?.map((icon) => icon.src),
      ["/icons/icon-192.svg", "/icons/icon-512.svg"],
    );
    assert.match(serviceWorker, /const APP_SHELL_URL = "\/"/);
    assert.match(serviceWorker, /requestUrl\.pathname\.endsWith\("\.wasm"\)/);
    assert.match(serviceWorker, /caches\.open\(APP_SHELL_CACHE\)/);
  });
});
